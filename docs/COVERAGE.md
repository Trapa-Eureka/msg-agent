# COVERAGE — src/core (T10 리포트)

생성: 2026-09-05 · 명령: `npm run test:coverage` (`npm run check`에 포함) · 임계치: statements/lines/functions ≥ 90%, branches ≥ 80% (vitest.config.ts) — 미달 시 check 실패

| 파일 | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| **All src/core** | 96.92% | 86.79% | 100% | 97.19% |
| chunker.ts | 100% | 93.1% | 100% | 100% |
| config.ts | 96.22% | 93.75% | 100% | 95.55% |
| configMessages.ts | 89.18% | 62.79% | 100% | 88.57% |
| detector.ts | 97.22% | 82.14% | 100% | 96.96% |
| index.ts | 100% | 100% | 100% | 100% |
| lang.ts | 100% | 100% | 100% | 100% |
| outputPlanner.ts | 100% | 100% | 100% | 100% |
| phrases.ts | 100% | 100% | 100% | 100% |
| pipeline.ts | 94.51% | 83.33% | 100% | 95.91% |
| ports.ts | 100% | 100% | 100% | 100% |
| prompts.ts | 100% | 75% | 100% | 100% |
| result.ts | 100% | 100% | 100% | 100% |
| sections.ts | 100% | 95.23% | 100% | 100% |
| textSplit.ts | 100% | 95.23% | 100% | 100% |
| types.ts | 100% | 100% | 100% | 100% |

## 프라이버시 감사 (tests/privacy-audit.test.ts, check에 포함)

- **정적 검사**: `src/` 전체에서 디스크 쓰기 API(writeFile/appendFile/createWriteStream/open 등)는 `adapters/configStore.ts`에서만, `console.*`는 `cli/`에서만 허용. 로거 호출 메타에 `text`/`content`/`body`/`summary`/`parts`/`translated` 키가 있으면 실패.
- **런타임 시그니처 검사**: 본문에 고유 표식 3개(영문 2, 한글 1)를 심은 문서를 실제 조립 데몬(`runStart` + 실 ConsoleLogger)으로 처리하고 `/full`·`/summary`까지 실행. 채팅에는 표식이 도착해야 하고, stderr 로그·stdout·CLI 출력·config.json·작업 디렉터리·설정 디렉터리에는 표식이 없어야 함. 성공 경로와 프로바이더 반복 실패 경로 모두 검사.

## 재생성

```bash
npm run test:coverage        # 텍스트 요약 + coverage/ (html, json-summary; gitignore)
```
