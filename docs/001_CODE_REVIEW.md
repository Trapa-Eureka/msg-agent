# 001. Full source-code review results

> Reviewed on 2026-09-05 at commit `fda3f25`. Remediation status per item was added on 2026-09-06 (see `docs/TASKS.md`, R series). The findings below are the original review; the **Status** line at the end of each item records what was done.

## Findings — Critical → High → Medium → Low

Critical: none found. High 3, Medium 13, Low 3 — 19 items in total. Severity is based on real impact and the conditions needed to trigger it; risks confirmed by static analysis are distinguished from results reproduced by execution.

### 01. [High] Paid translation and global settings changes allowed without user authentication

- Files: `src/adapters/telegramAdapter.ts:52-65`, `src/core/pipeline.ts:369-386`, `src/cli/start.ts:73-79`.
- Problem: allowed users/chats are not checked before documents and commands are accepted. Commands do not even carry the sender ID, and `/lang`, `/mode` change the config file shared by every chat.
- Impact: any third party able to message the bot can incur the owner's API costs or change other conversations' translation language and mode. Describing the product as "personal" does not restrict access by itself.
- Evidence: every document event goes straight to `docHandler`, and the settings write path is a single `FileSettings` instance. There is no allow-list or owner-verification path.
- Recommendation: configure the owner and allowed chats during onboarding and verify before downloading or executing commands. Separate the permission to submit documents in a group from the permission to change global settings.
- **Status: fixed in R1** — deny by default, pairing via `/start <code>`, owner-only `/mode` `/lang` `/allow` `/deny`, strict `access` schema.

### 02. [High] Cost limit counts characters without whitespace, so the real input volume is not controlled

- Files: `src/core/sections.ts:118-120`, `src/core/pipeline.ts:149-158,244-250`, `src/core/prompts.ts:53`.
- Problem: the cost guard uses the length with all whitespace removed, while chunking and summary requests send text with whitespace included. There is no separate cap on chunk count or total request input.
- Impact: input far larger than the limit is approved as a short document and generates many paid requests. Summaries send the whole text at once, so model input-limit failures are also possible.
- Reproduction: `('word' + ' '.repeat(3990)).repeat(100)` is 399,400 characters, `countChars` reported 400, and the real `structureText` → `chunkDocument` path produced 99 chunks.
- Recommendation: separate the display character count from the cost guard. Cap the actual transmitted string length or estimated tokens, the chunk count and the per-document request budget, and apply the same budget to summaries.
- **Status: fixed in R2** — whitespace-inclusive length, `maxChunksPerDoc`, per-chat rate limit, daily character budget.

### 03. [High] Secret fragments can leak through the error message for malformed config JSON

- Files: `src/adapters/configStore.ts:21-22,35-38`, `src/core/configMessages.ts:145-154`, `src/cli/status.ts:24-29`.
- Problem: the raw `JSON.parse` error message is stored in `detail` and printed as-is by the CLI. The runtime's JSON error messages may include part of the input string.
- Impact: when a config containing API keys or bot tokens is edited incorrectly, secret fragments end up in terminal output or collected logs. Masking on the normal path does not protect this error path.
- Reproduction: on Node v24.12.0, parsing the synthetic string `literal:FAKE_SECRET_FOR_REVIEW` and applying the same explanation function printed `"literal:FA"... is not valid JSON`. No real secret was used.
- Recommendation: never forward parser error text to user output. Provide a fixed error code and safely extracted position information only, and add a regression test for output leakage from malformed JSON containing a secret marker.
- **Status: fixed in R3** — fixed `syntax` code, regression test with a signature.

### 04. [Medium] Real long polling processes every chat serially

- Files: `src/adapters/telegramAdapter.ts:63-65,138`, `src/core/pipeline.ts:67-74`.
- Problem: the document handler awaits the whole translation while grammY's default `bot.start()` is used. The installed grammY (`out/bot.js:191-196`) does `await this.handleUpdate(update)` per update.
- Impact: one chat's long translation blocks command and document processing for every other chat. The core's per-chat queue and the design's cross-chat concurrency guarantee do not hold on the production path.
- Reproduction: two different chats were fed into the installed bot's batch processing path with the first handler held. Only the first chat ran until it was released; the second ran only afterwards. No external network was used.
- Recommendation: use an update-consumption path with bounded concurrency while keeping per-chat ordering through the existing queue. Wire shutdown to wait for in-flight work and verify on the real update-batch path.
- **Status: fixed in R5** — non-blocking dispatch, `drain()`, global `maxConcurrentChats`.

### 05. [Medium] Polling initialization failure is reported as a successful start

- Files: `src/adapters/telegramAdapter.ts:134-140`, `src/cli/start.ts:85-92`, `src/cli/index.ts:116-121`.
- Problem: `bot.start()` runs in the background and errors are consumed by a callback, so `TelegramAdapter.start()` succeeds before readiness. Upper layers immediately print `daemon.started` and the start notice.
- Impact: even when the bot cannot receive because the initial `getMe` / `deleteWebhook` failed, it looks like a successful start and no failure exit code is propagated. Operational monitoring can miss the outage.
- Reproduction: with a synthetic error injected into `deleteWebhook`, `start()` resolved, `bot.isRunning()` was false, and only the error callback fired.
- Recommendation: separate the readiness signal from the polling lifetime promise. Propagate initialization errors to the start call, and reflect fatal polling errors after start in the daemon state and process exit code.
- **Status: fixed in R5** — `start()` awaits init + ready or rejects; fatal polling failure → `onError(e, true)` → exit code 1.

### 06. [Medium] No application-level timeouts or cancellation for downloads and OpenAI requests

- Files: `src/adapters/telegramAdapter.ts:94-96,143-145`, `src/adapters/providers/openai.ts:46-54,79`, `src/cli/start.ts:94-105`.
- Problem: fetch and body reads receive no deadline or shutdown `AbortSignal`. Shutdown waits for the polling promise but cannot cancel in-progress downloads or provider requests.
- Impact: a server or proxy that never finishes a response can hold a document job for a long time. Under the current serial polling other chats are delayed too, and waiting after a shutdown signal can also be long. The runtime's own limits aside, there is no limit on the job as a whole.
- Evidence: static analysis of request creation, body reads and the daemon shutdown path. No experiment holding a real network connection indefinitely was run.
- Recommendation: add a deadline covering the request and body reception, combined with the shutdown signal. Distinguish timeouts from user shutdown so cancellation does not retry, and cap the shutdown wait.
- **Status: fixed in R4** — `AbortSignal.timeout` on OpenAI (90 s) and Telegram body fetch (60 s), Claude SDK timeout 120 s, streaming byte cap.

### 07. [Medium] Nested retries in the Claude SDK and the pipeline allow up to six requests per chunk

- Files: `src/adapters/providers/claude.ts:55-61`, `src/core/pipeline.ts:293-307`.
- Problem: the provider keeps the SDK default when `maxRetries` is omitted. The installed SDK retries twice by default, and the pipeline calls the same operation up to twice.
- Impact: contrary to the design's one initial call + one retry per chunk, up to six requests are made. Latency and service load grow during outages, and if a response was lost before a retry, duplicate processing costs may occur.
- Reproduction: replacing every external call with a 529 mock and running the pipeline's two-call loop produced six fetch calls. The existing error tests pass `maxRetries: 0` explicitly and so do not exercise the production default.
- Recommendation: keep retry responsibility in one layer. If the pipeline owns it, set the SDK default to 0 and verify total request count and back-off policy.
- **Status: fixed in R2** — SDK `maxRetries` defaults to 0; test verifies one HTTP request per attempt.

### 08. [Medium] DOCX conversion loses link URLs and list numbering

- Files: `src/adapters/extractors/docx.ts:17-28`.
- Problem: HTML tags are stripped wholesale, dropping the `href` of `<a>` and turning every `<li>` into `- `, which erases ordered-list numbers and hierarchy.
- Impact: contract clause numbers, procedures where order matters, and payment/reference addresses given only as links disappear before translation. The translation prompt cannot recover information that was already removed.
- Reproduction: `<ol><li>Pay</li><li>Ship</li></ol><p><a href="https://example.com/pay">Payment portal</a></p>` lost both the list numbers and the URL, leaving only bullets and the link text.
- Recommendation: use a converter that understands HTML structure — links as Markdown links, ordered lists as numbered lists. Keep the structure of nested lists and tables as well.
- **Status: fixed in R6** — linear HTML scan keeps heading levels, `[text](url)`, numbered and nested lists.

### 09. [Medium] Markdown heading levels and chunk-boundary structure are altered

- Files: `src/core/sections.ts:6,19-22,45-49`, `src/core/chunker.ts:59-74,105`.
- Problem: the number of `#` in headings is discarded and every heading is regenerated as `#`. Sentence splitting of long paragraphs replaces the original separator with a space, and reassembly inserts a blank line between every chunk.
- Impact: parent/child heading relations, list indentation and whitespace-significant structure such as code and tables change in the translation input or output. Some current tests strip whitespace and heading markers before comparing and therefore miss this.
- Reproduction: `## Terms` and `### Payment` both became level-1 headings. Splitting `- one\n- two\n- three\n- four` at 15 characters introduced extra whitespace before later list items.
- Recommendation: keep the heading level and the original separators in sections. Split with awareness of Markdown block boundaries and code/list structure, and reassemble using separator metadata.
- **Status: fixed in R6** — `Section.level`, `Chunk.sep`, `assembleChunks(translated, chunks)` round-trips losslessly.

### 10. [Medium] A mixed-language document is skipped entirely based on its beginning

- Files: `src/core/detector.ts:13,30-48`, `src/core/pipeline.ts:153-158,171-173`.
- Problem: the same-language decision for the whole document is made from the confidence of the first 2,000 characters only. The middle and end are never examined.
- Impact: a document with a native-language cover page or preface followed by a long foreign-language body is not translated automatically. The user is told it is already in their language while the foreign text remains.
- Reproduction: 24 English sentences followed by 200 Korean sentences were detected as English with confidence 1, and with native language `en` the same-language decision was true.
- Recommendation: sample several positions or sections and skip only when they are consistent. On mixed signals, route to translation or decide per section.
- **Status: fixed in R6** — head/middle/tail sampling; any disagreement caps confidence at 0.6, so mixed documents are translated.

### 11. [Medium] The `/summary` remedy suggested in the over-cap notice does not work

- Files: `src/core/outputPlanner.ts:51-55`, `src/phrases/ko.ts:15-17`, `src/phrases/en.ts:15-17`.
- Problem: the over-cap message suggests the summary command, but `/summary` is rejected by the same cap check. There is no summary-only plan, and the normal summary plan requires a full translation too.
- Impact: following the guidance yields no result and only repeats download and extraction.
- Reproduction: `charCount: 120001`, `maxChars: 120000`, `request: 'summary'` → `over_max_chars` rejection.
- Recommendation: if the current cap stays, change the guidance to something actionable such as splitting the file. If a summary-only recovery is wanted, define a plan with its own limits in the design document first. Do not simply bypass the existing cap.
- **Status: fixed in R2** — the notice now asks to split the file; `/summary` is no longer suggested.

### 12. [Medium] In-place config overwrite can corrupt the existing config when a save fails

- Files: `src/adapters/configStore.ts:55-63`, `src/adapters/fileSettings.ts:14-17`.
- Problem: `writeFileSync` truncates the existing file directly before writing. On interruption or write failure, the previous valid config is not preserved. The chmod for a loosely-permissioned existing file also runs after the secret has been written.
- Impact: a disk error or process interruption during an ordinary setting change such as `/lang` can make the next start impossible. Another process may briefly observe an intermediate state or read the new secret under the old permissions.
- Evidence: static analysis of the save order. No fault injection or change was made to the user's config.
- Recommendation: create a unique temp file in the same directory with mode 600, complete the write, then replace atomically with rename. Keep the original on failure; add fsync and cross-process locking if needed.
- **Status: fixed in R3** — temp file (600, `wx`) + rename; failed saves keep the previous file.

### 13. [Medium] The declared Node support range does not match dependency requirements

- Files: `package.json:7-9,48`, `src/adapters/configStore.ts:95-101`, `src/cli/index.ts:3`.
- Problem: the package declares Node `>=20`, but the installed commander 15 requires `>=22.12.0`. `process.loadEnvFile` is also a Node 20.12+ API, as the comment notes.
- Impact: on the advertised Node 20, installation is refused or the CLI runs on an unsupported combination. On older 20.x, `.env` loading itself can fail.
- Evidence: the installed `node_modules/commander/package.json:60-62` and the source. The review environment is Node v24.12.0, so Node 20 was not exercised.
- Recommendation: align the minimum Node version with the real dependency requirements and reflect it in README/CI, or choose compatible dependencies and an env-loading implementation if Node 20 support is required.
- **Status: fixed in R7** — `engines.node >= 22.12.0`, docs updated.

### 14. [Medium] OpenAI JSON responses are type-asserted without validation

- Files: `src/adapters/providers/openai.ts:22-24,77-89`.
- Problem: the result of `res.json()` is asserted as `ChatCompletion`. Only JSON syntax is checked — not whether it is an object, an array, or whether content is a string.
- Impact: a malformed successful response escapes as a `TypeError` instead of `ProviderError('bad_response')`, breaking retry and error classification. TypeScript strict mode does not guarantee the real value of external JSON.
- Reproduction: injecting a 200 body of `null` or `{choices:[{message:{content:42}}]}` produced a `TypeError` in both cases, with no `kind`.
- Recommendation: validate the response at the boundary with the zod already in use and unify mismatches as a safe `bad_response` error. Validate normal finish reasons and refusal responses explicitly too.
- **Status: fixed in R4** — zod schema; five malformed shapes → `bad_response`.

### 15. [Medium] A single grapheme larger than the limit violates the message/chunk cap

- Files: `src/core/textSplit.ts:40-50`, `src/core/chunker.ts:14-24`.
- Problem: when the buffer is empty, a grapheme is appended even if it alone exceeds the limit. A single grapheme can be very long because of combining characters.
- Impact: strings larger than the real Telegram send limit or the provider chunk limit are produced. There is no policy for the case where the character-boundary guarantee conflicts with the length-limit guarantee.
- Reproduction: `'a' + '́'.repeat(4200)` produced a 4,201-character message from the default `splitForMessenger` and a 4,201-character chunk from the default `chunkDocument`.
- Recommendation: either reject a single grapheme larger than the limit as an explicit input error, or define a safe alternative split policy the platform accepts. Verify the length invariant of every returned element.
- **Status: fixed in R2** — code-point fallback split; every part ≤ the limit.

### 16. [Medium] The extension pre-empts MIME-first routing

- Files: `src/adapters/extractors/pdf.ts:8-9`, `src/adapters/extractors/docx.ts:32-33`, `src/adapters/extractors/index.ts:10-11`, `src/core/pipeline.ts:115`.
- Problem: each extractor answers "supported" if either the MIME type or the extension matches, and the first extractor wins. This differs from the design's rule of clear-MIME-first with extension fallback only when unclear.
- Impact: a file with the DOCX MIME type but named `report.pdf` is handed to the PDF extractor placed first and reported as corrupt even though it is a valid DOCX.
- Evidence: the static path determined by the order of `createExtractors()` and the OR condition in each `supports()`. Existing MIME tests do not use conflicting extensions.
- Recommendation: evaluate a clear MIME match first in the router and apply the extension fallback only for unclear MIME types. Make the pipeline and the tests use the same router.
- **Status: fixed in R6** — `core/route.ts` decides by MIME first; the pipeline uses the router.

### 17. [Low] Onboarding cancellation is retried like a validation failure

- Files: `src/cli/init.ts:79-93,114-127,153-163`.
- Problem: a cancelled question and an invalid input are both represented as `undefined`, and `withAttempts` retries on that value.
- Impact: cancelling the language choice or a secret input can open the next prompt again, so the intent to cancel is not honoured immediately.
- Evidence: `Asker` defines undefined as cancel, but the retry layer does not distinguish it.
- Recommendation: use a result type that distinguishes success, cancel and validation failure, and propagate cancel straight to the caller.
- **Status: fixed in R7** — `CANCELLED` sentinel aborts immediately; only empty input is re-asked.

### 18. [Low] Onboarding saves again after a failed save just to obtain the error

- Files: `src/cli/init.ts:213-218`.
- Problem: the first `saveConfig` result is widened to `Result<unknown, unknown>`, losing the error type, and on failure the same save is called again. Even if the second save succeeds, the abort message and exit code 1 are returned.
- Impact: failure handling performs an unnecessary extra write, and whether the config was actually saved may not match what the user is told.
- Evidence: the static path in the failure branch that returns aborted/1 regardless of the second call's outcome.
- Recommendation: keep the inferred type of the first call and explain `saved.error` directly. If a retry is wanted, make it a separate policy and return success properly.
- **Status: fixed in R7** — single call with its typed error explained.

### 19. [Low] Unused onboarding and planning helpers remain only in tests and public exports

- Files: `src/cli/init.ts:70-76`, `src/cli/index.ts:23-29`, `src/core/outputPlanner.ts:69-76`.
- Problem: after the change to a fixed ten-language selection, `resolveLanguageInput` and the autocomplete path are no longer used by real onboarding. `needsFullTranslation` and `needsSummary` are not called by production code either and remain only in tests and exports.
- Impact: helpers and tests separate from the real execution policy have to be maintained, increasing change points and comprehension cost. Verifying these helpers does not verify the real pipeline policy.
- Evidence: reference search across `src/` and `tests/`. Language-name resolution and the planning helpers were called only from tests.
- Recommendation: confirm whether an external maintenance contract exists, then remove the unused paths or integrate them into the real execution path. Update the stale autocomplete description to match the current UI.
- **Status: fixed in R7** — helpers and the autocomplete path removed.

## Scope and verification

- Baseline: 2026-09-05, commit `fda3f25`. Not limited to the current diff — all 43 TypeScript files under `src/` were reviewed.
- Areas: `core/` policy, splitting, language, config, types and orchestration; `adapters/` storage, Telegram, extractors, providers; `cli/` onboarding, start, status; `phrases/`; `mocks/`.
- Related material: `package.json`, TypeScript/Vitest configuration, README, `CLAUDE.md`, SPEC/DESIGN and the related tests. SDK behaviour was cross-checked against the installed dependency sources.
- Existing automated checks: `npm run check` passes — typecheck, ESLint and Prettier pass; 20 test files / 178 tests pass.
- Coverage: configured for `src/core/**`: statements 96.92%, branches 86.79%, functions 100%, lines 97.19%. This does not mean full adapter/CLI coverage.
- Additional verification: inline Node/tsx scripts that create no files reproduced the document-structure changes, the whitespace cost-guard bypass, the mixed-language skip, oversized graphemes, summary rejection, response type errors, SDK retries, serial polling and start failure, and JSON error exposure.
- Limits: no real Telegram/Claude/OpenAI calls, no real billing, no faulty-filesystem experiments, no other Node versions. Static risks were not asserted to be actual outages.
- Scope of changes: only this review document was created. Existing source, tests and configuration documents were not modified. Coverage artifacts from the automated checks may have been generated.

## Follow-up priorities

Fix and verify access control, the cost guard and secret leakage in error output first. Then verify the real long-polling lifecycle and request cancellation, and strengthen source-structure and external-response validation. The current tests are strong on the happy path and mock-based core verification, but do not rule out defects in production SDK defaults, failure lifecycles and source-structure preservation.

All nineteen items were addressed in R1–R7 on 2026-09-06.
