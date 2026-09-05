# COVERAGE — src/core (T10 report)

Generated: 2026-09-05 · Command: `npm run test:coverage` (part of `npm run check`) · Thresholds: statements/lines/functions ≥ 90%, branches ≥ 80% (vitest.config.ts) — the check fails below them

| File | Statements | Branches | Functions | Lines |
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

Figures above are the T10 snapshot; later tasks (R1–R7) added `route.ts` and kept the total above the thresholds. Re-run the command for current numbers.

## Privacy audit (tests/privacy-audit.test.ts, part of check)

- **Static scan**: across `src/`, disk-write APIs (writeFile/appendFile/createWriteStream/open, …) are allowed only in `adapters/configStore.ts` and `console.*` only in `cli/`. A logger call whose metadata contains a `text` / `content` / `body` / `summary` / `parts` / `translated` key fails the test.
- **Runtime signature check**: a document seeded with three unique markers (two Latin, one Korean) is processed by the daemon exactly as assembled by `runStart` (with the real ConsoleLogger), including `/full` and `/summary`. The markers must reach the chat and must not appear in stderr logs, stdout, CLI output, config.json, the working directory or the config directory. Both the success path and a repeated-provider-failure path are checked.

## Regenerating

```bash
npm run test:coverage        # text summary + coverage/ (html, json-summary; git-ignored)
```
