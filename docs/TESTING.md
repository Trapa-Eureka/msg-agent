# TESTING — message

목적: 실제 메신저·실제 LLM 없이 파이프라인 전체를 로컬 결정론으로 검증한다. 번역 품질은 스모크·사용으로 보고, 테스트는 **배관(추출→감지→계획→분할→조립→게시)과 정책(스마트 모드·가드)**을 고정한다.

## 1. 원칙

- 테스트 네트워크 호출 0건. 메신저=FakeMessenger, 번역=FakeTranslator, 추출=실 라이브러리(로컬 파일이라 허용) + 픽스처 문서.
- FakeTranslator는 결정론 마커 변환: `translate` → 각 청크를 `«KO:{원문}»` 형태로 반환, `summarize` → 섹션 제목 나열. 조립 순서·누락을 기계 검증 가능.
- `npm run check` = typecheck + lint + test. 전체 수 초 내.

## 2. 목·픽스처 구성

| 구성요소 | 내용 |
|---|---|
| `FakeMessenger` | `emitDocument()/emitCommand()`로 이벤트 주입, postText/postFile 호출을 배열에 기록. 4,096자 분할 규칙 포함 구현 |
| `FakeTranslator` | 마커 변환 + `failOnChunk: n` 실패 주입 + 호출 수 기록(비용 가드 검증) |
| `FixtureExtractor` | 확장자→고정 ExtractedDoc 매핑 (실 추출기 단위 테스트는 별도) |
| `FixedClock` | 진행 메시지 타임스탬프 결정론 |
| fixtures/docs/ | 영어 PDF(짧은/긴)·MD, 스페인어 DOCX, 일본어 TXT, 한국어 PDF(같은 언어 스킵용), 빈 텍스트 PDF(스캔 흉내), 암호 PDF, RTL(아랍어) TXT, 대용량 더미(maxChars 초과용 TXT ~130k자; 20MB 초과는 파일 없이 메타만으로 검증). `npm run fixtures`로 재생성(scripts/fixtures/generate.ts, macOS 폰트 필요) |

## 3. 골든 플랜 케이스 (outputPlanner 단위)

- 2,000자 영어 + 모국어 ko + smart → `inline_full`
- 30,000자 영어 + smart → `summary_plus_file`
- 2,000자 + mode=summary → `summary_plus_file`
- 30,000자 + mode=full(상한 이내) → `file_full` — **full 모드도 임계치 초과면 파일 첨부로 전문 제공**(채팅 도배 방지). 채팅에는 짧은 머리말(`note`)만, 전문은 .md 파일. 이 정책을 케이스로 고정
- 감지=ko(모국어) → `skip_same_lang`
- maxChars 초과 → `reject`(요약 제안 문구 포함)
- 미지원 형식(.xlsx) → `reject`(지원 형식 안내)

## 4. 필수 엣지 케이스 체크리스트 (component — 파이프라인) · T6에서 전 항목 테스트화(tests/pipeline.test.ts, 2026-09-05)

**입력·추출**
- [x] PDF/DOCX/TXT 각 1건 정상 경로 (실 추출기 + 픽스처 파일)
- [x] 빈 텍스트 PDF(스캔본) → "텍스트를 추출할 수 없음(스캔본은 v0.2 OCR 예정)" 모국어 안내
- [x] 암호 PDF → 명확한 안내, 크래시 없음
- [x] 20MB 초과 메타 → 다운로드 시도 없이 reject

**분할·조립**
- [x] 섹션 경계 우선 분할, 청크 순서 보존 조립 (마커로 검증)
- [x] 청크 1개 실패 주입 → 1회 재시도 → 성공 시 완성 / 재실패 시 부분 실패 안내 + 완역 미게시
- [x] RTL·CJK 텍스트 분할에서 문자 깨짐 없음

**정책·명령**
- [x] 골든 플랜 7종(§3) 전부
- [x] `/full` — 마지막 문서를 `file_full` 플랜으로 재실행(전문 파일 게시), 문서 이력 없으면 안내
- [x] `/mode`, `/lang` — config 반영·확인 메시지, 잘못된 인자 안내
- [x] 같은 언어 스킵 1줄 응답

**게시·프라이버시**
- [x] 4,096자 초과 전문 → 문단 경계 분할 다중 postText, 순서 보장
- [x] 게시 대상 chatId = 수신 chatId 고정 (다른 chatId 게시 시도 시 테스트 실패)
- [x] 처리 종료 후 임시 버퍼·파일 잔류 없음 / 로그 캡처에 본문 문자열 미포함 (본문 시그니처 문자열로 검사)
- [x] FakeTranslator 호출 수 ≤ 청크 수 + 요약 1 (중복 호출 = 비용 누수 가드)

**동시성**
- [x] 서로 다른 chat 2건 동시 업로드 → 진행 메시지·결과 혼입 없음

## 5. 수동 스모크 (사람 전용 — scripts/smoke.ts)

`npm run smoke`: 실 봇 토큰 + 실 프로바이더로 ① 봇 getMe 확인 ② 지정 chat에 안내 게시 ③ 사람이 영어 PDF 업로드 → 요약+파일 수신 확인 체크리스트 출력. 그룹 프라이버시 모드에서 문서 수신 여부도 이때 확인해 SPEC/온보딩 문구를 갱신한다.

## 6. 커버리지

- `src/core/` 90% 이상 — vitest 임계치로 `npm run check`에서 강제(statements/lines/functions 90, branches 80). 리포트: `docs/COVERAGE.md`. 어댑터·CLI는 스모크 보완.
- 프라이버시 감사(`tests/privacy-audit.test.ts`)도 check에 포함: 정적 스캔(디스크 쓰기·console 허용 파일 고정) + 런타임 시그니처 검사(성공·실패 경로). 삭제·완화 금지.
