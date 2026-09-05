// FakeTranslator — deterministic marker translation for tests (TESTING §2).
// translate: each chunk -> «KO:{original}» ; summarize: section titles. Counts calls (cost guard).
import type {
  Chunk,
  ExtractedDoc,
  Result,
  TranslateOptions,
  TranslatedChunk,
  TranslatorProvider,
} from "../core/index.js";
import { ProviderError, ok } from "../core/index.js";

export interface FakeTranslatorOptions {
  /** Chunk index that fails (retryable ProviderError). */
  failOnChunk?: number;
  /** How many times that chunk fails before succeeding (default 1 = succeeds on retry). Infinity = always. */
  failTimes?: number;
  /** Make summarize fail this many times. */
  failSummaryTimes?: number;
}

export function marker(to: string, text: string): string {
  return `«${to.toUpperCase()}:${text}»`;
}

export class FakeTranslator implements TranslatorProvider {
  readonly calls = { translate: 0, summarize: 0, verify: 0, chunks: 0 };
  /** Every chunk index requested, in order (detects duplicate work). */
  readonly requestedChunks: number[] = [];
  private failuresLeft: number;
  private summaryFailuresLeft: number;
  private readonly opts: FakeTranslatorOptions;

  constructor(opts: FakeTranslatorOptions = {}) {
    this.opts = opts;
    this.failuresLeft = opts.failOnChunk === undefined ? 0 : (opts.failTimes ?? 1);
    this.summaryFailuresLeft = opts.failSummaryTimes ?? 0;
  }

  translate(chunks: Chunk[], to: string, opts: TranslateOptions): Promise<TranslatedChunk[]> {
    this.calls.translate += 1;
    const out: TranslatedChunk[] = [];
    for (const chunk of chunks) {
      this.calls.chunks += 1;
      this.requestedChunks.push(chunk.index);
      if (chunk.index === this.opts.failOnChunk && this.failuresLeft > 0) {
        this.failuresLeft -= 1;
        return Promise.reject(new ProviderError("server", true, 503, "injected"));
      }
      out.push({ index: chunk.index, text: marker(to, chunk.text) });
      opts.onProgress?.(out.length, chunks.length);
    }
    return Promise.resolve(out);
  }

  summarize(doc: ExtractedDoc, to: string): Promise<string> {
    this.calls.summarize += 1;
    if (this.summaryFailuresLeft > 0) {
      this.summaryFailuresLeft -= 1;
      return Promise.reject(new ProviderError("server", true, 503, "injected"));
    }
    const titles = doc.sections.map((s) => s.title).filter((t): t is string => t !== undefined);
    return Promise.resolve(marker(to, titles.length > 0 ? titles.join(" / ") : "summary"));
  }

  verify(): Promise<Result<void, ProviderError>> {
    this.calls.verify += 1;
    return Promise.resolve(ok(undefined));
  }
}
