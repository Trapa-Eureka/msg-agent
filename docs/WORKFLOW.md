# WORKFLOW — AI-native rules for running this repo

Basis: Clare Liguori (AWS), "From AI-Assisted to AI-Native: Building a Frontier Development Team"
(https://youtu.be/Ry0WHNxDbYA · AWS blog: https://aws.amazon.com/blogs/machine-learning/how-frontier-teams-are-reinventing-ai-native-development/)
Operating principles are the same as sheet_mcp / retail-mcp / lang_ai_agent. Only the shared summary and **this repo's specifics** are recorded here.

## 0. Roles (the three frontier behaviours)

| Behaviour | In this repo |
|---|---|
| Hands-off Coding (1–2%) | Jin only edits SPEC/DESIGN, reviews, runs real-token smoke tests and approves npm releases |
| Infrequent Interaction | Every task has machine-checkable completion criteria → finished without mid-session intervention |
| Minimized Idle Time | After T1, lanes A–D run in parallel. Four repos' backlogs are run as one worktree queue |

## 1. Five habits → rules (shared summary)

1. **Agent Context** — missing knowledge goes only into CLAUDE.md/docs. Bi-weekly pruning with a log.
2. **Slow Down to Speed Up** — invest up front in strict TS and interface boundaries (messenger / extraction / translation are all adapters). User-facing errors follow the "cause + fix" rule too.
3. **Feed, Don't Babysit** — assign with the TASKS template once; self-verification = `npm run check`.
   ```bash
   git worktree add ../message-t3 -b t3 && cd ../message-t3 && claude
   ```
4. **Explicit Intent** — output-mode policy (smart / threshold / rejection) is changed in SPEC §4 and the TESTING §3 golden plans first, then implemented.
5. **Shift Left** — local deterministic mocks: FakeMessenger (event injection, post recording), FakeTranslator (marker transformation). Translation *quality* is not what tests cover — plumbing and policy are; quality belongs to smoke tests, real use and future evals.

## 2. Repo-specific rules

- **Privacy is a first-class requirement**: no document content on disk or in logs is an invariant, not a feature. The T10 audit test (body signature check) must never be deleted or weakened. Reviews catch leftover `console.log(text)`-style debugging.
- **Posting-scope invariant**: results go only to the receiving chatId. No code that sends to other chats or externally, even as a convenience (spam / exfiltration vector).
- **Respect cost guards**: no flags that bypass maxChars or file limits. Cap policy changes happen only through SPEC edits.
- **Native-language UX**: every user-facing phrase goes through the phrase pack (T8) — a hard-coded English string in the pipeline is rejected in review.

## 3. Daily routine

1. Check which tasks are startable → assign worktrees per lane (shared queue across four repos)
2. Do not intervene while a task runs — polish v0.2 docs (Slack / MCP / OCR) in the meantime
3. Completion report → re-run `npm run check` → review the diff → merge → update status
4. Every two weeks: prune CLAUDE.md, tidy TASKS

## 4. Limits of autonomy (what humans keep)

- Managing real bot tokens and API keys, and running smoke tests (they post to real chats)
- npm publishing and the package name
- Approving output-mode policy and threshold default changes
- The order in which new messenger adapters are started (changes to the SPEC §2 table)
