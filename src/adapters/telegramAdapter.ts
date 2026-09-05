// Telegram adapter — grammY long polling. The core never sees grammY types (DESIGN §1/§4).
import { Bot, InputFile } from "grammy";
import type { Context, Transformer } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { CommandName, IncomingCommand, IncomingDoc, MessengerAdapter } from "../core/index.js";
import { TELEGRAM_MESSAGE_LIMIT, splitForMessenger } from "../core/index.js";

/** Bot API getFile limit — larger files are never downloaded (SPEC §5). */
export const TELEGRAM_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;
export const TELEGRAM_COMMANDS: readonly { command: CommandName; description: string }[] = [
  { command: "full", description: "Full translation of the last document as a file" },
  { command: "summary", description: "Summarize the last document again" },
  { command: "mode", description: "Set output mode: smart | full | summary" },
  { command: "lang", description: "Set native language (e.g. /lang ko)" },
  { command: "allow", description: "(owner) Allow this chat" },
  { command: "deny", description: "(owner) Revoke this chat" },
];
const COMMAND_NAMES: readonly CommandName[] = [
  "start",
  "full",
  "summary",
  "mode",
  "lang",
  "allow",
  "deny",
];

export interface TelegramAdapterOptions {
  token: string;
  /** Skip the getMe call (tests). */
  botInfo?: UserFromGetMe;
  /** Used for file downloads (tests inject a mock). */
  fetch?: typeof fetch;
  /** Intercepts Bot API calls (tests). */
  apiTransformer?: Transformer;
  maxDownloadBytes?: number;
  /** Whole-download deadline (getFile + body). Default 60 s. */
  downloadTimeoutMs?: number;
  /** Handler errors (fatal=false) and unexpected polling termination after start (fatal=true). */
  onError?: (error: unknown, fatal: boolean) => void;
}

type DocHandler = (d: IncomingDoc) => Promise<void>;
type CmdHandler = (c: IncomingCommand) => Promise<void>;

export class TelegramAdapter implements MessengerAdapter {
  readonly bot: Bot;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxBytes: number;
  private readonly downloadTimeoutMs: number;
  private readonly onError: ((e: unknown, fatal: boolean) => void) | undefined;
  private readonly inFlight = new Set<Promise<void>>();
  private docHandler: DocHandler | undefined;
  private cmdHandler: CmdHandler | undefined;
  private polling: Promise<void> | undefined;

  constructor(opts: TelegramAdapterOptions) {
    this.token = opts.token;
    this.fetchImpl = opts.fetch ?? fetch;
    this.maxBytes = opts.maxDownloadBytes ?? TELEGRAM_MAX_DOWNLOAD_BYTES;
    this.downloadTimeoutMs = opts.downloadTimeoutMs ?? DOWNLOAD_TIMEOUT_MS;
    this.onError = opts.onError;
    this.bot = new Bot(opts.token, opts.botInfo === undefined ? {} : { botInfo: opts.botInfo });
    if (opts.apiTransformer !== undefined) this.bot.api.config.use(opts.apiTransformer);

    this.bot.command([...COMMAND_NAMES], (ctx) => {
      const name = ctx.message?.text.slice(1).split(/[\s@]/u)[0] as CommandName | undefined;
      if (name === undefined || !COMMAND_NAMES.includes(name)) return;
      const arg =
        typeof ctx.match === "string" && ctx.match.trim() !== "" ? ctx.match.trim() : undefined;
      const userId = ctx.from === undefined ? undefined : String(ctx.from.id);
      const cmd = {
        chatId: String(ctx.chat.id),
        ...(userId === undefined ? {} : { userId }),
        name,
        ...(arg === undefined ? {} : { arg }),
      };
      this.dispatch(() => this.cmdHandler?.(cmd) ?? Promise.resolve());
    });
    this.bot.on("message:document", (ctx) => {
      const doc = this.toIncomingDoc(ctx);
      this.dispatch(() => this.docHandler?.(doc) ?? Promise.resolve());
    });
    // Metadata-only error reporting — never the update body (guardrail 1).
    this.bot.catch((err) => {
      this.onError?.(err.error, false);
    });
  }

  private toIncomingDoc(ctx: Context): IncomingDoc {
    const msg = ctx.message;
    const doc = msg?.document;
    if (msg === undefined || doc === undefined) throw new Error("not a document message");
    const sizeBytes = doc.file_size ?? 0;
    const maxBytes = this.maxBytes;
    const fetchImpl = this.fetchImpl;
    const token = this.token;
    const timeoutMs = this.downloadTimeoutMs;
    const userId = String(msg.from.id);
    return {
      chatId: String(msg.chat.id),
      messageId: String(msg.message_id),
      userId,
      fileName: doc.file_name ?? "document",
      mime: doc.mime_type ?? "application/octet-stream",
      sizeBytes,
      async download(): Promise<Uint8Array> {
        if (sizeBytes > maxBytes) {
          throw new RangeError(
            `file exceeds download limit (${String(sizeBytes)} > ${String(maxBytes)} bytes)`,
          );
        }
        const signal = AbortSignal.timeout(timeoutMs);
        const file = await ctx.api.getFile(doc.file_id);
        if (file.file_path === undefined) throw new Error("telegram returned no file_path");
        if (file.file_size !== undefined && file.file_size > maxBytes) {
          throw new RangeError(
            `file exceeds download limit (${String(file.file_size)} > ${String(maxBytes)} bytes)`,
          );
        }
        const res = await fetchImpl(`https://api.telegram.org/file/bot${token}/${file.file_path}`, {
          signal,
        });
        if (!res.ok) throw new Error(`file download failed: http ${String(res.status)}`);
        return readCapped(res, maxBytes);
      },
    };
  }

  onDocument(h: DocHandler): void {
    this.docHandler = h;
  }

  onCommand(h: CmdHandler): void {
    this.cmdHandler = h;
  }

  async postText(chatId: string, text: string, replyTo?: string): Promise<void> {
    const parts = splitForMessenger(text, TELEGRAM_MESSAGE_LIMIT);
    for (const [i, part] of parts.entries()) {
      // Only the first part replies to the source message; the rest follow in order.
      const reply =
        i === 0 && replyTo !== undefined
          ? { reply_parameters: { message_id: Number(replyTo) } }
          : {};
      // SEC-11: never let Telegram fetch previews for URLs that came from the document or the model.
      await this.bot.api.sendMessage(chatId, part, {
        ...reply,
        link_preview_options: { is_disabled: true },
      });
    }
  }

  async postFile(
    chatId: string,
    name: string,
    content: Uint8Array,
    caption?: string,
  ): Promise<void> {
    await this.bot.api.sendDocument(
      chatId,
      new InputFile(content, name),
      caption === undefined ? {} : { caption },
    );
  }

  /** Runs a handler without blocking grammY's sequential update loop; tracked so stop() can wait. */
  private dispatch(run: () => Promise<void>): void {
    const p = run()
      .catch((e: unknown) => {
        this.onError?.(e, false);
      })
      .finally(() => {
        this.inFlight.delete(p);
      });
    this.inFlight.add(p);
  }

  /** Number of handlers still running. */
  pending(): number {
    return this.inFlight.size;
  }

  /** Resolves when every dispatched handler has finished. */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
  }

  /**
   * Resolves once the bot is initialized (getMe) and polling is actually running; rejects on any
   * initialization failure. A polling failure after that point is reported via onError(e, true).
   */
  async start(): Promise<void> {
    await this.bot.init();
    await this.bot.api.setMyCommands(
      TELEGRAM_COMMANDS.map((c) => ({ command: c.command, description: c.description })),
    );
    let ready!: () => void;
    const readyPromise = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let started = false;
    const polling = this.bot.start({
      onStart: () => {
        started = true;
        ready();
      },
    });
    const lifecycle = polling.then(
      () => undefined,
      (e: unknown) => {
        if (started) this.onError?.(e, true);
        throw e;
      },
    );
    // Either polling is up, or it failed before becoming ready (rejects start()).
    await Promise.race([readyPromise, lifecycle]);
    this.polling = lifecycle.catch(() => undefined);
  }

  async stop(): Promise<void> {
    await this.bot.stop();
    await this.polling;
    this.polling = undefined;
    await this.drain();
  }
}

/** Reads a response body while enforcing `maxBytes`; cancels the stream as soon as the cap is exceeded. */
export async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    await res.body?.cancel();
    throw new RangeError(
      `file exceeds download limit (${String(declared)} > ${String(maxBytes)} bytes)`,
    );
  }
  if (res.body === null) return new Uint8Array(await res.arrayBuffer());
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new RangeError(`file exceeds download limit (> ${String(maxBytes)} bytes)`);
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}
