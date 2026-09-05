import { describe, expect, it } from "vitest";
import { ProviderError } from "../src/core/index.js";
import { FakeTranslator, marker } from "../src/mocks/fakeTranslator.js";

const chunks = [
  { index: 0, sectionIndex: 0, text: "a" },
  { index: 1, sectionIndex: 0, text: "b" },
  { index: 2, sectionIndex: 1, text: "c" },
];

describe("FakeTranslator", () => {
  it("wraps each chunk in a marker with the target code and reports progress", async () => {
    const t = new FakeTranslator();
    const progress: [number, number][] = [];
    const out = await t.translate(chunks, "ko", { onProgress: (d, n) => progress.push([d, n]) });
    expect(out).toEqual([
      { index: 0, text: "«KO:a»" },
      { index: 1, text: "«KO:b»" },
      { index: 2, text: "«KO:c»" },
    ]);
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    expect(t.calls).toEqual({ translate: 1, summarize: 0, verify: 0, chunks: 3 });
  });

  it("fails the injected chunk once, then succeeds on retry", async () => {
    const t = new FakeTranslator({ failOnChunk: 1 });
    await expect(t.translate(chunks, "ko", {})).rejects.toBeInstanceOf(ProviderError);
    const retry = await t.translate(chunks.slice(1, 2), "ko", {});
    expect(retry).toEqual([{ index: 1, text: marker("ko", "b") }]);
    expect(t.requestedChunks).toEqual([0, 1, 1]);
  });

  it("can fail forever and can fail summaries", async () => {
    const t = new FakeTranslator({ failOnChunk: 0, failTimes: Infinity, failSummaryTimes: 1 });
    await expect(t.translate(chunks, "ko", {})).rejects.toMatchObject({
      kind: "server",
      retryable: true,
    });
    await expect(t.translate(chunks, "ko", {})).rejects.toBeInstanceOf(ProviderError);
    await expect(t.summarize({ text: "", sections: [] }, "ko")).rejects.toBeInstanceOf(
      ProviderError,
    );
    expect(
      await t.summarize(
        {
          text: "",
          sections: [
            { title: "A", text: "" },
            { title: "B", text: "" },
          ],
        },
        "ko",
      ),
    ).toBe("«KO:A / B»");
  });

  it("verify succeeds and is counted", async () => {
    const t = new FakeTranslator();
    expect(await t.verify()).toEqual({ ok: true, value: undefined });
    expect(t.calls.verify).toBe(1);
  });
});
