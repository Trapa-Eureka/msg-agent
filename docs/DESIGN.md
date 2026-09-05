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

코어는 메신저·프로바이더 구현을 모른다. 이벤트는 정규화된 `IncomingDoc`/`IncomingCommand`로, 출력은 `OutputPlan`으로만 주고받는다.

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

export interface DocumentExtractor { supports(mime: string, name: string): boolean; extract(bytes: Uint8Array): Promise<ExtractedDoc> }
export interface ExtractedDoc { text: string; sections: Section[] }        // 제목/문단 구조 유지

export interface LanguageDetector { detect(text: string): { lang: string; confidence: number } }

export interface TranslatorProvider {
  translate(chunks: Chunk[], to: string, opts: { sourceLangHint?: string }): Promise<TranslatedChunk[]>;
  summarize(doc: ExtractedDoc, to: string): Promise<string>;               // 구조 요약 (SPEC §4)
}

export type OutputPlan =
  | { kind: "inline_full"; parts: string[] }
  | { kind: "summary_plus_file"; summary: string; file: { name: string; content: string } }
  | { kind: "skip_same_lang"; note: string }
  | { kind: "reject"; reason: string };                                    // 상한 초과·미지원 형식 등
```

## 3. 파이프라인 (core/pipeline.ts)

1. `IncomingDoc` 수신 → 크기·형식 가드 (미지원/초과 → `reject` 플랜, 사유는 모국어 문구)
2. 진행 알림 게시 → 다운로드 → 추출기 라우팅(`supports`) → `ExtractedDoc`
3. 언어 감지 — 감지 언어 = 모국어면 `skip_same_lang`. 신뢰도 낮으면 `sourceLangHint` 없이 번역 프롬프트에 위임
4. `outputPlanner`: 추출 텍스트 길이 vs 임계치·사용자 모드(config) → 플랜 종류 결정
5. 전문 경로: `chunker`(섹션 경계 우선 분할, 청크 순번 부여) → `translate` (진행 상태 n/m 갱신) → 순서대로 조립
6. 요약 경로: `summarize` + 전문 번역은 .md 파일 조립
7. 어댑터로 플랜 실행 → 임시 데이터 즉시 폐기 (가드레일 1)
8. 실패 시: 청크 단위 1회 재시도 → 그래도 실패면 부분 결과 여부를 알리고 모국어 오류 안내

명령 처리: `/full`은 직전 문서 재처리가 아니라 **마지막 문서의 전문 플랜 재실행** — 이를 위해 채팅별로 "마지막 문서 참조(파일 ID·메타만, 내용 아님)"를 메모리에 보관 (프로세스 재시작 시 소멸 — 의도된 동작, 가드레일 1과 일관).

## 4. Telegram 어댑터 메모

- grammY long polling. 문서 핸들러: `message:document` → getFile → 다운로드(봇 한도 20MB — 초과 시 reject 플랜).
- `postText`는 4,096자 제한에 맞춰 문단 경계로 분할 게시. `postFile`은 sendDocument.
- 명령은 BotFather에 등록(`/full`, `/summary`, `/mode`, `/lang`) — 자동완성 노출.
- 그룹에서는 봇 프라이버시 모드 이슈로 문서 수신만 처리(문서는 프라이버시 모드에서도 수신됨을 스모크로 확인, 아니면 온보딩 안내에 프라이버시 해제 절차 추가).

## 5. 프로바이더 메모

- ClaudeProvider(기본)·OpenAIProvider — 공통: 청크별 번역 프롬프트(용어·수치·고유명사 보존 지시, 출력은 번역문만), 요약 프롬프트(제목·핵심 조항·수치·요청사항 구조).
- 온보딩 `init`에서 키 검증 1회 호출. 실패 시 수정 방법 담긴 안내.
- 토큰 상한(config `maxChars`) 초과 문서는 planner가 요약 모드 강제 제안 → 사용자가 `/full`로 명시 요청해도 상한 초과면 거절 사유 안내 (가드레일 5).

## 6. 설정 (adapters/configStore — ~/.message/config.json, 권한 600)

```json
{
  "nativeLang": "ko",
  "provider": { "kind": "claude", "apiKeyRef": "env:ANTHROPIC_API_KEY 또는 파일 내 저장" },
  "messenger": { "kind": "telegram", "tokenRef": "..." },
  "mode": "smart", "inlineThresholdChars": 3000, "maxChars": 120000
}
```

zod 스키마로 로드 검증. CLI `status`는 설정 요약 + 봇 연결 상태 출력.

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
