// Korean phrase pack. `satisfies Phrases` fails the build when a key is missing (T8 acceptance).
import type { Phrases } from "../core/index.js";
import { languageName, megabytes } from "./names.js";

const name = (code: string): string => languageName(code, "ko");

export const ko = {
  progressExtracting: (f) => `"${f}" 받았습니다. 텍스트를 추출하는 중…`,
  progressTranslating: (d, t) => `번역 중… ${String(d)}/${String(t)} 청크`,
  progressSummarizing: () => "요약을 작성하는 중…",
  skipSameLang: (c) => `이미 ${name(c)} 문서입니다.`,
  rejectUnsupported: (f, s) => `"${f}"은(는) 지원하지 않는 형식입니다. 지원 형식: ${s.join(", ")}.`,
  rejectTooLarge: (_b, m) =>
    `파일이 다운로드 한도 ${megabytes(m)}를 넘어 내려받지 않았습니다. 더 작은 파일로 보내거나 나눠서 보내 주세요.`,
  rejectOverMax: (c, m, s) =>
    `문서가 약 ${String(c)}자로 전문 번역 상한(${String(m)}자)을 넘습니다.` +
    (s ? " 대신 /summary 로 요약을 받을 수 있습니다." : ""),
  extractEmpty: (f) =>
    `"${f}"에서 텍스트를 추출할 수 없습니다. 스캔 문서(OCR)는 v0.2에서 지원 예정입니다.`,
  extractEncrypted: (f) =>
    `"${f}"은(는) 암호로 보호된 파일입니다. 암호를 해제한 뒤 다시 보내 주세요.`,
  extractCorrupt: (f) =>
    `"${f}"을(를) 읽을 수 없습니다. 파일이 손상되었을 수 있으니 다시 내보내서 보내 주세요.`,
  translationFailed: (d, t) =>
    `번역이 ${String(d)}/${String(t)} 청크에서 중단되었습니다(번역 서비스 2회 실패). 결과는 게시하지 않았습니다. 잠시 후 다시 시도해 주세요.`,
  summaryFailed: () =>
    "요약을 만들지 못했습니다. /full 을 보내면 전문 번역을 파일로 받을 수 있습니다.",
  fileCaption: (f, c) => `전문 번역(${name(c)}): ${f}`,
  fileFullNote: (f) => `"${f}"의 전문 번역을 파일로 첨부했습니다.`,
  noLastDocument: () =>
    "이 대화방에서 받은 문서가 아직 없습니다. PDF, DOCX 또는 TXT/MD 파일을 먼저 올려 주세요.",
  modeChanged: (m) => `출력 모드를 ${m}(으)로 변경했습니다.`,
  modeInvalid: (a, modes) =>
    `알 수 없는 모드 "${a ?? ""}"입니다. ${modes.join(", ")} 중 하나를 사용하세요. 예: /mode smart`,
  langChanged: (c) => `모국어를 ${name(c)}(으)로 변경했습니다.`,
  langInvalid: (a) =>
    `알 수 없는 언어 "${a ?? ""}"입니다. ko, en, ja, fil 같은 ISO 639 코드를 사용하세요. 예: /lang ko`,
  paired: () =>
    "페어링되었습니다. 소유자로 등록되고 이 대화방이 허용되었습니다. PDF, DOCX, TXT/MD를 보내면 번역합니다.",
  chatAllowed: () => "이 대화방에서 문서를 받도록 허용했습니다.",
  chatDenied: () => "이 대화방의 문서 수신 허용을 해제했습니다.",
  unknownError: () =>
    "문서를 처리하는 중 문제가 생겼습니다. 다시 시도해 주세요. 계속 실패하면 봇을 재시작하세요(npm run cli -- start).",
} satisfies Phrases;
