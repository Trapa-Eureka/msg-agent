# CLAUDE.md — message 스티어링

메신저 업로드 문서를 모국어로 자동 번역하는 개인용 에이전트. v0.1 메신저는 Telegram(long polling), 출력은 스마트 모드. 스펙은 `docs/SPEC.md`, 설계는 `docs/DESIGN.md`.

## 스택

- Node.js 22.12+ (commander 15·`util.parseEnv` 요구), TypeScript **strict** (`noUncheckedIndexedAccess` 포함)
- Telegram: **grammY** (타입 우수, long polling 내장) — 단 코어는 grammY를 모르고 `MessengerAdapter`만 안다
- 문서 추출: `pdf-parse`(텍스트형 PDF), `mammoth`(DOCX), UTF-8 직독(TXT/MD)
- 언어 감지: `franc` 계열(결정론) → 불확실 시 번역 프롬프트에 감지 위임
- 번역: `TranslatorProvider` 인터페이스 — Claude(기본)·OpenAI 어댑터, Gemini는 v0.2 후보
- CLI: `commander` + `prompts` (온보딩 대화형)
- 검증: Vitest + ESLint + Prettier, 스키마 `zod`

## 명령어

```bash
npm run check      # typecheck + lint + format:check + test(커버리지 임계치·프라이버시 감사 포함) — 태스크 완료의 필수 게이트
npm run test       # vitest run
npm run typecheck  # tsc --noEmit
npm run lint       # eslint .
npm run cli -- <init|start|status>   # tsx 경유 CLI 실행
npm run smoke      # 실 Telegram 봇 + 실 프로바이더 수동 스모크 (사람 전용)
```

## 소스 레이아웃

```
src/
  core/        # 순수 로직: pipeline, chunker, outputPlanner, detector 규약, config 스키마 — 외부 IO 없음
  adapters/    # telegramAdapter(grammY), extractors/, providers/(claude, openai), configStore
  mocks/       # FakeMessenger, FakeTranslator, FixtureExtractor, FixedClock
  cli/         # init.ts(온보딩), start.ts(데몬), status.ts — 조립만
tests/  fixtures/docs/  scripts/
```

## 컨벤션

- 코어는 어댑터 구현을 모른다. 메신저 추가 = `MessengerAdapter` 구현 1개.
- `any` 금지. 외부 입력(메신저 이벤트, 설정 파일, 프로바이더 응답)은 경계에서 `zod` 파싱.
- 긴 처리(다운로드→추출→번역)는 진행 상태를 대화창에 알린다("번역 중… 3/7 청크") — UX가 곧 제품.
- 에러 메시지는 원인 + 수정 방법까지, 사용자 대면 메시지는 모국어로.
- 커밋 메시지: **영어로 작성**. 태스크 커밋은 `T{n}: summary`, 그 외는 `docs:`/`chore:`/`fix:` 접두사.

## 가드레일 (위반 금지)

1. **문서 내용 무저장**: 원문·번역문을 디스크에 남기지 않는다(임시 파일은 처리 직후 삭제, 전송용 파일은 전송 후 삭제). 로그에는 메타데이터만(파일명·크기·언어·소요) — **내용·본문 일부라도 로그 금지.**
2. **게시 범위 고정**: 번역 결과는 문서가 올라온 그 대화창에만 게시한다. 다른 채팅·외부로 전달하는 코드 경로 금지.
3. 테스트에서 **네트워크 호출 0건**: 메신저·번역기·추출기 전부 목/픽스처.
4. API 키·봇 토큰은 로컬 설정 파일(권한 600)과 .env만. 커밋 금지, 로그 출력 금지.
5. **비용 상한 존중**: 문서당 최대 크기·토큰 상한(config) 초과 시 번역하지 말고 요약 모드 제안 또는 거절 안내. 상한 무시 플래그 추가 금지.
6. 스펙·설계와 충돌 시 `docs/` 먼저 수정. 출력 모드 정책 변경은 SPEC §4가 선행.

## 작업 방식

- 한 세션 = `docs/TASKS.md`의 한 태스크. 완료 기준 전부 충족 + `npm run check` 통과까지 자가 수정 루프. 스펙 모호로 막힐 때만 질문.
- 완료 시 변경 파일·검증 결과 요약 후 종료.

## 프루닝 로그

격주 검토, 낡은 규칙 삭제 (`docs/WORKFLOW.md`).

- 2026-09-04: 최초 작성.
