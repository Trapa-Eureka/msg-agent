import { describe, expect, it } from "vitest";
import type { Transformer } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import {
  TELEGRAM_MAX_DOWNLOAD_BYTES,
  TelegramAdapter,
  readCapped,
} from "../src/adapters/telegramAdapter.js";
import type { IncomingCommand, IncomingDoc } from "../src/core/index.js";

const botInfo: UserFromGetMe = {
  id: 42,
  is_bot: true,
  first_name: "message",
  username: "message_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

interface ApiCall {
  method: string;
  payload: unknown;
}

/** Records Bot API calls and answers them without any HTTP. */
function apiRecorder(): { transformer: Transformer; calls: ApiCall[] } {
  const calls: ApiCall[] = [];
  const transformer: Transformer = (_prev, method, payload) => {
    calls.push({ method, payload });
    const result: unknown =
      method === "getUpdates"
        ? []
        : method === "getFile"
          ? { file_id: "f1", file_unique_id: "u1", file_size: 3, file_path: "documents/file_1.pdf" }
          : method === "sendMessage" || method === "sendDocument"
            ? {
                message_id: 100 + calls.length,
                date: 0,
                chat: { id: 1, type: "private" },
                text: "",
              }
            : true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Promise.resolve({ ok: true, result } as any);
  };
  return { transformer, calls };
}

let updateId = 1;
function documentUpdate(o: {
  chatId: number;
  sizeBytes: number;
  name?: string;
  mime?: string;
}): Update {
  return {
    update_id: updateId++,
    message: {
      message_id: 7,
      date: 0,
      chat: { id: o.chatId, type: "private", first_name: "u" },
      from: { id: 5, is_bot: false, first_name: "u" },
      document: {
        file_id: "doc-file-id",
        file_unique_id: "uq",
        file_size: o.sizeBytes,
        file_name: o.name ?? "contract.pdf",
        mime_type: o.mime ?? "application/pdf",
      },
    },
  };
}
function commandUpdate(text: string, chatId = 1): Update {
  return {
    update_id: updateId++,
    message: {
      message_id: 8,
      date: 0,
      chat: { id: chatId, type: "private", first_name: "u" },
      from: { id: 5, is_bot: false, first_name: "u" },
      text,
      entities: [
        { type: "bot_command", offset: 0, length: text.split(" ")[0]?.length ?? text.length },
      ],
    },
  };
}

function makeAdapter(fetchImpl?: typeof fetch, maxDownloadBytes?: number) {
  const api = apiRecorder();
  const adapter = new TelegramAdapter({
    token: "123:TOKEN",
    botInfo,
    apiTransformer: api.transformer,
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
    ...(maxDownloadBytes === undefined ? {} : { maxDownloadBytes }),
  });
  return { adapter, api };
}

describe("TelegramAdapter", () => {
  it("maps a document update to IncomingDoc metadata without downloading", async () => {
    const { adapter, api } = makeAdapter();
    const docs: IncomingDoc[] = [];
    adapter.onDocument((d) => {
      docs.push(d);
      return Promise.resolve();
    });
    await adapter.bot.handleUpdate(documentUpdate({ chatId: -100123, sizeBytes: 1234 }));
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      chatId: "-100123",
      messageId: "7",
      userId: "5",
      fileName: "contract.pdf",
      mime: "application/pdf",
      sizeBytes: 1234,
    });
    expect(api.calls).toEqual([]); // no getFile until download()
  });

  it("downloads via getFile + file URL using the injected fetch", async () => {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = (input) => {
      urls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
    };
    const { adapter, api } = makeAdapter(fetchImpl);
    let doc: IncomingDoc | undefined;
    adapter.onDocument((d) => {
      doc = d;
      return Promise.resolve();
    });
    await adapter.bot.handleUpdate(documentUpdate({ chatId: 1, sizeBytes: 3 }));
    expect(await doc?.download()).toEqual(new Uint8Array([1, 2, 3]));
    expect(api.calls).toEqual([{ method: "getFile", payload: { file_id: "doc-file-id" } }]);
    expect(urls).toEqual(["https://api.telegram.org/file/bot123:TOKEN/documents/file_1.pdf"]);
  });

  it("refuses to download files over 20 MB without calling getFile", async () => {
    const fetchImpl: typeof fetch = () => Promise.reject(new Error("must not fetch"));
    const { adapter, api } = makeAdapter(fetchImpl);
    let doc: IncomingDoc | undefined;
    adapter.onDocument((d) => {
      doc = d;
      return Promise.resolve();
    });
    await adapter.bot.handleUpdate(
      documentUpdate({ chatId: 1, sizeBytes: TELEGRAM_MAX_DOWNLOAD_BYTES + 1 }),
    );
    expect(doc?.sizeBytes).toBe(TELEGRAM_MAX_DOWNLOAD_BYTES + 1);
    await expect(doc?.download()).rejects.toThrow(/exceeds download limit/);
    expect(api.calls).toEqual([]);
  });

  it("caps the actual download: oversized getFile size, content-length, or body stream all fail (SEC-08)", async () => {
    // 1) getFile reports a size above the limit -> no fetch at all
    const calls: string[] = [];
    const adapter1 = new TelegramAdapter({
      token: "t",
      botInfo,
      maxDownloadBytes: 8,
      apiTransformer: (_prev, method) => {
        return Promise.resolve({
          ok: true,
          result:
            method === "getFile"
              ? { file_id: "f", file_unique_id: "u", file_size: 32, file_path: "p" }
              : true,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
      },
      fetch: (i) => {
        calls.push(typeof i === "string" ? i : i instanceof URL ? i.href : i.url);
        return Promise.resolve(new Response(new Uint8Array(32)));
      },
    });
    let doc1: IncomingDoc | undefined;
    adapter1.onDocument((d) => {
      doc1 = d;
      return Promise.resolve();
    });
    await adapter1.bot.handleUpdate(documentUpdate({ chatId: 1, sizeBytes: 0 })); // metadata missing -> 0
    await expect(doc1?.download()).rejects.toThrow(/exceeds download limit/);
    expect(calls).toEqual([]);

    // 2) body stream longer than the limit -> rejected while streaming, without buffering everything
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 8; i++) c.enqueue(new Uint8Array(4));
        c.close();
      },
    });
    await expect(readCapped(new Response(stream), 8)).rejects.toThrow(/exceeds download limit/);

    // 3) content-length above the limit -> rejected before reading
    const declared = new Response(new Uint8Array(4), { headers: { "content-length": "999" } });
    await expect(readCapped(declared, 8)).rejects.toThrow(/999/);

    // 4) within the limit -> full bytes
    expect(await readCapped(new Response(new Uint8Array([1, 2, 3])), 8)).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("routes the four commands with optional arguments, ignoring others", async () => {
    const { adapter } = makeAdapter();
    const cmds: IncomingCommand[] = [];
    adapter.onCommand((c) => {
      cmds.push(c);
      return Promise.resolve();
    });
    for (const t of [
      "/full",
      "/summary",
      "/mode full",
      "/lang ko",
      "/lang@message_bot ja",
      "/start 123456",
      "/allow",
      "/help",
      "hello",
    ]) {
      await adapter.bot.handleUpdate(commandUpdate(t, 9));
    }
    expect(cmds).toEqual([
      { chatId: "9", userId: "5", name: "full" },
      { chatId: "9", userId: "5", name: "summary" },
      { chatId: "9", userId: "5", name: "mode", arg: "full" },
      { chatId: "9", userId: "5", name: "lang", arg: "ko" },
      { chatId: "9", userId: "5", name: "lang", arg: "ja" },
      { chatId: "9", userId: "5", name: "start", arg: "123456" },
      { chatId: "9", userId: "5", name: "allow" },
    ]);
  });

  it("splits long text into ordered sendMessage calls, replying only with the first part", async () => {
    const { adapter, api } = makeAdapter();
    const text = Array.from(
      { length: 60 },
      (_, i) => `Paragraph ${String(i)} ${"word ".repeat(30).trim()}`,
    ).join("\n\n");
    await adapter.postText("55", text, "7");
    const sends = api.calls.filter((c) => c.method === "sendMessage");
    expect(sends.length).toBeGreaterThan(1);
    const payloads = sends.map(
      (c) =>
        c.payload as { chat_id: string; text: string; reply_parameters?: { message_id: number } },
    );
    expect(payloads.every((p) => p.chat_id === "55" && p.text.length <= 4096)).toBe(true);
    expect(payloads[0]?.reply_parameters).toEqual({ message_id: 7 });
    expect(
      sends.every(
        (c) =>
          (c.payload as { link_preview_options?: { is_disabled?: boolean } }).link_preview_options
            ?.is_disabled === true,
      ),
    ).toBe(true); // SEC-11
    expect(payloads.slice(1).every((p) => p.reply_parameters === undefined)).toBe(true);
    expect(payloads.map((p) => p.text).join("\n\n")).toBe(text);
  });

  it("posts files with sendDocument (InputFile from bytes) and a caption", async () => {
    const { adapter, api } = makeAdapter();
    await adapter.postFile("55", "translation.md", new Uint8Array([104, 105]), "전문 번역");
    const call = api.calls.find((c) => c.method === "sendDocument");
    const payload = call?.payload as {
      chat_id: string;
      caption: string;
      document: { filename?: string };
    };
    expect(payload.chat_id).toBe("55");
    expect(payload.caption).toBe("전문 번역");
    expect(payload.document.filename).toBe("translation.md");
  });

  it("registers command autocompletion on start and stops cleanly", async () => {
    const { adapter, api } = makeAdapter();
    await adapter.start();
    const set = api.calls.find((c) => c.method === "setMyCommands");
    expect(
      (set?.payload as { commands: { command: string }[] }).commands.map((c) => c.command),
    ).toEqual(["full", "summary", "mode", "lang", "allow", "deny"]);
    await adapter.stop();
  });
});

describe("dispatch and lifecycle (R5)", () => {
  it("does not block the update loop: handlers run concurrently and stop() waits for them", async () => {
    const { adapter } = makeAdapter();
    const release: (() => void)[] = [];
    const seen: string[] = [];
    adapter.onDocument((d) => {
      seen.push(d.chatId);
      return new Promise<void>((resolve) => release.push(resolve));
    });
    await adapter.bot.handleUpdate(documentUpdate({ chatId: 1, sizeBytes: 1 }));
    await adapter.bot.handleUpdate(documentUpdate({ chatId: 2, sizeBytes: 1 }));
    // both handlers were invoked although neither has finished (the old code awaited the first one)
    expect(seen).toEqual(["1", "2"]);
    expect(adapter.pending()).toBe(2);
    let drained = false;
    const drain = adapter.drain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    for (const r of release) r();
    await drain;
    expect(adapter.pending()).toBe(0);
  });

  it("reports handler failures through onError without stopping the bot", async () => {
    const errors: [string, boolean][] = [];
    const api = apiRecorder();
    const adapter = new TelegramAdapter({
      token: "t",
      botInfo,
      apiTransformer: api.transformer,
      onError: (e, fatal) => errors.push([e instanceof Error ? e.message : "?", fatal]),
    });
    adapter.onDocument(() => Promise.reject(new Error("handler boom")));
    await adapter.bot.handleUpdate(documentUpdate({ chatId: 1, sizeBytes: 1 }));
    await adapter.drain();
    expect(errors).toEqual([["handler boom", false]]);
  });

  it("start() rejects when polling cannot be initialized (review 05)", async () => {
    const adapter = new TelegramAdapter({
      token: "t",
      botInfo,
      apiTransformer: (_prev, method) =>
        Promise.resolve(
          method === "deleteWebhook"
            ? { ok: false, error_code: 401, description: "Unauthorized" }
            : // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ({ ok: true, result: method === "getUpdates" ? [] : true } as any),
        ),
    });
    await expect(adapter.start()).rejects.toThrow(/Unauthorized|401/u);
  });
});
