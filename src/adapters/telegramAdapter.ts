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
  { command: "full", description: "마지막 문서 전문 번역을 파일로" },
  { command: "summary", description: "마지막 문서 요약 다시" },
  { command: "mode", description: "출력 모드 변경: smart | full | summary" },
  { command: "lang", description: "모국어 변경 (예: /lang ko)" },
  { command: "allow", description: "(소유자) 이 대화방 허용" },
  { command: "deny", description: "(소유자) 이 대화방 허용 해제" },
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
  /** Called when long polling stops because of an error. */
  onError?: (error: unknown) => void;
}

type DocHandler = (d: IncomingDoc) => Promise<void>;
type CmdHandler = (c: IncomingCommand) => Promise<void>;

export class TelegramAdapter implements MessengerAdapter {
  readonly bot: Bot;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxBytes: number;
  private readonly downloadTimeoutMs: number;
  private readonly onError: ((e: unknown) => void) | undefined;
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

    this.bot.command([...COMMAND_NAMES], async (ctx) => {
      const name = ctx.message?.text.slice(1).split(/[\s@]/u)[0] as CommandName | undefined;
      if (name === undefined || !COMMAND_NAMES.includes(name)) return;
      const arg =
        typeof ctx.match === "string" && ctx.match.trim() !== "" ? ctx.match.trim() : undefined;
      const userId = ctx.from === undefined ? undefined : String(ctx.from.id);
      await this.cmdHandler?.({
        chatId: String(ctx.chat.id),
        ...(userId === undefined ? {} : { userId }),
        name,
        ...(arg === undefined ? {} : { arg }),
      });
    });
    this.bot.on("message:document", async (ctx) => {
      await this.docHandler?.(this.toIncomingDoc(ctx));
    });
    // Metadata-only error reporting — never the update body (guardrail 1).
    this.bot.catch((err) => {
      this.onError?.(err.error);
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
      await this.bot.api.sendMessage(chatId, part, reply);
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

  async start(): Promise<void> {
    await this.bot.api.setMyCommands(
      TELEGRAM_COMMANDS.map((c) => ({ command: c.command, description: c.description })),
    );
    this.polling = this.bot.start().catch((e: unknown) => {
      this.onError?.(e);
    });
  }

  async stop(): Promise<void> {
    await this.bot.stop();
    await this.polling;
    this.polling = undefined;
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
