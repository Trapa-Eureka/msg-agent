// CLI screen wording. Separate from the messenger phrase pack (T8).
export type UiLang = "ko" | "en";

export function uiLangFor(
  nativeLang: string | undefined,
  envLang: string | undefined = process.env.LANG,
): UiLang {
  if (nativeLang !== undefined) return nativeLang === "ko" ? "ko" : "en";
  return envLang?.toLowerCase().startsWith("ko") === true ? "ko" : "en";
}

interface Text {
  welcome: string;
  askLang: string;
  askProvider: string;
  askKey: (kind: string) => string;
  useEnv: (varName: string) => string;
  verifying: string;
  verifyOk: string;
  askToken: string;
  tokenOk: (username: string) => string;
  retry: (left: number) => string;
  aborted: string;
  saved: (path: string) => string;
  invite: string;
  starting: (username: string | undefined, lang: string) => string;
  stopping: string;
  statusTitle: string;
  botOk: (username: string) => string;
  botFail: string;
  noConfig: string;
}

const ko: Text = {
  welcome: "message 온보딩 — 3가지만 물어봅니다.",
  askLang: "모국어를 입력하세요 (언어 이름 또는 ISO 639 코드, 예: 한국어 / ko)",
  askProvider: "번역에 사용할 AI 프로바이더",
  askKey: (k) => `${k} API 키를 붙여넣으세요 (화면에 표시되지 않습니다)`,
  useEnv: (v) =>
    `환경변수 ${v}가 이미 설정되어 있습니다. 이 값을 사용할까요? (설정 파일에는 참조만 저장)`,
  verifying: "키를 확인하는 중…",
  verifyOk: "확인되었습니다.",
  askToken: "Telegram 봇 토큰을 붙여넣으세요 (@BotFather → /newbot)",
  tokenOk: (u) => `봇 @${u} 확인되었습니다.`,
  retry: (n) => `다시 입력하세요 (남은 시도 ${String(n)}회).`,
  aborted: "온보딩을 중단했습니다. 문제를 해결한 뒤 다시 실행하세요: npm run cli -- init",
  saved: (p) => `설정을 저장했습니다: ${p} (권한 600)`,
  invite:
    "봇을 원하는 대화방(1:1 또는 그룹)에 초대하세요. 그룹이면 @BotFather에서 /setprivacy → Disable로 프라이버시 모드를 꺼야 파일을 받을 수 있습니다. 시작: npm run cli -- start",
  starting: (u, l) => `봇 ${u === undefined ? "" : `@${u} `}시작 (모국어 ${l}). 종료: Ctrl+C`,
  stopping: "종료 중… 진행 중인 작업을 정리합니다.",
  statusTitle: "message 상태",
  botOk: (u) => `봇 연결: 정상 (@${u})`,
  botFail: "봇 연결: 실패",
  noConfig: "설정이 없습니다. 먼저 온보딩을 실행하세요: npm run cli -- init",
};

const en: Text = {
  welcome: "message onboarding — just three questions.",
  askLang: "Your native language (name or ISO 639 code, e.g. Korean / ko)",
  askProvider: "AI provider for translation",
  askKey: (k) => `Paste your ${k} API key (input is hidden)`,
  useEnv: (v) =>
    `Environment variable ${v} is already set. Use it? (only a reference is stored in the config)`,
  verifying: "Checking the key…",
  verifyOk: "Verified.",
  askToken: "Paste your Telegram bot token (@BotFather → /newbot)",
  tokenOk: (u) => `Bot @${u} verified.`,
  retry: (n) => `Try again (${String(n)} attempts left).`,
  aborted: "Onboarding aborted. Fix the problem and run again: npm run cli -- init",
  saved: (p) => `Config saved: ${p} (mode 600)`,
  invite:
    "Invite the bot to the chat (1:1 or group). For groups, disable privacy mode in @BotFather (/setprivacy → Disable) so it can receive files. Start: npm run cli -- start",
  starting: (u, l) =>
    `Bot ${u === undefined ? "" : `@${u} `}starting (native language ${l}). Stop with Ctrl+C`,
  stopping: "Stopping… finishing in-flight work.",
  statusTitle: "message status",
  botOk: (u) => `Bot connection: ok (@${u})`,
  botFail: "Bot connection: failed",
  noConfig: "No config found. Run onboarding first: npm run cli -- init",
};

export function text(lang: UiLang): Text {
  return lang === "ko" ? ko : en;
}
