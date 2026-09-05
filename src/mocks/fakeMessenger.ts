// FakeMessenger — event injection + post recording for tests (TESTING §2). Same split rule as Telegram.
import type { IncomingCommand, IncomingDoc, MessengerAdapter } from "../core/index.js";
import { TELEGRAM_MESSAGE_LIMIT, splitForMessenger } from "../core/index.js";

export type FakePost =
  | { kind: "text"; chatId: string; text: string; replyTo?: string }
  | { kind: "file"; chatId: string; name: string; content: Uint8Array; caption?: string };

export interface FakeDocInput {
  chatId: string;
  messageId?: string;
  fileName: string;
  /** Sender; defaults to "owner" so existing tests run as the paired owner. */
  userId?: string;
  mime?: string;
  bytes?: Uint8Array;
  /** Override the reported size (e.g. 21 MB without allocating it). */
  sizeBytes?: number;
}

export class FakeMessenger implements MessengerAdapter {
  readonly posts: FakePost[] = [];
  readonly downloads: string[] = [];
  started = false;
  stopped = false;
  private docHandler: ((d: IncomingDoc) => Promise<void>) | undefined;
  private cmdHandler: ((c: IncomingCommand) => Promise<void>) | undefined;
  private seq = 0;

  constructor(private readonly limit: number = TELEGRAM_MESSAGE_LIMIT) {}

  onDocument(h: (d: IncomingDoc) => Promise<void>): void {
    this.docHandler = h;
  }
  onCommand(h: (c: IncomingCommand) => Promise<void>): void {
    this.cmdHandler = h;
  }

  postText(chatId: string, text: string, replyTo?: string): Promise<void> {
    for (const [i, part] of splitForMessenger(text, this.limit).entries()) {
      const reply = i === 0 && replyTo !== undefined ? { replyTo } : {};
      this.posts.push({ kind: "text", chatId, text: part, ...reply });
    }
    return Promise.resolve();
  }

  postFile(chatId: string, name: string, content: Uint8Array, caption?: string): Promise<void> {
    this.posts.push({
      kind: "file",
      chatId,
      name,
      content,
      ...(caption === undefined ? {} : { caption }),
    });
    return Promise.resolve();
  }

  start(): Promise<void> {
    this.started = true;
    return Promise.resolve();
  }
  stop(): Promise<void> {
    this.stopped = true;
    return Promise.resolve();
  }

  /** Builds the IncomingDoc and delivers it to the registered handler (awaits processing). */
  async emitDocument(input: FakeDocInput): Promise<IncomingDoc> {
    const bytes = input.bytes ?? new Uint8Array();
    const messageId = input.messageId ?? String(++this.seq);
    const doc: IncomingDoc = {
      chatId: input.chatId,
      messageId,
      userId: input.userId ?? "owner",
      fileName: input.fileName,
      mime: input.mime ?? "application/octet-stream",
      sizeBytes: input.sizeBytes ?? bytes.byteLength,
      download: () => {
        this.downloads.push(messageId);
        return Promise.resolve(bytes);
      },
    };
    if (this.docHandler === undefined) throw new Error("no document handler registered");
    await this.docHandler(doc);
    return doc;
  }

  async emitCommand(cmd: IncomingCommand): Promise<void> {
    if (this.cmdHandler === undefined) throw new Error("no command handler registered");
    await this.cmdHandler({ userId: "owner", ...cmd });
  }

  /** Text posts for one chat, in order. */
  textsFor(chatId: string): string[] {
    return this.posts
      .filter(
        (p): p is Extract<FakePost, { kind: "text" }> => p.kind === "text" && p.chatId === chatId,
      )
      .map((p) => p.text);
  }
  filesFor(chatId: string): Extract<FakePost, { kind: "file" }>[] {
    return this.posts.filter(
      (p): p is Extract<FakePost, { kind: "file" }> => p.kind === "file" && p.chatId === chatId,
    );
  }
}
