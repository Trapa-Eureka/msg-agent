// English phrase pack. T8 adds ko and the language fallback.
import type { Phrases } from "../core/index.js";

const kb = (b: number): string => `${(b / 1024 / 1024).toFixed(1)} MB`;

export const en: Phrases = {
  progressExtracting: (f) => `Got "${f}". Extracting text…`,
  progressTranslating: (d, t) => `Translating… ${String(d)}/${String(t)} chunks`,
  progressSummarizing: () => "Writing the summary…",
  skipSameLang: (n) => `This document is already in ${n}.`,
  rejectUnsupported: (f, s) => `"${f}" is not a supported format. Supported: ${s.join(", ")}.`,
  rejectTooLarge: (_b, m) =>
    `The file is larger than the ${kb(m)} download limit, so it was not downloaded. Please send a smaller file or split it.`,
  rejectOverMax: (c, m, s) =>
    `The document has about ${String(c)} characters, above the ${String(m)} limit for a full translation.` +
    (s ? " Send /summary to get a summary instead." : ""),
  extractEmpty: (f) =>
    `No text could be extracted from "${f}". Scanned documents (OCR) are planned for v0.2.`,
  extractEncrypted: (f) => `"${f}" is password-protected. Remove the password and send it again.`,
  extractCorrupt: (f) => `"${f}" could not be read. The file may be damaged; try re-exporting it.`,
  translationFailed: (d, t) =>
    `Translation stopped after ${String(d)}/${String(t)} chunks because the provider failed twice. Nothing was posted; please try again later.`,
  summaryFailed: () =>
    "The summary could not be produced. Send /full for the full translation as a file.",
  fileCaption: (f, n) => `Full translation (${n}): ${f}`,
  fileFullNote: (f) => `The full translation of "${f}" is attached as a file.`,
  noLastDocument: () =>
    "No document has been received in this chat yet. Upload a PDF, DOCX or TXT/MD file first.",
  modeChanged: (m) => `Output mode set to ${m}.`,
  modeInvalid: (a, modes) =>
    `Unknown mode "${a ?? ""}". Use one of: ${modes.join(", ")}. Example: /mode smart`,
  langChanged: (n) => `Native language set to ${n}.`,
  langInvalid: (a) =>
    `Unknown language "${a ?? ""}". Use an ISO 639 code such as ko, en, ja, fil. Example: /lang ko`,
  unknownError: () =>
    "Something went wrong while processing the document. Please try again; if it keeps failing, restart the bot with `message start`.",
};
