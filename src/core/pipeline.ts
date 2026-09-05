// Pipeline — DESIGN §3. Pure orchestration over injected ports; no IO of its own.
import { assembleChunks, chunkDocument, DEFAULT_CHUNK_CHARS } from "./chunker.js";
import type { Config } from "./config.js";
import { OUTPUT_MODES } from "./config.js";
import { isConfidentlySameLanguage, sourceLangHint } from "./detector.js";
import { canonicalLangCode } from "./lang.js";
import type { PlanDecision, PlanRequest } from "./outputPlanner.js";
import { decidePlan } from "./outputPlanner.js";
import type { Phrases } from "./phrases.js";
import type { Clock, Logger, SettingsStore } from "./ports.js";
import type {
  Chunk,
  DocumentExtractor,
  ExtractedDoc,
  IncomingCommand,
  IncomingDoc,
  LanguageDetector,
  MessengerAdapter,
  OutputMode,
  OutputPlan,
  TranslatorProvider,
} from "./types.js";
import { ProviderError } from "./types.js";

export interface PipelineDeps {
  messenger: MessengerAdapter;
  extractors: readonly DocumentExtractor[];
  detector: LanguageDetector;
  translator: TranslatorProvider;
  settings: SettingsStore;
  phrasesFor: (lang: string) => Phrases;
  logger: Logger;
  clock: Clock;
  /** Messenger download limit (Telegram: 20 MB). */
  maxBytes: number;
  chunkChars?: number;
  /** Extensions listed in the unsupported-format message. */
  supportedFormats?: readonly string[];
  /** One-time pairing code printed by `start` while no owner is configured (R1). */
  pairingCode?: string;
  /** Documents producing more chunks than this are rejected (R2). */
  maxChunksPerDoc?: number;
}

const DEFAULT_SUPPORTED = ["pdf", "docx", "txt", "md"] as const;
const DEFAULT_MAX_CHUNKS_PER_DOC = 50;
const HOUR_MS = 60 * 60 * 1000;
const MAX_PROGRESS_UPDATES = 4;

function outputFileName(fileName: string, lang: string): string {
  const base = fileName.replace(/\.[^.]+$/u, "") || "document";
  return `${base}.${lang}.md`;
}

export class Pipeline {
  private readonly lastDoc = new Map<string, IncomingDoc>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly chunkChars: number;
  private readonly supported: readonly string[];

  private readonly deps: PipelineDeps;

  constructor(deps: PipelineDeps) {
    this.deps = { ...deps };
    this.chunkChars = deps.chunkChars ?? DEFAULT_CHUNK_CHARS;
    this.supported = deps.supportedFormats ?? DEFAULT_SUPPORTED;
  }

  /** Registers the document/command handlers on the messenger. */
  attach(): void {
    this.deps.messenger.onDocument((d) => this.handleDocument(d));
    this.deps.messenger.onCommand((c) => this.handleCommand(c));
  }

  /** Per-chat serialization: one chat's work runs in order, different chats run concurrently. */
  private enqueue(chatId: string, work: () => Promise<void>): Promise<void> {
    const prev = this.queues.get(chatId) ?? Promise.resolve();
    const next = prev.then(work, work).finally(() => {
      if (this.queues.get(chatId) === next) this.queues.delete(chatId);
    });
    this.queues.set(chatId, next);
    return next;
  }

  handleDocument(doc: IncomingDoc): Promise<void> {
    if (!this.canSubmit(doc.chatId, doc.userId)) {
      this.deny("document", doc.chatId, doc.userId);
      return Promise.resolve();
    }
    return this.enqueue(doc.chatId, () =>
      this.guarded(doc.chatId, () => this.processDocument(doc, "auto")),
    );
  }

  handleCommand(cmd: IncomingCommand): Promise<void> {
    if (!this.commandAllowed(cmd)) {
      this.deny(cmd.name, cmd.chatId, cmd.userId);
      return Promise.resolve();
    }
    return this.enqueue(cmd.chatId, () => this.guarded(cmd.chatId, () => this.processCommand(cmd)));
  }

  // ---- access control (R1): default deny, silent ----

  private isOwner(userId: string | undefined): boolean {
    const owner = this.deps.settings.get().access.ownerUserId;
    return owner !== undefined && userId !== undefined && userId === owner;
  }

  /** Documents and re-runs: allowed chat, or the owner anywhere. */
  private canSubmit(chatId: string, userId: string | undefined): boolean {
    return this.deps.settings.get().access.allowedChatIds.includes(chatId) || this.isOwner(userId);
  }

  private commandAllowed(cmd: IncomingCommand): boolean {
    switch (cmd.name) {
      case "start":
        return true; // pairing is validated by the code itself
      case "full":
      case "summary":
        return this.canSubmit(cmd.chatId, cmd.userId);
      case "mode":
      case "lang":
      case "allow":
      case "deny":
        return this.isOwner(cmd.userId);
    }
  }

  private deny(kind: string, chatId: string, userId: string | undefined): void {
    this.deps.logger.warn("access.denied", { kind, chatId, userId: userId ?? "-" });
  }

  // ---- rate and budget limits (R2): in-memory metadata counters ----

  private readonly recentByChat = new Map<string, number[]>();
  private dailyKey = "";
  private dailyChars = 0;

  /** Records one document/re-run for the chat; false when the hourly limit is exceeded. */
  private takeChatSlot(chatId: string): boolean {
    const now = this.deps.clock.now();
    const recent = (this.recentByChat.get(chatId) ?? []).filter((t) => now - t < HOUR_MS);
    const limit = this.deps.settings.get().limits.docsPerChatPerHour;
    if (recent.length >= limit) {
      this.recentByChat.set(chatId, recent);
      return false;
    }
    recent.push(now);
    this.recentByChat.set(chatId, recent);
    return true;
  }

  /** Charges `chars` against today's global budget; false (and no charge) when it would exceed it. */
  private chargeDaily(chars: number): boolean {
    const key = new Date(this.deps.clock.now()).toISOString().slice(0, 10);
    if (key !== this.dailyKey) {
      this.dailyKey = key;
      this.dailyChars = 0;
    }
    if (this.dailyChars + chars > this.deps.settings.get().limits.dailyChars) return false;
    this.dailyChars += chars;
    return true;
  }

  /** Test/introspection hook: today's charged characters. */
  dailyCharsUsed(): number {
    return this.dailyChars;
  }

  private async guarded(chatId: string, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (e) {
      this.deps.logger.error("pipeline.unhandled", {
        chatId,
        error: e instanceof Error ? e.name : "unknown",
      });
      const phrases = this.deps.phrasesFor(this.deps.settings.get().nativeLang);
      await this.post(chatId, phrases.unknownError());
    }
  }

  private post(chatId: string, text: string, replyTo?: string): Promise<void> {
    return this.deps.messenger.postText(chatId, text, replyTo);
  }

  // ---- documents ----

  private async processDocument(doc: IncomingDoc, request: PlanRequest): Promise<void> {
    const started = this.deps.clock.now();
    const config = this.deps.settings.get();
    const phrases = this.deps.phrasesFor(config.nativeLang);
    const { chatId, messageId, fileName, mime, sizeBytes } = doc;
    const log = { chatId, fileName, mime, sizeBytes, request };
    this.deps.logger.info("doc.received", log);

    // 1. Pre-download guards (format, bytes)
    const extractor = this.deps.extractors.find((x) => x.supports(mime, fileName));
    const preDecision = decidePlan({
      ...this.planBase(config, 0, false, request),
      supported: extractor !== undefined,
      sizeBytes,
      maxBytes: this.deps.maxBytes,
    });
    if (preDecision.kind === "reject") {
      await this.execute(
        chatId,
        messageId,
        this.rejectPlan(preDecision, phrases, fileName, 0, config),
      );
      this.deps.logger.info("doc.rejected", { ...log, reason: preDecision.reason });
      return;
    }
    if (extractor === undefined) return; // unreachable: covered by preDecision
    if (!this.takeChatSlot(chatId)) {
      await this.post(chatId, phrases.rateLimited(config.limits.docsPerChatPerHour), messageId);
      this.deps.logger.warn("doc.rate_limited", { ...log });
      return;
    }

    // 2. Download + extract
    await this.post(chatId, phrases.progressExtracting(fileName), messageId);
    const bytes = await doc.download();
    if (bytes.byteLength > this.deps.maxBytes) {
      await this.execute(
        chatId,
        messageId,
        this.rejectPlan(
          { kind: "reject", reason: "too_large_bytes" },
          phrases,
          fileName,
          0,
          config,
        ),
      );
      this.deps.logger.info("doc.rejected", {
        ...log,
        reason: "too_large_bytes",
        actualBytes: bytes.byteLength,
      });
      return;
    }
    const extracted = await extractor.extract(bytes);
    if (!extracted.ok) {
      const text =
        extracted.error.kind === "empty_text"
          ? phrases.extractEmpty(fileName)
          : extracted.error.kind === "encrypted"
            ? phrases.extractEncrypted(fileName)
            : phrases.extractCorrupt(fileName);
      await this.post(chatId, text, messageId);
      this.deps.logger.info("doc.extract_failed", { ...log, error: extracted.error.kind });
      return;
    }
    const extractedDoc = extracted.value;
    const chars = extractedDoc.text.length; // whitespace included — same measure as what is sent (R2)
    this.lastDoc.set(chatId, doc);

    // 3. Detect language
    const detection = this.deps.detector.detect(extractedDoc.text);
    const same = isConfidentlySameLanguage(detection, config.nativeLang);
    const hint = sourceLangHint(detection);

    // 4. Plan
    const decision = decidePlan({ ...this.planBase(config, chars, same, request) });
    this.deps.logger.info("doc.planned", {
      ...log,
      chars,
      detectedLang: detection.lang,
      confidence: detection.confidence,
      plan: decision.kind,
    });
    let plan: OutputPlan;
    switch (decision.kind) {
      case "reject":
        plan = this.rejectPlan(decision, phrases, fileName, chars, config);
        break;
      case "skip_same_lang":
        plan = { kind: "skip_same_lang", note: phrases.skipSameLang(config.nativeLang) };
        break;
      case "inline_full":
      case "summary_plus_file":
      case "file_full": {
        const built = await this.translatePlan(
          decision.kind,
          chatId,
          messageId,
          extractedDoc,
          config,
          phrases,
          hint,
          fileName,
        );
        if (built === undefined) return; // failure already reported
        plan = built;
        break;
      }
    }

    // 7. Execute and drop content references
    await this.execute(chatId, messageId, plan);
    this.deps.logger.info("doc.done", {
      ...log,
      plan: plan.kind,
      ms: this.deps.clock.now() - started,
    });
  }

  private planBase(config: Config, charCount: number, sameLanguage: boolean, request: PlanRequest) {
    return {
      charCount,
      sameLanguage,
      mode: config.mode,
      inlineThresholdChars: config.inlineThresholdChars,
      maxChars: config.maxChars,
      request,
    };
  }

  private rejectPlan(
    decision: Extract<PlanDecision, { kind: "reject" }>,
    phrases: Phrases,
    fileName: string,
    chars: number,
    config: Config,
  ): OutputPlan {
    switch (decision.reason) {
      case "unsupported_format":
        return { kind: "reject", reason: phrases.rejectUnsupported(fileName, this.supported) };
      case "too_large_bytes":
        return { kind: "reject", reason: phrases.rejectTooLarge(0, this.deps.maxBytes) };
      case "over_max_chars":
        return {
          kind: "reject",
          reason: phrases.rejectOverMax(chars, config.maxChars),
        };
    }
  }

  /** Steps 5-6: chunk, translate with one retry per chunk, optionally summarize, build the plan. */
  private async translatePlan(
    kind: "inline_full" | "summary_plus_file" | "file_full",
    chatId: string,
    messageId: string,
    doc: ExtractedDoc,
    config: Config,
    phrases: Phrases,
    hint: string | undefined,
    fileName: string,
  ): Promise<OutputPlan | undefined> {
    const chunks = chunkDocument(doc, this.chunkChars);
    const total = chunks.length;
    if (total > (this.deps.maxChunksPerDoc ?? DEFAULT_MAX_CHUNKS_PER_DOC)) {
      await this.post(chatId, phrases.rejectOverMax(doc.text.length, config.maxChars), messageId);
      this.deps.logger.warn("doc.too_many_chunks", { chatId, fileName, chunks: total });
      return undefined;
    }
    const charge = doc.text.length + (kind === "summary_plus_file" ? doc.text.length : 0);
    if (!this.chargeDaily(charge)) {
      await this.post(chatId, phrases.dailyBudgetExhausted(), messageId);
      this.deps.logger.warn("doc.daily_budget", { chatId, fileName, chars: charge });
      return undefined;
    }
    const translated = [];
    const progressEvery = Math.max(1, Math.ceil(total / MAX_PROGRESS_UPDATES));
    if (total > 1) await this.post(chatId, phrases.progressTranslating(0, total));
    for (const chunk of chunks) {
      const result = await this.translateChunk(chunk, config.nativeLang, hint);
      if (result === undefined) {
        await this.post(chatId, phrases.translationFailed(translated.length, total), messageId);
        this.deps.logger.warn("doc.translate_failed", {
          chatId,
          fileName,
          done: translated.length,
          total,
        });
        return undefined;
      }
      translated.push(result);
      if (total > 1 && translated.length < total && translated.length % progressEvery === 0) {
        await this.post(chatId, phrases.progressTranslating(translated.length, total));
      }
    }
    const fullText = assembleChunks(translated, total);
    const file = { name: outputFileName(fileName, config.nativeLang), content: fullText };

    if (kind === "inline_full") return { kind, parts: [fullText] };
    if (kind === "file_full") return { kind, note: phrases.fileFullNote(fileName), file };

    await this.post(chatId, phrases.progressSummarizing());
    try {
      const summary = await this.deps.translator.summarize(doc, config.nativeLang);
      return { kind: "summary_plus_file", summary, file };
    } catch (e) {
      this.deps.logger.warn("doc.summary_failed", {
        chatId,
        fileName,
        error: e instanceof Error ? e.name : "unknown",
      });
      await this.post(chatId, phrases.summaryFailed(), messageId);
      return undefined;
    }
  }

  private async translateChunk(
    chunk: Chunk,
    to: string,
    hint: string | undefined,
  ): Promise<{ index: number; text: string } | undefined> {
    const opts = hint === undefined ? {} : { sourceLangHint: hint };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const [result] = await this.deps.translator.translate([chunk], to, opts);
        if (result === undefined) throw new ProviderError("bad_response", true, undefined, "empty");
        return { index: chunk.index, text: result.text };
      } catch (e) {
        const retryable = e instanceof ProviderError ? e.retryable : false;
        this.deps.logger.warn("chunk.failed", {
          index: chunk.index,
          attempt,
          error: e instanceof ProviderError ? e.kind : e instanceof Error ? e.name : "unknown",
          retryable,
        });
        if (!retryable) return undefined;
      }
    }
    return undefined;
  }

  /** Step 7 — posts only to the originating chat (guardrail 2). */
  private async execute(chatId: string, messageId: string, plan: OutputPlan): Promise<void> {
    const m = this.deps.messenger;
    const config = this.deps.settings.get();
    const phrases = this.deps.phrasesFor(config.nativeLang);
    switch (plan.kind) {
      case "inline_full":
        for (const part of plan.parts) await m.postText(chatId, part, messageId);
        return;
      case "summary_plus_file":
        await m.postText(chatId, plan.summary, messageId);
        await m.postFile(
          chatId,
          plan.file.name,
          new TextEncoder().encode(plan.file.content),
          phrases.fileCaption(plan.file.name, config.nativeLang),
        );
        return;
      case "file_full":
        await m.postText(chatId, plan.note, messageId);
        await m.postFile(
          chatId,
          plan.file.name,
          new TextEncoder().encode(plan.file.content),
          phrases.fileCaption(plan.file.name, config.nativeLang),
        );
        return;
      case "skip_same_lang":
        await m.postText(chatId, plan.note, messageId);
        return;
      case "reject":
        await m.postText(chatId, plan.reason, messageId);
        return;
    }
  }

  // ---- commands ----

  private async processCommand(cmd: IncomingCommand): Promise<void> {
    const config = this.deps.settings.get();
    const phrases = this.deps.phrasesFor(config.nativeLang);
    this.deps.logger.info("cmd.received", {
      chatId: cmd.chatId,
      name: cmd.name,
      hasArg: cmd.arg !== undefined,
    });
    switch (cmd.name) {
      case "start": {
        await this.pair(cmd, config, phrases);
        return;
      }
      case "allow":
      case "deny": {
        const current = config.access.allowedChatIds;
        const next =
          cmd.name === "allow"
            ? current.includes(cmd.chatId)
              ? current
              : [...current, cmd.chatId]
            : current.filter((id) => id !== cmd.chatId);
        await this.deps.settings.set({
          ...config,
          access: { ...config.access, allowedChatIds: next },
        });
        this.deps.logger.info("access.changed", {
          action: cmd.name,
          chatId: cmd.chatId,
          allowedCount: next.length,
        });
        await this.post(
          cmd.chatId,
          cmd.name === "allow" ? phrases.chatAllowed() : phrases.chatDenied(),
        );
        return;
      }
      case "full":
      case "summary": {
        const doc = this.lastDoc.get(cmd.chatId);
        if (doc === undefined) {
          await this.post(cmd.chatId, phrases.noLastDocument());
          return;
        }
        await this.processDocument(doc, cmd.name);
        return;
      }
      case "mode": {
        const mode = OUTPUT_MODES.find((m) => m === cmd.arg?.trim().toLowerCase());
        if (mode === undefined) {
          await this.post(cmd.chatId, phrases.modeInvalid(cmd.arg, OUTPUT_MODES));
          return;
        }
        await this.deps.settings.set({ ...config, mode });
        await this.post(cmd.chatId, phrases.modeChanged(mode));
        return;
      }
      case "lang": {
        const info = cmd.arg === undefined ? undefined : canonicalLangCode(cmd.arg);
        if (info === undefined) {
          await this.post(cmd.chatId, phrases.langInvalid(cmd.arg));
          return;
        }
        await this.deps.settings.set({ ...config, nativeLang: info.code });
        await this.post(cmd.chatId, this.deps.phrasesFor(info.code).langChanged(info.code));
        return;
      }
    }
  }

  /** `/start <code>`: registers the sender as owner (once) and allows the chat. Wrong or absent code is ignored. */
  private async pair(cmd: IncomingCommand, config: Config, phrases: Phrases): Promise<void> {
    if (config.access.ownerUserId !== undefined) {
      if (this.isOwner(cmd.userId)) await this.post(cmd.chatId, phrases.paired());
      else this.deny("start", cmd.chatId, cmd.userId);
      return;
    }
    const code = this.deps.pairingCode;
    if (code === undefined || cmd.userId === undefined || cmd.arg?.trim() !== code) {
      this.deny("start", cmd.chatId, cmd.userId);
      return;
    }
    const allowed = config.access.allowedChatIds.includes(cmd.chatId)
      ? config.access.allowedChatIds
      : [...config.access.allowedChatIds, cmd.chatId];
    await this.deps.settings.set({
      ...config,
      access: { ownerUserId: cmd.userId, allowedChatIds: allowed },
    });
    delete this.deps.pairingCode; // single use
    this.deps.logger.info("access.paired", { chatId: cmd.chatId, userId: cmd.userId });
    await this.post(cmd.chatId, phrases.paired());
  }

  /** Test/introspection hook: metadata of the last document per chat (never content). */
  lastDocumentMeta(
    chatId: string,
  ): { fileName: string; sizeBytes: number; messageId: string } | undefined {
    const d = this.lastDoc.get(chatId);
    return d === undefined
      ? undefined
      : { fileName: d.fileName, sizeBytes: d.sizeBytes, messageId: d.messageId };
  }
}

export type { OutputMode };
