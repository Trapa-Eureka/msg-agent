# HUMAN_PREP — 사람(Jin)이 직접 준비할 것

작성: 2026-09-05 · 근거: `docs/WORKFLOW.md` §4(자율성의 한계선), `docs/SPEC.md` §3·§7·§8, `docs/DESIGN.md` §4·§7, `docs/TESTING.md` §5

에이전트가 대신할 수 없는 항목만 모았다. 시점별로 나누어 해당 태스크 착수 전에 체크한다.
완료한 항목은 `[x]`로 바꾸고 날짜를 적는다.

## 1. T0 착수 전 (지금)

- [x] **저장소 정리** — `.DS_Store`가 첫 커밋에 포함되어 있다. T0의 `.gitignore`에 추가 후 `git rm --cached .DS_Store`로 추적 해제.
      .gitignore 추가 하고 git rm --cached .DS_Store 실행한다.
      → 2026-09-05 완료: `.gitignore`(OS·node_modules·dist·coverage·.env) 추가, `.DS_Store` 추적 해제.
- [x] **저장소 공개 여부 결정** — npm 공개 전까지 비공개 전환 가능(CI·배지·외부 연동 없음, 스타·포크 0). 비공개여도 가드레일 4(키·토큰 커밋 금지)는 그대로 적용.
      일단 비공개로 설정되어있다.
      → 2026-09-05 `gh repo view`로 PRIVATE 확인.
- [x] **LICENSE 선택** — 현재 라이선스 파일 없음. npm 공개 시 필수이므로 MIT 등 미리 결정.
      MIT 라이선스를 사용한다.
      → 2026-09-05 완료: 루트에 `LICENSE`(MIT, Copyright (c) 2026 Trapa-Eureka) 추가. T0의 `package.json`에 `"license": "MIT"` 기입 필요.
- [x] **Node 버전 확인** — 요구사항 Node 20+. 2026-09-05 기준 v24.12.0 / npm 11.6.2 확인 완료.

## 2. T7(CLI 온보딩)·T11(스모크) 전

### Telegram

- [x] **봇 토큰 발급** — 2026-09-05 완료: `.env`의 `TELEGRAM_BOT_TOKEN`, getMe 확인(@docu_translate_bot). @BotFather `/newbot`. 토큰은 `.env`(`TELEGRAM_BOT_TOKEN`) 또는 `~/.msg-agent/config.json`(권한 600)에만 저장. 커밋·로그 출력 금지.
- [x] **명령 등록** — 불필요해짐(2026-09-05, T5): 어댑터가 `start()` 시 `setMyCommands`로 자동 등록한다. BotFather `/setcommands`는 건너뛴다.
- [x] **그룹 프라이버시 모드 해제** — 2026-09-05 스모크에서 can_read_all_group_messages=true 확인(해제 완료). 프라이버시 모드에서는 봇이 그룹의 일반 메시지·파일을 받지 못한다. 그룹에서 쓸 계획이면 `/setprivacy` → Disable 후 봇을 그룹에서 제거했다가 다시 초대. `npm run smoke`가 getMe로 해제 여부를 표시한다.
- [ ] **테스트 대화방** — 1:1 대화 1개 + 봇을 초대한 테스트 그룹 1개.

### AI 프로바이더

- [x] **Anthropic API 키** (기본 프로바이더) — 2026-09-05 완료: `.env`의 `ANTHROPIC_API_KEY`, models 조회로 검증 OK. 크레딧 잔액 확인. `.env`의 `ANTHROPIC_API_KEY`.
- [x] **OpenAI API 키** (선택) — 2026-09-05 완료: `.env`의 `OPENAI_API_KEY`, models 조회로 검증 OK. OpenAI 어댑터까지 실검증하려면 필요. `.env`의 `OPENAI_API_KEY`.

### 스모크용 실제 문서 (SPEC §7)

- [ ] **영어 PDF, 짧은 것 1건** — 추출 텍스트 3,000자 이하 → `inline_full` 경로 확인.
- [ ] **영어 PDF, 긴 것 1건** — 3,000자 초과 → `summary_plus_file` 경로 확인.
- [x] **스모크 실행** — 2026-09-05 통과: 영어 PDF(4,755자) → summary_plus_file, 요약+파일 수신, 55.6초. 체크리스트 전부 ✓. `inlineThresholdChars` 3,000 유지 여부는 §3에서 결정.
- [ ] 민감하지 않은 문서로 준비한다. 실 채팅에 번역 결과가 게시된다.

## 3. T11 이후 공개 시점

- [x] **npm 패키지명 확정** — `msg-agent`(2026-09-05 결정). SPEC §8 기록.
- [x] **bin 이름·설정 경로 통일** — 2026-09-05 완료: bin `msg-agent`, 설정 `~/.msg-agent/config.json`, CLI 명칭·README 갱신, `package.json`의 `private` 해제(publish는 여전히 사람이 `npm publish`로만).
- [ ] **npm 계정** — `npm login` 상태, 2FA, publish 권한 확인.
- [ ] **임계치 기본값 승인** — 스모크 결과를 보고 `inlineThresholdChars` 3,000 유지 여부 결정 (SPEC §8).
- [ ] **히스토리 점검** — 공개 전환 전 git 히스토리에 키·토큰이 들어간 적 없는지 확인.
- [ ] **저장소 공개 전환** — LICENSE 커밋 + `package.json`의 `license`·`repository` 필드 기입 후 전환.
  ```bash
  gh repo edit Trapa-Eureka/msg-agent --visibility public --accept-visibility-change-consequences
  ```
- [ ] **npm publish** — 사람 승인 후 실행 (WORKFLOW §4).

## 4. 항상 사람이 잡는 것 (WORKFLOW §4 요약)

- 실 봇 토큰·API 키 관리와 스모크 실행 (실 채팅 게시 발생)
- npm 퍼블리시·패키지명 확정
- 출력 모드 정책·임계치 기본값 변경 승인
- 신규 메신저 어댑터 착수 순서 (SPEC §2 표)
