// FixtureExtractor — maps a file extension to a fixed ExtractedDoc (TESTING §2). No parsing.
import type { DocumentExtractor, ExtractError, ExtractedDoc, Result } from "../core/index.js";
import { err, ok, structureText } from "../core/index.js";

export type FixtureEntry = ExtractedDoc | { error: ExtractError };

export class FixtureExtractor implements DocumentExtractor {
  readonly extracted: string[] = [];
  constructor(private readonly byExt: Readonly<Record<string, FixtureEntry>>) {}

  supports(_mime: string, name: string): boolean {
    return this.keyFor(name) !== undefined;
  }

  extract(bytes: Uint8Array): Promise<Result<ExtractedDoc, ExtractError>> {
    // The "file name" travels in the bytes for this mock: tests encode the name as content.
    const name = new TextDecoder().decode(bytes);
    const key = this.keyFor(name);
    const entry = key === undefined ? undefined : this.byExt[key];
    this.extracted.push(name);
    if (entry === undefined) return Promise.resolve(err({ kind: "corrupt", detail: "no fixture" }));
    if ("error" in entry) return Promise.resolve(err(entry.error));
    return Promise.resolve(ok(entry));
  }

  private keyFor(name: string): string | undefined {
    const ext = name.toLowerCase().split(".").pop() ?? "";
    return ext in this.byExt ? ext : undefined;
  }
}

/** Builds an ExtractedDoc of roughly `chars` non-whitespace characters with `sections` headings. */
export function syntheticDoc(chars: number, sections = 4, lang: "en" | "ko" = "en"): ExtractedDoc {
  const sentence =
    lang === "en"
      ? "The vendor delivers the modules on time and invoices monthly. "
      : "공급자는 모듈을 기한 내에 납품하고 매월 청구서를 발행합니다. ";
  const perSection = Math.ceil(chars / sections);
  const parts: string[] = [];
  for (let i = 0; i < sections; i++) {
    let body = "";
    while (body.replace(/\s+/gu, "").length < perSection) body += sentence;
    parts.push(`# ${lang === "en" ? "Section" : "조항"} ${String(i + 1)}\n\n${body.trim()}`);
  }
  return structureText(parts.join("\n\n"));
}
