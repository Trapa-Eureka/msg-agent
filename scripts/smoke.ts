// Manual smoke (human only — TESTING §5). Real bot token + real provider; posts to a real chat.
//   npm run smoke -- [--chat <chatId>] [--wait <seconds>] [--config <path>]
// 1) getMe (username + group privacy mode)  2) provider key verify  3) start the daemon and wait for
// one document upload, ticking the checklist from pipeline log events (metadata only, never content).
import { Bot } from "grammy";
import type { LogMeta, Logger } from "../src/core/index.js";
import {
  ProviderError,
  explainConfigError,
  explainSecretError,
  formatExplanations,
} from "../src/core/index.js";
import {
  defaultConfigPath,
  loadConfig,
  loadDotEnv,
  resolveSecret,
} from "../src/adapters/configStore.js";
import { ConsoleLogger } from "../src/adapters/consoleLogger.js";
import { createProvider } from "../src/adapters/providers/index.js";
import { TelegramAdapter } from "../src/adapters/telegramAdapter.js";
import { runStart } from "../src/cli/start.js";
import { phrasesFor } from "../src/phrases/index.js";

interface Args {
  chat?: string;
  wait: number;
  config: string;
}
function parseArgs(argv: string[]): Args {
  const a: Args = { wait: 300, config: defaultConfigPath() };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--chat" && v !== undefined) a.chat = v;
    if (k === "--wait" && v !== undefined) a.wait = Number(v);
    if (k === "--config" && v !== undefined) a.config = v;
  }
  return a;
}

type ItemKey =
  | "getMe"
  | "privacyOff"
  | "providerKey"
  | "providerProbe"
  | "daemon"
  | "docReceived"
  | "extracted"
  | "planned"
  | "done"
  | "filePosted";
const ITEMS: { key: ItemKey; label: string; required: boolean }[] = [
  { key: "getMe", label: "봇 getMe 응답 (토큰 유효)", required: true },
  {
    key: "privacyOff",
    label: "그룹 프라이버시 모드 해제 (그룹에서 파일 수신 가능)",
    required: false,
  },
  { key: "providerKey", label: "프로바이더 키 검증", required: true },
  {
    key: "providerProbe",
    label: "프로바이더 실번역 프로브 (1청크, 요청 형태 확인)",
    required: true,
  },
  { key: "daemon", label: "데몬 시작 + 명령 자동완성 등록", required: true },
  { key: "docReceived", label: "문서 수신", required: true },
  { key: "extracted", label: "텍스트 추출·언어 감지·플랜 결정", required: true },
  { key: "planned", label: "플랜이 summary_plus_file 또는 inline_full", required: true },
  { key: "done", label: "번역 완료 및 게시", required: true },
  { key: "filePosted", label: "긴 문서면 요약 + 파일 첨부 (summary_plus_file)", required: false },
];

class Checklist {
  readonly state = new Map<ItemKey, { ok: boolean; note?: string }>();
  set(key: ItemKey, ok: boolean, note?: string): void {
    this.state.set(key, note === undefined ? { ok } : { ok, note });
    console.log(
      `${ok ? "✓" : "✗"} ${ITEMS.find((i) => i.key === key)?.label ?? key}${note === undefined ? "" : ` — ${note}`}`,
    );
  }
  print(): boolean {
    console.log("\n=== 스모크 체크리스트 ===");
    let allRequired = true;
    for (const item of ITEMS) {
      const s = this.state.get(item.key);
      const mark = s === undefined ? "–" : s.ok ? "✓" : "✗";
      if (item.required && s?.ok !== true) allRequired = false;
      console.log(
        `${mark} ${item.label}${s?.note === undefined ? "" : ` — ${s.note}`}${item.required ? "" : " (선택)"}`,
      );
    }
    console.log(allRequired ? "\n결과: 통과" : "\n결과: 미완료 — 위의 ✗/– 항목을 확인하세요.");
    return allRequired;
  }
}

/** Forwards to the JSON logger and ticks the checklist from pipeline events. */
class SmokeLogger implements Logger {
  private readonly inner = new ConsoleLogger();
  constructor(
    private readonly list: Checklist,
    private readonly onDone: () => void,
  ) {}
  private observe(event: string, meta: LogMeta): void {
    if (event === "daemon.started") this.list.set("daemon", true);
    if (event === "doc.received")
      this.list.set(
        "docReceived",
        true,
        `${String(meta.fileName)} (${String(meta.sizeBytes)} bytes)`,
      );
    if (event === "doc.planned") {
      this.list.set(
        "extracted",
        true,
        `lang=${String(meta.detectedLang)} conf=${String(meta.confidence)} chars=${String(meta.chars)}`,
      );
      const plan = String(meta.plan);
      this.list.set("planned", plan === "summary_plus_file" || plan === "inline_full", plan);
    }
    if (event === "doc.done") {
      this.list.set("done", true, `${String(meta.plan)} in ${String(meta.ms)} ms`);
      if (meta.plan === "summary_plus_file") this.list.set("filePosted", true);
      this.onDone();
    }
    if (
      event === "doc.rejected" ||
      event === "doc.extract_failed" ||
      event === "doc.translate_failed"
    ) {
      this.list.set(
        "done",
        false,
        `${event}${meta.reason === undefined ? "" : ` (${String(meta.reason)})`}`,
      );
      this.onDone();
    }
  }
  info(event: string, meta: LogMeta = {}): void {
    this.inner.info(event, meta);
    this.observe(event, meta);
  }
  warn(event: string, meta: LogMeta = {}): void {
    this.inner.warn(event, meta);
    this.observe(event, meta);
  }
  error(event: string, meta: LogMeta = {}): void {
    this.inner.error(event, meta);
    this.observe(event, meta);
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  loadDotEnv();
  const list = new Checklist();

  const loaded = loadConfig(args.config);
  if (!loaded.ok) {
    console.log(formatExplanations(explainConfigError(loaded.error, "ko"), "ko"));
    return 1;
  }
  const config = loaded.value;
  const token = resolveSecret(config.messenger.tokenRef, "messenger.tokenRef");
  const apiKey = resolveSecret(config.provider.apiKeyRef, "provider.apiKeyRef");
  if (!token.ok || !apiKey.ok) {
    if (!token.ok) console.log(formatExplanations([explainSecretError(token.error, "ko")], "ko"));
    if (!apiKey.ok) console.log(formatExplanations([explainSecretError(apiKey.error, "ko")], "ko"));
    return 1;
  }

  // 1. getMe + privacy mode
  let username: string | undefined;
  try {
    const me = await new Bot(token.value).api.getMe();
    username = me.username;
    list.set("getMe", true, `@${me.username}`);
    list.set(
      "privacyOff",
      me.can_read_all_group_messages,
      me.can_read_all_group_messages
        ? "can_read_all_group_messages=true"
        : "@BotFather → /setprivacy → Disable 후 봇을 그룹에서 제거·재초대",
    );
  } catch (e) {
    list.set("getMe", false, e instanceof Error ? e.name : "error");
    list.print();
    return 1;
  }

  // 2. provider key
  const verify = await createProvider(config.provider, apiKey.value).verify();
  list.set(
    "providerKey",
    verify.ok,
    verify.ok
      ? config.provider.kind
      : `${verify.error.kind}${verify.error.detail === undefined ? "" : ` (${verify.error.detail})`}`,
  );
  if (!verify.ok) {
    list.print();
    return 1;
  }
  // 2b. One tiny real translation — catches request-shape errors a models lookup cannot (e.g. unsupported params)
  try {
    const probe = await createProvider(config.provider, apiKey.value).translate(
      [{ index: 0, sectionIndex: 0, text: "Good morning. This is a connectivity check." }],
      config.nativeLang,
      { sourceLangHint: "en" },
    );
    list.set("providerProbe", true, `${String(probe[0]?.text.length ?? 0)} chars`);
  } catch (e) {
    const pe =
      e instanceof ProviderError
        ? `${e.kind}${e.status === undefined ? "" : ` http ${String(e.status)}`}${e.detail === undefined ? "" : ` ${e.detail}`}`
        : "error";
    list.set("providerProbe", false, pe);
    list.print();
    return 1;
  }

  // 3. daemon + wait for one document
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const logger = new SmokeLogger(list, () => {
    finish();
  });
  const daemon = await runStart({
    configPath: args.config,
    env: process.env,
    out: (l) => {
      console.log(l);
    },
    logger,
    phrasesFor,
    buildMessenger: (t) =>
      new TelegramAdapter({
        token: t,
        onError: (e, fatal) => {
          logger.error(fatal ? "telegram.polling_failed" : "telegram.error", {
            error: e instanceof Error ? e.name : "unknown",
          });
        },
      }),
    botUsername: username,
  });
  if (typeof daemon === "number") return daemon;

  if (args.chat !== undefined) {
    await new Bot(token.value).api.sendMessage(
      args.chat,
      `[smoke] 영어 PDF 1건을 이 대화방에 올려 주세요. ${String(args.wait)}초 동안 기다립니다.`,
    );
  }
  console.log(`\n영어 PDF를 봇(@${username})에게 보내세요. 최대 ${String(args.wait)}초 대기…`);
  const timer = setTimeout(() => {
    finish();
  }, args.wait * 1000);
  await done;
  clearTimeout(timer);
  await daemon.stop();
  return list.print() ? 0 : 1;
}

process.exitCode = await main();
