# msg-agent

[![npm](https://img.shields.io/npm/v/msg-agent)](https://www.npmjs.com/package/msg-agent) · Node.js 22.12+ · MIT

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
| `docs/HUMAN_PREP.md` | 사람이 직접 준비할 항목 체크리스트 (토큰·키·문서·공개 절차) | 태스크 착수 전 |
| `docs/COVERAGE.md` | core 커버리지 리포트 + 프라이버시 감사 요약 | T10 이후 참조 |

## 개발 방식

앞선 세 레포와 동일: **문서 → 에이전트 구현 → 검증**. 사람(Jin)은 스펙·리뷰·실토큰 스모크·npm 공개 승인, 구현은 Claude Code가 `docs/TASKS.md` 단위로. 공통 게이트는 `npm run check`.

## 퀵스타트

```bash
# Node.js 22.12 이상
npm install
npm run cli -- init    # 온보딩 3문항: 모국어 / 프로바이더+API 키 / Telegram 봇 토큰 (즉시 검증)
npm run cli -- start   # 데몬 시작 — 터미널의 6자리 코드를 봇에게 `/start <코드>`로 보내 소유자 등록(최초 1회)
```

`npm run cli -- status`는 설정 요약(키·토큰은 가려서)과 봇 연결 상태를 보여준다. 키·토큰은 `.env`(`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`TELEGRAM_BOT_TOKEN`) 또는 `~/.msg-agent/config.json`(권한 600)에만 저장된다.

### 채팅 명령

| 명령 | 동작 |
|---|---|
| (문서 업로드) | 감지 → 모국어가 아니면 번역. 짧으면 채팅에 전문, 길면 요약 + `.md` 파일 |
| `/full` | 마지막 문서의 전문 번역을 파일로 |
| `/summary` | 마지막 문서 요약 다시 (+ 파일) |
| `/mode smart\|full\|summary` | 기본 출력 모드 변경 |
| `/lang <코드>` | 모국어 변경 (예: `/lang ko`) |
| `/start <코드>` | 페어링: 터미널에 표시된 코드로 소유자 등록 (최초 1회) |
| `/allow` · `/deny` | (소유자) 현재 대화방 허용 / 해제 |

봇은 페어링된 소유자와 허용된 대화방의 문서만 처리한다. 그 외 사용자의 문서·명령은 응답 없이 무시된다.

### 검증

```bash
npm run check   # typecheck + lint + format + test(커버리지 임계치 + 프라이버시 감사)
npm run smoke -- [--chat <chatId>] [--wait 300]   # 실 봇·실 키로 수동 스모크 (사람 전용, TESTING §5)
```

## 상태

- 2026-09-04: 문서 단계 (코드 미작성). T0부터 시작.
- 2026-09-05: T0~T11 구현 완료, 실 Telegram 봇 + Claude 스모크 통과, 임계치 3,000 유지, 패키지명 `msg-agent` 확정.
- 2026-09-06: 코드·보안 검수 대응 R1~R7 완료(214 테스트), 재스모크 통과. **v0.1.0 npm 공개**: https://www.npmjs.com/package/msg-agent (`npm i -g msg-agent@0.1.0`), 태그 `v0.1.0`, 저장소 공개.
- npm 패키지명 `msg-agent` 확정(2026-09-05). 공개 후 설치: `npm i -g msg-agent` → `msg-agent init` / `msg-agent start` / `msg-agent status` (개발 중에는 `npm run cli -- <cmd>`).
