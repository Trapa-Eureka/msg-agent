# TASKS — message v0.1 백로그

## 사용법

- 한 에이전트 세션 = 한 태스크. 프롬프트 템플릿:
  > `docs/SPEC.md`, `docs/DESIGN.md`, `docs/TESTING.md`를 읽고 **T4**를 수행해. 완료 기준을 전부 충족하고 `npm run check`가 통과할 때까지 스스로 수정해. 끝나면 변경 파일과 검증 결과를 요약해.
- 완료 기준은 전부 기계 판정 가능. 완료 시 상태 `DONE(날짜)` + 커밋(`T{n}: 요약`).
- 병렬 레인: T1 완료 후 **A(T2), B(T3), C(T4), D(T5)** 는 서로 다른 worktree 에이전트로 동시 진행 가능.

의존 그래프: `T0 → T1 → {A: T2, B: T3, C: T4, D: T5} → T6(T2~T5) → {T7(T6), T8(T6)} → T9(T7,T8) → T10(T9) → T11`

**진행 상태(2026-09-05): T0~T11 전부 DONE.** 검수 대응 R1~R7 진행 중 → 완료 후 "릴리스 체크리스트".

---

### T0 — 프로젝트 스캐폴딩 · 상태: DONE(2026-09-05)
- 목표: TS strict + ESLint + Prettier + Vitest + 스크립트(`check/test/typecheck/lint/cli/smoke`), `.env.example`, `.gitignore`(.env, ~/.msg-agent는 홈이라 무관).
- 완료 기준: [x] `npm run check` 통과 [x] 더미 테스트 1개 [x] git init + 첫 커밋
- 결정 기록: 패키지명 임시 `message` + `private: true`(T11에서 해제) / CLI 호출 형식 `npm run cli -- <cmd>`로 통일 / ESM(`type: module`) + TypeScript 5.x 고정(typescript-eslint 호환) / Prettier는 `*.md` 제외(문서는 손대지 않음)

### T1 — 타입·설정 스키마 · 상태: DONE(2026-09-05) · 의존: T0
- 목표: `core/types.ts`(DESIGN §2 전체), config zod 스키마 + `configStore`(로드/저장, 파일 권한 600, env 참조 해석).
- 완료 기준: [x] 설정 라운드트립·오류 케이스(필수 누락·잘못된 언어코드 → 수정 방법 안내) 테스트 [x] check 통과
- 결정 기록: 오류는 throw 대신 `Result` + 코드(`ConfigIssue`)로 반환하고 문구는 `core/configMessages.ts`(ko/en)에만 둔다 → T8 문구 팩으로 이관 / 언어 코드 검증·정규화는 `iso-639-3` 테이블(639-1 우선) / `.env`는 의존성 없이 `process.loadEnvFile` / 시크릿은 `redactSecretRef`로만 표시

### T2 (레인 A) — 추출기 3종 · 상태: DONE(2026-09-05) · 의존: T1
- 목표: pdf-parse·mammoth·UTF-8 추출기 + 섹션 구조화, `fixtures/docs/` 제작(TESTING §2 목록 전부).
- 완료 기준: [x] 형식별 정상 추출 테스트 [x] 빈 텍스트·암호 PDF가 명확한 실패 타입 반환 [x] check 통과
- 결정 기록: `extract`는 `Result<ExtractedDoc, ExtractError>`(empty_text | encrypted | corrupt) 반환 / 섹션 구조화는 `core/sections.ts` 공용(빈 줄·Markdown 제목·짧은 무종결 행) + PDF 전용 행 복원(`pdfPagesToText`: 페이지 최장 행 대비 짧은 행 = 제목·문단 끝, CJK 줄바꿈은 공백 없이 결합) / DOCX 제목은 `#` Markdown으로 변환해 같은 휴리스틱 사용 / 픽스처는 `scripts/fixtures/generate.ts`(pdfkit·docx, macOS 폰트)로 생성해 커밋

### T3 (레인 B) — 감지·분할·플래너 · 상태: DONE(2026-09-05) · 의존: T1
- 목표: franc 기반 detector(+신뢰도), 섹션 경계 chunker, outputPlanner(smart 정책).
- 완료 기준: [x] **TESTING §3 골든 플랜 7종 전부** [x] RTL·CJK 분할 무결성 [x] check 통과
- 결정 기록: 신뢰도는 franc 점수 차(긴 글에서 0으로 수렴)가 아니라 표본 길이 × 전·후반 일치도로 계산, 기준 0.7 / `sco`(Scots)는 영어 그림자라 무시 / 청크 4,000자 기본, Intl.Segmenter 자소 단위로 하드 분할 / 플래너는 `PlanDecision`만 반환하고 실제 `OutputPlan` 조립은 T6

### T4 (레인 C) — 번역 프로바이더 · 상태: DONE(2026-09-05) · 의존: T1
- 목표: TranslatorProvider 인터페이스 + Claude·OpenAI 어댑터(주입 fetch), FakeTranslator(마커·실패 주입·호출 계수), 번역·요약 프롬프트 템플릿.
- 완료 기준: [x] 목 fetch로 요청 형태 검증 [x] 프롬프트에 "수치·고유명사 보존, 번역문만 출력" 명시 [x] check 통과
- 결정 기록: Claude는 공식 SDK에 `fetch` 주입(요청 형태는 목 fetch로 검증), 기본 `claude-sonnet-5`(사용자 결정, 비용)·번역 effort low·요약 medium·서버측 fallbacks 적용 / OpenAI는 Chat Completions raw fetch, 기본 `gpt-5` / 오류는 `ProviderError`(kind·retryable·status·detail=오류명만)로 통일, 청크 재시도는 T6 파이프라인 / `verify()`는 models 조회로 토큰 소모 없음 / 프롬프트는 `core/prompts.ts` 한 곳

### T5 (레인 D) — Telegram 어댑터 + FakeMessenger · 상태: DONE(2026-09-05) · 의존: T1
- 목표: grammY 어댑터(문서 이벤트→IncomingDoc, 명령 라우팅, 4,096자 분할 postText, sendDocument), FakeMessenger(동일 분할 규칙).
- 완료 기준: [x] 분할 규칙 단위 테스트(어댑터·페이크 공용 함수) [x] 20MB 초과 메타 → 다운로드 미시도 [x] 실호출 없는 요청 형태 테스트 [x] check 통과
- 결정 기록: 분할 규칙은 `core/textSplit.ts`(문단→줄→문장→자소) 하나를 어댑터·페이크가 공유 / `download()`는 지연 실행이며 어댑터가 20MB 초과를 자체 거부(getFile 미호출) / 명령 자동완성은 `start()`에서 `setMyCommands` / 테스트는 `botInfo` 주입 + `api.config.use` 트랜스포머 + `handleUpdate` + 주입 fetch로 네트워크 0건 / 분할 게시 시 첫 파트만 원본 메시지에 reply

### T6 — 파이프라인 · 상태: DONE(2026-09-05) · 의존: T2, T3, T4, T5
- 목표: `core/pipeline.ts` — DESIGN §3의 8단계 + 명령 처리(마지막 문서 참조는 메모리·메타만).
- 완료 기준: [x] **TESTING §4 체크리스트 전 항목** (프라이버시·비용 가드 포함) [x] check 통과
- 결정 기록: 사용자 문구는 `Phrases` 인터페이스(core/phrases.ts, 20개 키)로만 나가고 코어에 리터럴 없음 → T8이 ko/en 구현 / 설정 저장·로그·시계는 `SettingsStore`·`Logger`·`Clock` 포트로 주입 / 번역은 청크당 1호출 + retryable이면 1회 재시도, 실패 시 번역문 미게시 / 채팅별 직렬화 큐 / 진행 알림은 청크 ≥2일 때 최대 4회 / 목 추가: FakePhrases(키 태그 출력), MemorySettings, CapturingLogger, FixedClock, FixtureExtractor(+syntheticDoc)

### T7 — CLI 온보딩·데몬 · 상태: DONE(2026-09-05) · 의존: T6
- 목표: `cli/init`(3문항 대화형 + 키·토큰 즉시 검증), `cli/start`(데몬, 종료 시그널 정리), `cli/status`.
- 완료 기준: [x] prompts 주입식 단위 테스트(비대화형 모드) [x] 검증 실패 시 수정 방법 안내 [x] check 통과
- 결정 기록: 세 명령은 `runInit/runStart/runStatus`(의존성 주입) + `cli/index.ts` 조립(commander·prompts·grammY getMe) / 키·토큰은 환경변수가 있으면 `env:` 참조 제안, 없으면 `literal:` 저장, 검증 실패 시 원인+수정 방법 후 최대 3회 재입력 / 화면 문구는 `cli/text.ts`(ko/en) / `FileSettings`(configStore 래퍼)·`ConsoleLogger`(stderr JSON lines) 어댑터 추가 / 문구 팩은 임시로 `src/phrases/en.ts`만 — **T8이 ko·폴백·스냅샷 추가**

### T8 — 사용자 문구 팩 · 상태: DONE(2026-09-05) · 의존: T6
- 목표: 사용자 대면 메시지(진행·스킵·거절·오류)를 모국어로 렌더 — 최소 ko·en 문구 팩 + 언어 폴백(en).
- 완료 기준: [x] 문구 키 누락 시 빌드 실패(타입으로 강제) [x] ko/en 스냅샷 테스트 [x] check 통과
- 결정 기록: `src/phrases/{ko,en}.ts`가 `satisfies Phrases`(키 하나 빼고 컴파일하면 실패함을 확인) / `phrasesFor`는 ISO 표기 정규화 후 없으면 en 폴백 / 언어명은 `Intl.DisplayNames`로 팩 언어에 맞춰 렌더(파이프라인은 코드만 전달) / 스냅샷 `tests/__snapshots__/phrases.test.ts.snap` (20키 × 2언어) / CLI 화면 문구(`cli/text.ts`)와 config 오류 문구(`core/configMessages.ts`)는 메신저 팩과 별개로 유지

### T9 — e2e-mock · 상태: DONE(2026-09-05) · 의존: T7, T8
- 목표: FakeMessenger로 SPEC §7 시나리오 전부(짧은/긴/스킵/명령 4종/동시 2채팅)를 데몬 조립 상태에서 검증.
- 완료 기준: [x] 시나리오 전부 통과 [x] check 통과
- 결정 기록: `tests/e2e.test.ts`는 `runStart`로 실제 조립(실 추출기·franc·ko/en 문구 팩·파일 설정 저장소)하고 메신저·번역기만 가짜 / 시나리오 9종: 짧은 PDF 인라인, 긴 PDF 요약+파일, 한국어 스킵, 스캔·암호·미지원·상한 초과 안내, 명령 4종(설정 파일 영속·언어 전환 후 EN 문구), 동시 2채팅, 로그·출력·디스크 무잔류, 세션 비용 가드 / 발견·수정: pdf.js가 입력 버퍼를 detach해 같은 바이트 재추출이 실패하던 문제 → PdfExtractor가 복사본 전달

### T10 — 커버리지 + 프라이버시 감사 테스트 · 상태: DONE(2026-09-05) · 의존: T9
- 목표: core ≥ 90% 리포트, 로그·임시파일 본문 잔류 부재 자동 검사(시그니처 문자열 기법) 상시 테스트화.
- 완료 기준: [x] 리포트 첨부(`docs/COVERAGE.md`: core 96.9% / lines 97.2%) [x] 감사 테스트가 check에 포함(`tests/privacy-audit.test.ts`) [x] check 통과
- 결정 기록: `npm run check`의 test 단계를 `vitest run --coverage`로 바꾸고 vitest 임계치(statements/lines/functions 90, branches 80)로 강제 — 임계치 99로 돌려 실패함을 확인 / 감사는 정적(디스크 쓰기 API는 configStore만, console은 cli만, 로거 메타에 본문 키 금지) + 런타임(시그니처 3개, 실 ConsoleLogger·stdout/stderr 스파이, 성공·실패 경로, cwd·설정 디렉터리 무잔류) 두 층 / 감사 테스트는 삭제·완화 금지(WORKFLOW §2)

### T11 — 스모크 + 공개 준비 · 상태: DONE(2026-09-05) · 의존: T10
- 목표: `scripts/smoke.ts`(TESTING §5, 그룹 프라이버시 모드 확인 포함), README 퀵스타트 실명령 갱신, npm 패키지명 후보 3개 조사·기록(퍼블리시는 사람 승인).
- 완료 기준: [x] smoke 체크리스트 출력 [x] README 온보딩 5줄 이내(3줄) [x] 패키지명 후보 SPEC §8에 기록 [x] check 통과
- 결정 기록: 스모크는 `runStart`를 그대로 조립하고 로거를 감싸 파이프라인 이벤트(doc.received/planned/done)로 체크리스트를 채움 — 본문은 절대 출력하지 않음 / 그룹 프라이버시 모드는 getMe의 `can_read_all_group_messages`로 판정(그룹 업로드 없이 확인 가능) / `--chat`이 있으면 안내 메시지 게시, `--wait`(기본 300초) 동안 문서 1건 대기 / 후보: msg-agent · docslate · chatdoc-translate (+ `@shiz_son/msg-agent`) / **실 스모크 실행·패키지명 확정·publish는 사람 몫(HUMAN_PREP §2·§3)**

---

## 검수 대응 (R 시리즈) · 2026-09-05 코드 검수(`docs/001_CODE_REVIEW.md`)·보안 검수(`docs/002_SECURITY_REVIEW.md`)

릴리스 전에 처리한다. 한 세션 = 한 R 태스크, 완료 시 `npm run check` + PR 머지. 번호는 검수 문서의 항목 번호.

### R1 — 접근 제어 · 상태: DONE(2026-09-06) · [01, SEC-01, SEC-12 일부]
- 목표: 소유자·허용 채팅 기반 기본 거절. 이벤트에 발신자 `userId` 추가. 페어링: `start` 시 터미널에 6자리 코드 출력 → 소유자가 봇에 `/start <코드>` → 소유자 등록 + 그 채팅 허용. 소유자 명령 `/allow`(현재 채팅 허용)·`/deny`. 문서·`/full`·`/summary`는 허용 채팅 또는 소유자만, `/mode`·`/lang`은 소유자만. 거절은 조용히(로그 메타만). config `access` 스키마(strict, 알 수 없는 키 거절).
- 완료 기준: [x] 미허용 사용자 문서 → 다운로드 0건 [x] 비소유자 `/mode` 무시 [x] 페어링·allow/deny e2e [x] check 통과
- 결정 기록: config 루트·provider·messenger·access 모두 `strictObject`(알 수 없는 키 → invalid_value "unknown key") / 페어링 코드는 `start`가 crypto.randomInt로 생성·터미널 출력·1회 사용·프로세스 수명 / 거절은 `access.denied`(kind·chatId·userId) 경고 로그만 / FakeMessenger 이벤트의 기본 userId는 "owner"라 기존 테스트는 소유자 시나리오로 동작 / **기존 설정 파일은 페어링 전이므로 `start` 후 `/start <코드>` 필요**

### R2 — 비용·속도 가드 · 상태: DONE(2026-09-06) · [02, 07, 15, SEC-02]
- 목표: 비용 가드를 전송 길이(공백 포함)로 계산, 문서당 최대 청크 수, 채팅별 시간당 문서 수·전역 일일 문자 예산(메모리, 메타만). Claude SDK `maxRetries: 0`(재시도는 파이프라인 1회만), OpenAI `max_completion_tokens`. 상한 초과 단일 자소는 코드포인트 분할로 길이 불변식 유지.
- 완료 기준: [x] 공백 우회 케이스 reject(399,400자 → rejectOverMax) [x] 529 목에서 청크당 요청 ≤ 2(SDK maxRetries 0 → 시도당 1회) [x] 자소 4,201자 케이스 길이 ≤ 4,096 [x] check 통과
- 결정 기록: 비용 척도 = 정규화 텍스트 `length`(공백 포함) / `maxChunksPerDoc` 기본 50(파이프라인 옵션) / `limits`(strict) 기본 20건/시·1,000,000자/일, 재실행 명령도 건수에 포함, 요약 경로는 문자 2배 청구 / 상한 초과 안내는 `/summary` 제안 대신 파일 분할 안내(11번 해결) / OpenAI `max_completion_tokens` 16000 / 자소가 상한보다 길면 코드포인트 분할(길이 불변식 > 자소 무결성)

### R3 — 비밀값·설정 파일 안전 · 상태: DONE(2026-09-06) · [03, 12, SEC-04, SEC-05, SEC-06, SEC-07, SEC-13]
- 목표: JSON 오류 원문 미출력(고정 코드), 원자적 저장(임시 600 → rename), 로드 시 심볼릭 링크·느슨한 권한 거절, `.env`는 허용 키 3개만 선택 로드, Claude SDK `logLevel: "off"` + 공식 baseURL 고정, `.gitignore`에 `.msg-agent/`.
- 완료 기준: [x] 시그니처 포함 잘못된 JSON 출력 누출 0 [x] 저장 실패 시 원본 보존(디렉터리 500으로 쓰기 실패 주입) [x] `ANTHROPIC_BASE_URL`·`ANTHROPIC_LOG` 무시(SDK baseURL 고정·logLevel off·.env 선택 로드) [x] check 통과
- 결정 기록: 로드 시 심볼릭 링크·비정규 파일·group/other 비트 → `unreadable`(detail 코드: symlink / not_regular_file / insecure_permissions, 수정 방법 안내) — 느슨한 권한을 조용히 고치지 않고 거절 / 저장은 임시 파일(`wx`, 600) → rename, 실패 시 임시 파일 제거 / `.env`는 `util.parseEnv`로 허용 키 3개만 / `.gitignore`에 `.msg-agent/`

### R4 — 외부 경계 검증·기한 · 상태: DONE(2026-09-06) · [06, 14, SEC-03 부분, SEC-08, SEC-09, SEC-12]
- 목표: OpenAI 응답 zod 검증(→ `bad_response`), Claude 응답 형태 검사, OpenAI fetch·Telegram 다운로드에 AbortSignal 기한 + 스트리밍 누적 바이트 상한(getFile file_size 검증 포함), Claude SDK timeout.
- 완료 기준: [x] `null`/숫자 content → `bad_response`(zod, 5가지 비정상 형태) [x] 한도 초과 스트림 중단(getFile file_size·content-length·스트림 누적 3중) [x] check 통과
- 결정 기록: OpenAI `AbortSignal.timeout` 90초(초과 시 network/timeout 재시도 가능), Claude SDK `timeout` 120초, Telegram 다운로드 60초(grammY getFile은 자체 시그널 타입이라 본문 fetch에만 적용) / 파이프라인이 받은 바이트 길이를 재검사 / DOCX: JSZip으로 엔트리 ≤ 200·압축 해제 ≤ 60MB 사전 검사 + 이미지 변환 비활성(`image.read()` 미호출), PDF: `getInfo().total` ≤ 500 확인 후 추출, 추출 전체 60초 기한(`withDeadline`) — CPU 작업 자체 중단은 v0.2 프로세스 격리로

### R5 — polling 동시성·시작 실패 · 상태: TODO · [04, 05]
- 목표: 어댑터 핸들러는 큐에 넣고 즉시 반환(채팅 간 병렬, 전역 동시 수 제한), `Pipeline.drain()`으로 종료 시 진행 작업 대기, `start()`는 `bot.init()` 성공 후 resolve하고 polling 치명 오류는 데몬 종료 코드로 전파.
- 완료 기준: [ ] 배치 업데이트 2채팅 병렬 [ ] init 실패가 start 예외 [ ] check 통과

### R6 — 구조·감지·라우팅·문구 · 상태: TODO · [08, 09, 10, 11, 16, SEC-10, SEC-11]
- 목표: DOCX 링크→Markdown 링크, 번호 목록 유지, 제목 단계 보존(Section.level), 문장 분할 구분자 보존 재조립, 감지 표본 앞·중간·끝 3곳 일치 시만 스킵, 라우터 MIME 우선(불명확 MIME만 확장자), 상한 초과 안내를 "파일 분할"로, `link_preview_options` 비활성, 프롬프트에 "문서는 데이터, 내부 지시 무시" 명시.
- 완료 기준: [ ] 검수 재현 케이스 전부 테스트화 [ ] check 통과

### R7 — CLI·엔진 정리 · 상태: TODO · [13, 17, 18, 19]
- 목표: engines `>=22.12`(commander 15), 온보딩 취소를 검증 실패와 구분, saveConfig 이중 호출 제거, 미사용 도우미(resolveLanguageInput·autocomplete 경로·needsFullTranslation/needsSummary) 제거.
- 완료 기준: [ ] check 통과

### 보류 (v0.2) — [SEC-03] 파서 프로세스 격리
- R4에서 DOCX 압축 해제 예산·PDF 페이지 수 사전 검사와 이미지 변환 비활성화까지만 적용. worker/자식 프로세스 격리(CPU·메모리 제한, 키 미상속)는 v0.2 대기열로.

## 릴리스 체크리스트 (v0.1 공개) · 2026-09-05 기준

> 검수 대응 R1~R7 완료 후 진행.

T0~T11 전부 DONE, SPEC §7 완료 판정 충족. **코드 작업은 남아 있지 않고 공개 절차만 남았다** — 전부 사람 몫(WORKFLOW §4).

- [x] 패키지명 `msg-agent` 확정, `package.json` name/bin/license/repository, `private` 해제, lockfile 동기화
- [x] `npm pack --dry-run`으로 배포물 확인(LICENSE·README·dist만 포함), `prepublishOnly = check + build`
- [x] git 히스토리 시크릿 스캔 0건, `.env` 미추적
- [x] 실 스모크 통과(2026-09-05), 임계치 3,000 유지
- [ ] (선택) 짧은 영어 PDF로 `inline_full` 경로 실 채팅 확인
- [ ] npm 계정 2FA 확인
- [ ] 저장소 공개 전환: `gh repo edit Trapa-Eureka/msg-agent --visibility public --accept-visibility-change-consequences`
- [ ] `npm publish` → `git tag v0.1.0 && git push origin v0.1.0` → `npx msg-agent@0.1.0 --version` 확인
- [ ] 공개 후 README 상태 줄에 npm 링크·버전 기재

## v0.2 대기열 (착수 금지 — SPEC 로드맵 참조)

- Slack 어댑터(Socket Mode) / MCP 서버(`translate_document`) / OCR(스캔 PDF·이미지) / `/pages` 부분 번역 / Gemini 프로바이더
