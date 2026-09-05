# WORKFLOW — 이 레포를 굴리는 AI-native 규칙

기반: Clare Liguori (AWS), "From AI-Assisted to AI-Native: Building a Frontier Development Team"
(https://youtu.be/Ry0WHNxDbYA · AWS 블로그: https://aws.amazon.com/blogs/machine-learning/how-frontier-teams-are-reinventing-ai-native-development/)
운영 원칙은 sheet_mcp/retail-mcp/lang_ai_agent와 동일. 공통 요약 + **이 레포 특이사항**만 적는다.

## 0. 역할 정의 (프론티어 3행동)

| 행동 | 이 레포에서 |
|---|---|
| Hands-off Coding (1~2%) | Jin은 SPEC/DESIGN 수정·리뷰·실토큰 스모크·npm 공개 승인만 |
| Infrequent Interaction | 태스크마다 기계 판정 완료 기준 → 세션 중 개입 없이 완주 |
| Minimized Idle Time | T1 후 레인 A~D 병렬. 네 레포 백로그를 하나의 worktree 큐로 운용 |

## 1. 습관 5개 → 규칙 (공통 요약)

1. **Agent Context** — 부족지식은 CLAUDE.md/docs에만. 격주 프루닝 + 로그.
2. **Slow Down to Speed Up** — strict TS + 인터페이스 경계(메신저/추출/번역이 전부 어댑터) 선투자. 사용자 대면 에러도 "원인+수정 방법" 규칙 적용.
3. **Feed, Don't Babysit** — 배정은 TASKS 템플릿 1회, 자기 검증 = `npm run check`.
   ```bash
   git worktree add ../message-t3 -b t3 && cd ../message-t3 && claude
   ```
4. **Explicit Intent** — 출력 모드 정책(스마트/임계치/거절)은 코드가 아니라 SPEC §4·TESTING §3 골든 플랜을 먼저 고친 뒤 구현한다.
5. **Shift Left** — 로컬 결정론 목: FakeMessenger(이벤트 주입·게시 기록), FakeTranslator(마커 변환). 번역 "품질"은 테스트 대상이 아니고 배관·정책이 대상이다 — 품질은 스모크·실사용·추후 eval의 몫.

## 2. message 특이사항

- **프라이버시가 1급 요구사항**: 문서 내용의 디스크·로그 잔류 금지는 기능이 아니라 불변식이다. T10의 감사 테스트(본문 시그니처 검사)는 삭제·완화 금지. 리뷰 시 `console.log(text)`류 디버그 잔재를 잡는다.
- **게시 범위 불변식**: 결과는 수신 chatId에만. 다른 채팅·외부 전송 코드는 편의 기능이라도 추가 금지 (스팸·유출 벡터).
- **비용 가드 존중**: maxChars·파일 한도 우회 플래그 금지. 상한 정책 변경은 SPEC 수정으로만.
- **모국어 UX**: 사용자 대면 문구는 전부 문구 팩(T8) 경유 — 하드코딩 영어 문자열이 파이프라인에 들어오면 반려.

## 3. 일일 운영 루틴

1. 착수 가능 태스크 확인 → 레인별 worktree 배정 (네 레포 공용 큐)
2. 실행 중 개입하지 않는다 — 그 시간에 v0.2 문서(Slack/MCP/OCR)를 다듬는다
3. 완료 보고 → `npm run check` 재실행 → diff 리뷰 → 머지 → 상태 갱신
4. 격주: CLAUDE.md 프루닝, TASKS 정리

## 4. 자율성의 한계선 (사람이 잡는 것)

- 실 봇 토큰·API 키 관리와 스모크 실행 (실 채팅에 게시가 발생하므로)
- npm 퍼블리시·패키지명 확정
- 출력 모드 정책·임계치 기본값 변경 승인
- 신규 메신저 어댑터 착수 순서 (SPEC §2 표의 순서 변경)
