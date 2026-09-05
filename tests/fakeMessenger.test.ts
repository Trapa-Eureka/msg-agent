import { describe, expect, it } from "vitest";
import type { IncomingCommand, IncomingDoc } from "../src/core/index.js";
import { FakeMessenger } from "../src/mocks/fakeMessenger.js";

describe("FakeMessenger", () => {
  it("delivers documents and commands to handlers and records posts per chat", async () => {
    const m = new FakeMessenger();
    const docs: IncomingDoc[] = [];
    const cmds: IncomingCommand[] = [];
    m.onDocument((d) => {
      docs.push(d);
      return Promise.resolve();
    });
    m.onCommand((c) => {
      cmds.push(c);
      return Promise.resolve();
    });
    const doc = await m.emitDocument({
      chatId: "c1",
      fileName: "a.pdf",
      mime: "application/pdf",
      bytes: new Uint8Array([1, 2]),
    });
    await m.emitCommand({ chatId: "c1", name: "mode", arg: "full" });
    expect(docs[0]).toBe(doc);
    expect(doc).toMatchObject({ chatId: "c1", messageId: "1", fileName: "a.pdf", sizeBytes: 2 });
    expect(await doc.download()).toEqual(new Uint8Array([1, 2]));
    expect(m.downloads).toEqual(["1"]);
    expect(cmds).toEqual([{ chatId: "c1", name: "mode", arg: "full" }]);

    await m.postText("c1", "hi", "1");
    await m.postFile("c2", "t.md", new Uint8Array([7]), "cap");
    expect(m.textsFor("c1")).toEqual(["hi"]);
    expect(m.posts[0]).toEqual({ kind: "text", chatId: "c1", text: "hi", replyTo: "1" });
    expect(m.filesFor("c2")).toEqual([
      { kind: "file", chatId: "c2", name: "t.md", content: new Uint8Array([7]), caption: "cap" },
    ]);
    expect(m.textsFor("c2")).toEqual([]);
  });

  it("splits long text with the shared rule and reports an overridden size without bytes", async () => {
    const m = new FakeMessenger(10);
    await m.postText("c", "aaaa aaaa\n\nbbbb bbbb\n\ncccc");
    expect(m.textsFor("c")).toEqual(["aaaa aaaa", "bbbb bbbb", "cccc"]);
    m.onDocument(() => Promise.resolve());
    const big = await m.emitDocument({
      chatId: "c",
      fileName: "big.pdf",
      sizeBytes: 21 * 1024 * 1024,
    });
    expect(big.sizeBytes).toBe(21 * 1024 * 1024);
    expect(m.downloads).toEqual([]);
  });

  it("throws when no handler is registered and tracks start/stop", async () => {
    const m = new FakeMessenger();
    await expect(m.emitDocument({ chatId: "c", fileName: "x" })).rejects.toThrow(
      /no document handler/,
    );
    await expect(m.emitCommand({ chatId: "c", name: "full" })).rejects.toThrow(
      /no command handler/,
    );
    await m.start();
    await m.stop();
    expect(m.started && m.stopped).toBe(true);
  });
});
