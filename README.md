# message

메신저 대화창에 올라온 **외국어 문서를 내 모국어로 자동 번역해주는 개인용 AI Agent**.

- 대화창에 문서 파일(PDF·DOCX·TXT/MD)이 업로드되면 → 언어 감지 → 모국어가 아니면 자동 번역 → 같은 대화창에 결과 게시.
- 출력은 **스마트 모드**가 기본: 짧은 문서는 전문을 채팅에, 긴 문서는 **모국어 요약을 채팅에 + 전문 번역을 파일 첨부**로. `/full` `/summary` `/mode` 명령으로 전환.
- 온보딩은 npm 설치 후 CLI 3문항: ① 모국어(전체 언어) ② AI 프로바이더 + API 키(기본 Claude, OpenAI 지원) ③ 메신저 + 토큰.
- **v0.1 메신저는 Telegram.** 이유: long polling이라 공개 URL·서버 없이 노트북에서 바로 돌고, 봇 발급에 심사가 없으며, 파일 API가 단순하다(봇 다운로드 한도 20MB). 메신저는 `MessengerAdapter` 인터페이스 뒤에 있어 Slack(v0.2, Socket Mode) → Viber(v0.3, 필리핀 시장) → Discord/WhatsApp/Teams 순으로 어댑터만 추가한다.

정체성: 본체는 **Agent**(업로드 이벤트 → 자율 처리)다. MCP 서버는 v0.2에서 같은 코어를 `translate_document` 도구로 노출하는 부가물이다 — "조회는 MCP, 이벤트 자율 처리는 Agent" 원칙 그대로.

## 문서 맵

| 문서 | 내용 | 읽는 시점 |
|---|---|---|
| `CLAUDE.md` | 에이전트 스티어링 — 스택, 명령어, 규칙, 가드레일 | 모든 에이전트 세션 시작 시 (자동 로드) |
| `docs/SPEC.md` | 제품 스펙 — 온보딩, 출력 모드 결정 근거, 로드맵 | 기능 논의·범위 판단 전 |
| `docs/DESIGN.md` | 기술 설계 — 파이프라인, 인터페이스, Telegram 제약, CLI | 구현 전 필독 |
| `docs/TESTING.md` | 테스트 전략 — 페이크 메신저/번역기, 엣지 케이스 | 테스트 작성 전 |
| `docs/TASKS.md` | 태스크 백로그 — 에이전트 실행 단위, 완료 기준 | 작업 배정 시 |
| `docs/WORKFLOW.md` | AI-native 개발 규칙 (공통 + 이 레포 특이사항) | 최초 1회 + 운영 중 참조 |

## 개발 방식

앞선 세 레포와 동일: **문서 → 에이전트 구현 → 검증**. 사람(Jin)은 스펙·리뷰·실토큰 스모크·npm 공개 승인, 구현은 Claude Code가 `docs/TASKS.md` 단위로. 공통 게이트는 `npm run check`.

## 퀵스타트 (T0 완료 후 유효)

```bash
npm install
npm run check     # typecheck + lint + test — 공통 게이트
npm run cli init  # 온보딩 3문항 (모국어 / 프로바이더+키 / 메신저+토큰)
npm run cli start # long polling 데몬 시작
```

## 상태

- 2026-09-04: 문서 단계 (코드 미작성). T0부터 시작.
- npm 패키지명은 미결 (SPEC §8) — 레포/폴더명은 `message`.
