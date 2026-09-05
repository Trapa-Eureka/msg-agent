# TASKS — message v0.1 백로그

## 사용법

- 한 에이전트 세션 = 한 태스크. 프롬프트 템플릿:
  > `docs/SPEC.md`, `docs/DESIGN.md`, `docs/TESTING.md`를 읽고 **T4**를 수행해. 완료 기준을 전부 충족하고 `npm run check`가 통과할 때까지 스스로 수정해. 끝나면 변경 파일과 검증 결과를 요약해.
- 완료 기준은 전부 기계 판정 가능. 완료 시 상태 `DONE(날짜)` + 커밋(`T{n}: 요약`).
- 병렬 레인: T1 완료 후 **A(T2), B(T3), C(T4), D(T5)** 는 서로 다른 worktree 에이전트로 동시 진행 가능.

의존 그래프: `T0 → T1 → {A: T2, B: T3, C: T4, D: T5} → T6(T2~T5) → {T7(T6), T8(T6)} → T9(T7,T8) → T10(T9) → T11`

---

### T0 — 프로젝트 스캐폴딩 · 상태: DONE(2026-09-05)
- 목표: TS strict + ESLint + Prettier + Vitest + 스크립트(`check/test/typecheck/lint/cli/smoke`), `.env.example`, `.gitignore`(.env, ~/.message는 홈이라 무관).
- 완료 기준: [x] `npm run check` 통과 [x] 더미 테스트 1개 [x] git init + 첫 커밋
- 결정 기록: 패키지명 임시 `message` + `private: true`(T11에서 해제) / CLI 호출 형식 `npm run cli -- <cmd>`로 통일 / ESM(`type: module`) + TypeScript 5.x 고정(typescript-eslint 호환) / Prettier는 `*.md` 제외(문서는 손대지 않음)

### T1 — 타입·설정 스키마 · 상태: DONE(2026-09-05) · 의존: T0
- 목표: `core/types.ts`(DESIGN §2 전체), config zod 스키마 + `configStore`(로드/저장, 파일 권한 600, env 참조 해석).
- 완료 기준: [x] 설정 라운드트립·오류 케이스(필수 누락·잘못된 언어코드 → 수정 방법 안내) 테스트 [x] check 통과
- 결정 기록: 오류는 throw 대신 `Result` + 코드(`ConfigIssue`)로 반환하고 문구는 `core/configMessages.ts`(ko/en)에만 둔다 → T8 문구 팩으로 이관 / 언어 코드 검증·정규화는 `iso-639-3` 테이블(639-1 우선) / `.env`는 의존성 없이 `process.loadEnvFile` / 시크릿은 `redactSecretRef`로만 표시

### T2 (레인 A) — 추출기 3종 · 상태: TODO · 의존: T1
- 목표: pdf-parse·mammoth·UTF-8 추출기 + 섹션 구조화, `fixtures/docs/` 제작(TESTING §2 목록 전부).
- 완료 기준: [ ] 형식별 정상 추출 테스트 [ ] 빈 텍스트·암호 PDF가 명확한 실패 타입 반환 [ ] check 통과

### T3 (레인 B) — 감지·분할·플래너 · 상태: TODO · 의존: T1
- 목표: franc 기반 detector(+신뢰도), 섹션 경계 chunker, outputPlanner(smart 정책).
- 완료 기준: [ ] **TESTING §3 골든 플랜 7종 전부** [ ] RTL·CJK 분할 무결성 [ ] check 통과

### T4 (레인 C) — 번역 프로바이더 · 상태: TODO · 의존: T1
- 목표: TranslatorProvider 인터페이스 + Claude·OpenAI 어댑터(주입 fetch), FakeTranslator(마커·실패 주입·호출 계수), 번역·요약 프롬프트 템플릿.
- 완료 기준: [ ] 목 fetch로 요청 형태 검증 [ ] 프롬프트에 "수치·고유명사 보존, 번역문만 출력" 명시 [ ] check 통과

### T5 (레인 D) — Telegram 어댑터 + FakeMessenger · 상태: TODO · 의존: T1
- 목표: grammY 어댑터(문서 이벤트→IncomingDoc, 명령 라우팅, 4,096자 분할 postText, sendDocument), FakeMessenger(동일 분할 규칙).
- 완료 기준: [ ] 분할 규칙 단위 테스트(어댑터·페이크 공용 함수) [ ] 20MB 초과 메타 → 다운로드 미시도 [ ] 실호출 없는 요청 형태 테스트 [ ] check 통과

### T6 — 파이프라인 · 상태: TODO · 의존: T2, T3, T4, T5
- 목표: `core/pipeline.ts` — DESIGN §3의 8단계 + 명령 처리(마지막 문서 참조는 메모리·메타만).
- 완료 기준: [ ] **TESTING §4 체크리스트 전 항목** (프라이버시·비용 가드 포함) [ ] check 통과

### T7 — CLI 온보딩·데몬 · 상태: TODO · 의존: T6
- 목표: `cli/init`(3문항 대화형 + 키·토큰 즉시 검증), `cli/start`(데몬, 종료 시그널 정리), `cli/status`.
- 완료 기준: [ ] prompts 주입식 단위 테스트(비대화형 모드) [ ] 검증 실패 시 수정 방법 안내 [ ] check 통과

### T8 — 사용자 문구 팩 · 상태: TODO · 의존: T6
- 목표: 사용자 대면 메시지(진행·스킵·거절·오류)를 모국어로 렌더 — 최소 ko·en 문구 팩 + 언어 폴백(en).
- 완료 기준: [ ] 문구 키 누락 시 빌드 실패(타입으로 강제) [ ] ko/en 스냅샷 테스트 [ ] check 통과

### T9 — e2e-mock · 상태: TODO · 의존: T7, T8
- 목표: FakeMessenger로 SPEC §7 시나리오 전부(짧은/긴/스킵/명령 4종/동시 2채팅)를 데몬 조립 상태에서 검증.
- 완료 기준: [ ] 시나리오 전부 통과 [ ] check 통과

### T10 — 커버리지 + 프라이버시 감사 테스트 · 상태: TODO · 의존: T9
- 목표: core ≥ 90% 리포트, 로그·임시파일 본문 잔류 부재 자동 검사(시그니처 문자열 기법) 상시 테스트화.
- 완료 기준: [ ] 리포트 첨부 [ ] 감사 테스트가 check에 포함 [ ] check 통과

### T11 — 스모크 + 공개 준비 · 상태: TODO · 의존: T10
- 목표: `scripts/smoke.ts`(TESTING §5, 그룹 프라이버시 모드 확인 포함), README 퀵스타트 실명령 갱신, npm 패키지명 후보 3개 조사·기록(퍼블리시는 사람 승인).
- 완료 기준: [ ] smoke 체크리스트 출력 [ ] README 온보딩 5줄 이내 [ ] 패키지명 후보 SPEC §8에 기록 [ ] check 통과

---

## v0.2 대기열 (착수 금지 — SPEC 로드맵 참조)

- Slack 어댑터(Socket Mode) / MCP 서버(`translate_document`) / OCR(스캔 PDF·이미지) / `/pages` 부분 번역 / Gemini 프로바이더
