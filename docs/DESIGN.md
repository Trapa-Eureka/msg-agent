# DESIGN — message v0.1

이 문서가 구현의 진실의 원천이다. 파이프라인·인터페이스·출력 정책 변경은 문서 수정이 먼저다.

## 1. 아키텍처

```
Telegram (long polling)                    CLI (init/start/status)
      │ 파일 업로드 이벤트 / 명령                     │
      ▼                                             ▼
adapters/telegramAdapter (grammY) ──────► core/pipeline.ts
      ▲  게시(sendMessage/sendDocument)        │
      │                                        ├ extractors (pdf/docx/txt)
      └────────── OutputPlan 실행 ◄────────────┤ detector (franc → 폴백)
                                               ├ chunker (구조 보존 분할)
                                               ├ TranslatorProvider (claude | openai)
                                               └ outputPlanner (smart 정책)
```

코어는 메신저·프로바이더 구현을 모른다. 이벤트는 정규화된 `IncomingDoc`/`IncomingCommand`로, 출력은 `OutputPlan`으로만 주고받는다. 실패는 throw 대신 `Result<T, E>`(core/result.ts)로 돌려 사용자 문구를 T8 문구 팩에서 렌더한다.

## 2. 핵심 인터페이스 (core/types.ts)

```ts
export interface IncomingDoc {
  chatId: string; messageId: string; fileName: string; mime: string;
  sizeBytes: number; download(): Promise<Uint8Array>;
}
export interface IncomingCommand { chatId: string; name: "full"|"summary"|"mode"|"lang"; arg?: string }

export interface MessengerAdapter {
  onDocument(h: (d: IncomingDoc) => Promise<void>): void;
  onCommand(h: (c: IncomingCommand) => Promise<void>): void;
  postText(chatId: string, text: string, replyTo?: string): Promise<void>;   // 길이 제한 분할은 어댑터 책임
  postFile(chatId: string, name: string, content: Uint8Array, caption?: string): Promise<void>;
  start(): Promise<void>; stop(): Promise<void>;
}

export interface DocumentExtractor { supports(mime: string, name: string): boolean; extract(bytes: Uint8Array): Promise<Result<ExtractedDoc, ExtractError>> }
export type ExtractError =
  | { kind: "empty_text" }                 // 텍스트 레이어 없음(스캔본) → v0.2 OCR 안내
  | { kind: "encrypted" }                  // 암호 PDF
  | { kind: "corrupt"; detail: string };   // 파싱 실패. detail은 라이브러리 오류명만(본문 아님)
export interface ExtractedDoc { text: string; sections: Section[] }        // 제목/문단 구조 유지. text는 Markdown 풍(제목 `# `, 문단 빈 줄)
export interface Section { title?: string; text: string }                  // 추출기가 복원한 구조 단위
export interface Chunk { index: number; sectionIndex: number; text: string }   // chunker 출력, index는 조립 순서
export interface TranslatedChunk { index: number; text: string }           // 프로바이더 출력, index로 순서 복원

export interface LanguageDetector { detect(text: string): { lang: string; confidence: number } }

export interface TranslatorProvider {
  translate(chunks: Chunk[], to: string, opts: { sourceLangHint?: string; onProgress?: (done: number, total: number) => void }): Promise<TranslatedChunk[]>;
  summarize(doc: ExtractedDoc, to: string): Promise<string>;               // 구조 요약 (SPEC §4)
  verify(): Promise<Result<void, ProviderError>>;                          // init 키 검증 1회 (토큰 소모 없는 models 조회)
}
export type ProviderError = { kind: "auth"|"rate_limit"|"server"|"network"|"bad_response"|"refusal"|"unknown"; retryable: boolean; status?: number; detail?: string }  // detail은 오류명·코드만, 본문 금지

export type OutputPlan =
  | { kind: "inline_full"; parts: string[] }                               // 짧은 문서: 채팅에 전문(분할 게시)
  | { kind: "summary_plus_file"; summary: string; file: { name: string; content: string } }  // 긴 문서 smart/summary: 요약 + 전문 파일
  | { kind: "file_full"; note: string; file: { name: string; content: string } }             // 긴 문서 full 모드·`/full`: 짧은 머리말 + 전문 파일
  | { kind: "skip_same_lang"; note: string }
  | { kind: "reject"; reason: string };                                    // 상한 초과·미지원 형식 등
```

## 3. 파이프라인 (core/pipeline.ts)

1. `IncomingDoc` 수신 → 크기·형식 가드 (미지원/초과 → `reject` 플랜, 사유는 모국어 문구)
2. 진행 알림 게시 → 다운로드 → 추출기 라우팅(`supports`: MIME 우선, `application/octet-stream` 등 불명확하면 확장자로 판정) → `ExtractedDoc`. 섹션 구조화는 공용 휴리스틱(`core/sections.ts`: Markdown 제목·짧은 무종결 단독 행 = 제목, 빈 줄 = 문단)
3. 언어 감지 — franc(`core/detector.ts`). 신뢰도 = 표본 글자 수 계수(100자에서 1) × 표본 전·후반 감지 일치도(둘 다 일치 1 / 하나 0.7 / 없음 0.4). **0.7 이상**일 때만 감지 언어 = 모국어면 `skip_same_lang`, 미만이면 `sourceLangHint` 없이 번역 프롬프트에 위임. 매크로언어 구성원(arb→ar, cmn→zh 등)은 `core/lang.ts`에서 정규화
4. `outputPlanner.decidePlan`: 판정 순서 = 미지원 형식 → 바이트 상한(다운로드 전) → 같은 언어(신규 업로드만) → `maxChars` 초과(`/full`도 우회 불가, 요약 제안) → `/summary`·`/full` 요청 → 모드×임계치(임계치 이하 = 짧음, 포함). 결과는 `PlanDecision`(종류·거절 사유만, 내용 없음)
5. 전문 경로: `chunker`(섹션 → 문단 → 문장 → 자소 클러스터 순으로 분할, 청크당 기본 4,000자, 각 청크는 섹션 제목을 `# `로 포함, 섹션 경계는 넘지 않음) → `translate` (진행 상태 n/m 갱신) → `assembleChunks`로 순번대로 조립(누락 청크가 있으면 게시하지 않음)
6. 요약 경로: `summarize` + 전문 번역은 .md 파일 조립. full 모드에서 임계치 초과면 `file_full`(요약 호출 없이 머리말 + 전문 파일)
7. 어댑터로 플랜 실행 → 임시 데이터 즉시 폐기 (가드레일 1)
8. 실패 시: 청크 단위 1회 재시도 → 그래도 실패면 부분 결과 여부를 알리고 모국어 오류 안내

**조립 규칙(core/pipeline.ts)**
- 의존성 주입: `MessengerAdapter`, `DocumentExtractor[]`, `LanguageDetector`, `TranslatorProvider`, `SettingsStore`(config 읽기/저장 — 파일 IO는 어댑터), `phrasesFor(lang) → Phrases`(사용자 문구 팩, T8), `Logger`(메타데이터 전용), `Clock`. 코어에는 문자열 리터럴이 없다 — 모든 사용자 대면 문구는 `Phrases` 키를 통해서만 나간다.
- 번역 호출은 **청크 1개당 `translate([chunk])` 1회**. 실패 시 `retryable`이면 같은 청크를 1회 재시도, 그래도 실패면 번역문을 전혀 게시하지 않고 `translationFailed(done, total)` 안내. 정상 경로의 프로바이더 호출 수 = 청크 수(+ 요약 1).
- 진행 알림: 추출 시작 시 1회, 번역은 청크 수가 2개 이상일 때 시작 시 `0/m`과 이후 약 1/4 지점마다(최대 4회) `n/m`, 요약 시작 시 1회.
- 채팅별 직렬화: 같은 chatId의 문서·명령은 순서대로 처리하고, 다른 chatId는 동시에 처리한다(진행 메시지 혼입 방지).
- 게시 범위: 모든 게시는 수신 이벤트의 `chatId`로만 호출한다(가드레일 2). 파일명은 `<원본 이름>.<모국어>.md`.
- 마지막 문서 참조: chatId → `IncomingDoc`(파일 ID 기반 `download()` 클로저 + 메타). 본문·번역문은 플랜 실행 직후 참조를 버린다.

명령 처리: `/full`은 직전 문서 재처리가 아니라 **마지막 문서의 `file_full` 플랜 재실행** — 이를 위해 채팅별로 "마지막 문서 참조(파일 ID·메타만, 내용 아님)"를 메모리에 보관 (프로세스 재시작 시 소멸 — 의도된 동작, 가드레일 1과 일관).

`/summary`는 마지막 문서를 `summary_plus_file`로 재실행. `/mode <smart|full|summary>`·`/lang <코드>`는 검증 후 `SettingsStore`에 저장하고 확인 문구(잘못된 인자면 안내 문구). 재실행은 다시 다운로드·추출·번역하므로 비용이 든다(v0.1 허용).

## 4. Telegram 어댑터 메모

- grammY long polling. 문서 핸들러: `message:document` → `IncomingDoc`(메타만). 다운로드는 `download()` 호출 시에만 getFile → 파일 URL fetch. **어댑터 자체가 20MB 초과면 `download()`를 거부**(getFile 호출 없음)하고, 파이프라인은 그 전에 planner의 바이트 가드로 reject한다(이중 방어).
- `postText`는 4,096자 제한에 맞춰 분할 게시 — 공용 함수 `core/textSplit.ts`(`splitForMessenger`: 문단 → 줄 → 문장 → 자소 순, 어댑터와 FakeMessenger가 같은 함수 사용), 순서 보장을 위해 순차 전송. `postFile`은 sendDocument(InputFile from bytes).
- 명령(`/full`, `/summary`, `/mode`, `/lang`)은 `start()` 시 `setMyCommands`로 등록해 자동완성 노출(BotFather 수동 등록 불필요). 명령 인자는 `ctx.match`.
- 테스트: 네트워크 0건 — `botInfo` 주입으로 getMe 생략, `api.config.use` 트랜스포머로 Bot API 호출을 가로채 요청 형태(method·payload)를 검증, `bot.handleUpdate`로 업데이트 주입, 파일 다운로드는 주입 fetch.
- 그룹에서는 봇 프라이버시 모드 이슈로 문서 수신만 처리(문서는 프라이버시 모드에서도 수신됨을 스모크로 확인, 아니면 온보딩 안내에 프라이버시 해제 절차 추가).

## 5. 프로바이더 메모

- ClaudeProvider(기본)·OpenAIProvider — 공통: 청크별 번역 프롬프트(용어·수치·고유명사 보존 지시, 출력은 번역문만), 요약 프롬프트(제목·핵심 조항·수치·요청사항 구조). 프롬프트 텍스트는 `core/prompts.ts` 한 곳에만 둔다. 청크는 순차 호출(진행 n/m 콜백), 청크 재시도는 파이프라인(T6) 책임이며 프로바이더는 `ProviderError`(retryable 플래그)를 던진다.
- Claude: 공식 SDK(`@anthropic-ai/sdk`)에 `fetch`를 주입해 테스트에서는 목 fetch로 요청 형태를 검증한다. 기본 모델 `claude-sonnet-5`(config `provider.model`로 변경), 번역은 `output_config.effort: "low"`, 요약은 `"medium"`, 안전 거절 시 서버측 fallbacks(`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) 적용, `stop_reason: "refusal"`이면 `refusal` 오류. 키 검증은 `GET /v1/models/{model}`.
- OpenAI: Chat Completions(`/v1/chat/completions`) raw fetch, 기본 모델 `gpt-5`(config로 변경), 키 검증은 `GET /v1/models/{model}`. 401→auth, 429→rate_limit(재시도 가능), 5xx→server(재시도 가능).
- 온보딩 `init`에서 키 검증 1회 호출. 실패 시 수정 방법 담긴 안내.
- 토큰 상한(config `maxChars`) 초과 문서는 planner가 요약 모드 강제 제안 → 사용자가 `/full`로 명시 요청해도 상한 초과면 거절 사유 안내 (가드레일 5).

## 6. 설정 (adapters/configStore — ~/.message/config.json, 권한 600)

```json
{
  "nativeLang": "ko",
  "provider": { "kind": "claude", "apiKeyRef": "env:ANTHROPIC_API_KEY" },
  "messenger": { "kind": "telegram", "tokenRef": "literal:123456:ABC..." },
  "mode": "smart", "inlineThresholdChars": 3000, "maxChars": 120000
}
```

zod 스키마로 로드 검증. CLI `status`는 설정 요약 + 봇 연결 상태 출력.

**SecretRef 문법** (`apiKeyRef`·`tokenRef` 공통, 문자열 1개):

| 형태 | 의미 | 비고 |
|---|---|---|
| `env:<VAR>` | 환경변수 `<VAR>`에서 읽는다 (권장) | `<VAR>`는 `[A-Z_][A-Z0-9_]*`. 셸 환경 또는 CWD의 `.env`(`process.loadEnvFile`, 의존성 없음) |
| `literal:<value>` | 값을 config.json에 직접 저장 | 파일 권한 600 전제. `init`이 사용자가 키를 붙여넣고 env 저장을 거부했을 때 사용 |

- 해석(`resolveSecret`)은 configStore가 담당하며, 해석 실패(env 미설정·빈 값·접두사 없음)는 원인 + 수정 방법("`.env`에 `ANTHROPIC_API_KEY=`를 추가하거나 `init`을 다시 실행")을 담은 오류로 반환한다.
- 해석된 값은 로그·`status` 출력에 절대 노출하지 않는다. `status`는 `env:ANTHROPIC_API_KEY` / `literal:****` 형태로만 표시한다 (가드레일 4).
- `nativeLang`는 ISO 639-1(2자) 또는 639-3(3자) 소문자 코드. `mode`는 `smart|full|summary`.

## 7. 환경변수 (.env.example로 커밋 — config 대신 env 참조도 허용)

```
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
TELEGRAM_BOT_TOKEN=
```

## 8. 확장 경로 (설계만, 구현 금지)

- **메신저 추가**: MessengerAdapter 구현 1개 + init 선택지 추가 (Slack=Socket Mode, Viber=웹훅+터널 안내).
- **MCP 서버(v0.2)**: 같은 core를 `translate_document(path, to)` 도구로 노출 — 조회형 사용은 MCP, 이벤트 자율 처리는 이 에이전트.

## 9. 디렉터리 구조 (목표)

```
message/
  CLAUDE.md  README.md  package.json  .env.example
  docs/  fixtures/docs/  scripts/smoke.ts
  src/{core,adapters,mocks,cli}/
  tests/
```
