// Core interfaces — DESIGN §2. The core knows nothing about grammY, pdf-parse, or any provider SDK.
import type { Result } from "./result.js";

export type CommandName = "start" | "full" | "summary" | "mode" | "lang" | "allow" | "deny";
export type OutputMode = "smart" | "full" | "summary";

export interface IncomingDoc {
  chatId: string;
  messageId: string;
  /** Sender user id; undefined for anonymous/channel posts (treated as not the owner). */
  userId?: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  download(): Promise<Uint8Array>;
}

export interface IncomingCommand {
  chatId: string;
  userId?: string;
  name: CommandName;
  arg?: string;
}

export interface MessengerAdapter {
  onDocument(h: (d: IncomingDoc) => Promise<void>): void;
  onCommand(h: (c: IncomingCommand) => Promise<void>): void;
  /** Splitting to the platform's length limit is the adapter's responsibility. */
  postText(chatId: string, text: string, replyTo?: string): Promise<void>;
  postFile(chatId: string, name: string, content: Uint8Array, caption?: string): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** A structural unit recovered by an extractor (heading + paragraphs). */
export interface Section {
  title?: string;
  /** Heading level 1–6 (default 1). */
  level?: number;
  text: string;
}

/** Extracted document with its structure preserved. */
export interface ExtractedDoc {
  text: string;
  sections: Section[];
}

export type ExtractError =
  /** No text layer (scanned document) — OCR arrives in v0.2. */
  | { kind: "empty_text" }
  /** Password-protected PDF. */
  | { kind: "encrypted" }
  /** Parser failure. `detail` is the library error name only — never document content. */
  | { kind: "corrupt"; detail: string };

export interface DocumentExtractor {
  supports(mime: string, name: string): boolean;
  extract(bytes: Uint8Array): Promise<Result<ExtractedDoc, ExtractError>>;
}

/** Chunker output. `index` is the assembly order. */
export interface Chunk {
  index: number;
  sectionIndex: number;
  text: string;
  /** Separator that preceded this chunk inside its section ("" for the first chunk of a section). */
  sep: string;
}

/** Provider output. Reassembled by `index`. */
export interface TranslatedChunk {
  index: number;
  text: string;
}

export interface LanguageDetection {
  lang: string;
  confidence: number;
}

export interface LanguageDetector {
  detect(text: string): LanguageDetection;
}

export interface TranslateOptions {
  sourceLangHint?: string;
  /** Called after each chunk completes — drives the "Translating… n/m" progress message. */
  onProgress?: (done: number, total: number) => void;
}

export type ProviderErrorKind =
  "auth" | "rate_limit" | "server" | "network" | "bad_response" | "refusal" | "unknown";

/** Thrown by providers. `detail` carries an error name or code only — never document content. */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly retryable: boolean;
  readonly status: number | undefined;
  readonly detail: string | undefined;
  constructor(kind: ProviderErrorKind, retryable: boolean, status?: number, detail?: string) {
    super(`provider ${kind}${status === undefined ? "" : ` (${String(status)})`}`);
    this.name = "ProviderError";
    this.kind = kind;
    this.retryable = retryable;
    this.status = status;
    this.detail = detail;
  }
}

export interface TranslatorProvider {
  translate(chunks: Chunk[], to: string, opts: TranslateOptions): Promise<TranslatedChunk[]>;
  /** Structured summary (title, key clauses, figures, requests) — SPEC §4. */
  summarize(doc: ExtractedDoc, to: string): Promise<string>;
  /** One cheap call to confirm the credential works (onboarding). Must not spend tokens. */
  verify(): Promise<Result<void, ProviderError>>;
}

export interface PlanFile {
  name: string;
  content: string;
}

export type OutputPlan =
  /** Short document: full translation posted inline (adapter splits). */
  | { kind: "inline_full"; parts: string[] }
  /** Long document in smart/summary mode: summary inline + full translation as a file. */
  | { kind: "summary_plus_file"; summary: string; file: PlanFile }
  /** Long document in full mode, or `/full`: short note inline + full translation as a file. */
  | { kind: "file_full"; note: string; file: PlanFile }
  /** Detected language equals the native language. */
  | { kind: "skip_same_lang"; note: string }
  /** Over the limits, unsupported format, etc. */
  | { kind: "reject"; reason: string };

export type OutputPlanKind = OutputPlan["kind"];
