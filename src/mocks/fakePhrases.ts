// FakePhrases — every phrase renders as "[key arg1 arg2]" so tests assert on keys, not wording.
import type { Phrases } from "../core/index.js";

const tag = (key: string, ...args: (string | number | boolean | undefined)[]): string =>
  `[${[key, ...args.map((a) => (a === undefined ? "-" : String(a)))].join(" ")}]`;

export function fakePhrases(lang: string): Phrases {
  return {
    progressExtracting: (f) => tag("progressExtracting", lang, f),
    progressTranslating: (d, t) => tag("progressTranslating", lang, `${String(d)}/${String(t)}`),
    progressSummarizing: () => tag("progressSummarizing", lang),
    skipSameLang: (n) => tag("skipSameLang", lang, n),
    rejectUnsupported: (f, s) => tag("rejectUnsupported", lang, f, s.join(",")),
    rejectTooLarge: (b, m) => tag("rejectTooLarge", lang, b, m),
    rejectOverMax: (c, m, s) => tag("rejectOverMax", lang, c, m, s),
    extractEmpty: (f) => tag("extractEmpty", lang, f),
    extractEncrypted: (f) => tag("extractEncrypted", lang, f),
    extractCorrupt: (f) => tag("extractCorrupt", lang, f),
    translationFailed: (d, t) => tag("translationFailed", lang, `${String(d)}/${String(t)}`),
    summaryFailed: () => tag("summaryFailed", lang),
    fileCaption: (f, n) => tag("fileCaption", lang, f, n),
    fileFullNote: (f) => tag("fileFullNote", lang, f),
    noLastDocument: () => tag("noLastDocument", lang),
    modeChanged: (m) => tag("modeChanged", lang, m),
    modeInvalid: (a, modes) => tag("modeInvalid", lang, a, modes.join("|")),
    langChanged: (n) => tag("langChanged", lang, n),
    langInvalid: (a) => tag("langInvalid", lang, a),
    unknownError: () => tag("unknownError", lang),
  };
}
