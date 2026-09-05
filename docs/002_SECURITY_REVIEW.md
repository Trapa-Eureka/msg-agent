# 002. Project security review results

> Reviewed on 2026-09-05 at commit `fda3f25`. Remediation status per item was added on 2026-09-06 (see `docs/TASKS.md`, R series). The findings below are the original review; the **Status** line at the end of each item records what was done.

## Findings — Critical → High → Medium → Low

Critical 0, High 3, Medium 9, Low 1: 13 items. Behaviour confirmed by execution is distinguished from conditional attack possibilities. Items overlapping the general code review were re-evaluated for security impact, attack preconditions and the guardrails. None of this means an actual compromise or remote code execution was confirmed.

### SEC-01. [High] Paid work and global settings changes allowed without sender authentication or authorization

- Location: `src/adapters/telegramAdapter.ts:52-65`, `src/core/types.ts:7-19`, `src/core/pipeline.ts:350-386`, `src/cli/start.ts:73-79`.
- Problem: the user ID and chat ID delivered by Telegram are never compared with an owner or allow-list. Normalized events carry no sender ID, and `/lang` / `/mode` from any chat change the single config.
- Attack precondition: a user who can send the bot a private message, or send documents/commands in a group the bot is in. The bot token is not needed.
- Impact: unauthorized use of the owner's API spend, tampering with global settings, disruption of other chats' translations. This is an application-level privilege escalation (an ordinary participant exercising admin rights), not OS privilege escalation.
- Evidence: a synthetic update from an unknown user reached the document handler and the download. The settings-change path has no owner check. The result's chatId itself stays the receiving chat.
- Recommendation: check the allowed chats before downloading and apply owner verification by sender ID to admin commands. Separate document submission in allowed groups from global settings changes. Put the allow-list in the zod schema with a default-deny policy.
- Guardrails: guardrail 2's fixed chatId does not substitute for authentication. Guardrail 4's secrets are not exposed directly, but the right to use those keys is.
- **Status: fixed in R1** — default deny, pairing, owner-only admin commands, strict `access` schema.

### SEC-02. [High] No request-rate or cumulative-cost limits, and whitespace bypasses the cost guard

- Location: `src/core/pipeline.ts:67-84,149-158,244-265,359-366`, `src/core/sections.ts:118-120`, `src/adapters/providers/openai.ts:66-74`, `src/adapters/providers/claude.ts:55-61`.
- Problem: the character limit strips whitespace, but the real chunk and summary input includes it. There is no per-user rate limit, per-document maximum chunk count, daily budget or limit on repeated `/full` / `/summary`. OpenAI requests specify no output-token cap.
- Attack precondition: a user who can submit documents or re-run commands. Even after restricting to allowed users, repeated-request control is a separate need.
- Impact: many requests from few effective characters, or repeated billing for the same document. Under the current serial polling, other users are delayed too. Nested SDK and pipeline retries further multiply request counts on failure.
- Evidence: `('word' + ' '.repeat(3990)).repeat(100)` is 399,400 characters but counted as 400 by the cost guard and produced 99 chunks. In the earlier mock experiment the same Claude chunk was requested up to six times.
- Recommendation: apply budgets on real transmitted input/output tokens, a chunk-count cap, per-user/chat/global rate limits and a daily cost limit. Count re-run requests against the budget too and consolidate retry responsibility in one layer. Duplicate-request metadata and a short cool-down are possible without any content disk cache.
- Guardrails: related to cost guard 5. Metadata-based limits are needed that do not harm the no-content-storage principle.
- **Status: fixed in R2** — whitespace-inclusive measure, chunk cap, per-chat hourly limit, daily budget, SDK retries 0, `max_completion_tokens`.

### SEC-03. [High] Untrusted document parsers run without resource isolation

- Location: `src/adapters/extractors/docx.ts:36-44`, `src/adapters/extractors/pdf.ts:12-25`, `src/core/pipeline.ts:135-149`.
- Problem: only the compressed upload size is limited; there is no application limit on DOCX decompressed size, XML size or entry count, PDF page or object counts, CPU, memory or processing time. The extracted-text cap is checked only after parsing completes. DOCX processes images during the default HTML conversion even though they are discarded.
- Attack precondition: uploading a complex or highly compressed file under the size limit.
- Impact: risk of denial of service through memory exhaustion or CPU occupation of the bot process. try/catch cannot control process OOM or CPU time.
- Evidence: in a limited experiment modifying an existing DOCX in memory, an 8,260-byte archive expanded to 250,000 characters of extracted text. This demonstrates the expansion and the post-hoc check order; no actual OOM attack was run. Mammoth also documents pathological CPU/memory usage and recommends separate execution with a timeout. [Mammoth security note](https://github.com/mwilliamson/mammoth.js#security)
- Recommendation: set DOCX ZIP entry and decompression budgets and PDF page/output caps, and parse in a restricted separate process that receives no secrets. Terminate the real work on deadline and disable image conversion. A Promise timeout in the same process does not stop CPU work.
- Guardrails: even with isolation, source text must not be left on disk and any unavoidable temp file must be cleaned up immediately (1). Parsers must not inherit API-key environment variables (4).
- **Status: partially fixed in R4** — ZIP entry/decompression budget, PDF page cap, images never decoded, 60-second deadline. Out-of-process isolation with CPU/memory limits is queued for v0.2.

### SEC-04. [Medium] SDK debug logs bypass the application's no-content logging policy

- Location: `src/adapters/providers/claude.ts:55-61,73-82`, `src/adapters/configStore.ts:98-102`, `tests/privacy-audit.test.ts:108-126,165-174`.
- Problem: the Claude SDK client is created without pinning `logLevel` or a safe logger. The installed SDK reads `ANTHROPIC_LOG` and prints request/response information to its own console — before the project's error normalization.
- Trigger: `ANTHROPIC_LOG=debug` set in the environment and a server/proxy error body that contains document data. Log collectors' serialization also affects the exposure.
- Evidence: injecting a 400 text/plain response containing a synthetic document marker printed the marker verbatim in the SDK's `response error` log `message`. In the default console-format experiment for a normal JSON response, nested body markers were not printed, so normal requests are not asserted to always expose content. The API-key header was masked as `***` by the SDK.
- Impact: guardrail 1's no-content-logging guarantee breaks depending on the environment and error shape. The existing privacy test uses FakeTranslator and does not exercise the real SDK log path.
- Recommendation: turn SDK logging off explicitly or inject a metadata-allow-list logger. Combine the real SDK with a mock fetch to check stdout/stderr leakage in debug environments, non-JSON errors and body-reflecting errors.
- Guardrails: a reproducible conditional violation of 1. No real API-key exposure was observed in this experiment.
- **Status: fixed in R3** — `logLevel: "off"`; test with the real SDK, `ANTHROPIC_LOG=debug` and a body-reflecting non-JSON 400.

### SEC-05. [Medium] CWD environment variables can redirect Claude traffic and carry the API key along

- Location: `src/adapters/configStore.ts:98-102`, `src/cli/index.ts:89,104,128`, `src/adapters/providers/claude.ts:55-61`.
- Problem: the entire `.env` in the current directory is loaded and the SDK's baseURL is not pinned. The installed SDK applies `ANTHROPIC_BASE_URL` automatically — an outbound path the project's config schema does not control.
- Attack precondition: the attacker must control the `.env` in the directory the user runs from, or the execution environment. No path changing environment variables via document upload or chat was found. A deliberately configured trusted proxy is not considered an attack.
- Evidence: with the synthetic value `https://review-sink.invalid` and a mock fetch, the request URL became that host's `/v1/messages` and the synthetic API key was attached as `x-api-key`. Nothing was sent to a real external host.
- Impact: running from an untrusted working folder can send documents and the owner's key to an arbitrary server. The provider shown as Claude in the schema does not guarantee the real destination.
- Recommendation: read `.env` only from trusted locations or import only the required keys. Pin the official destination and expose proxies through separately validated configuration. Enforce HTTPS and allowed origins, and apply the destination policy to redirects as well.
- Guardrails: a conditional risk related to 2 (external forwarding) and 4 (secret protection).
- **Status: fixed in R3** — `.env` allow-listed to the three secret keys; `baseURL` pinned to the official endpoint.

### SEC-06. [Medium] The JSON error for a corrupted config prints part of a secret

- Location: `src/adapters/configStore.ts:21-22,35-38`, `src/core/configMessages.ts:145-154`, `src/cli/status.ts:24-29`.
- Problem: the parser's error text is inserted into the CLI explanation. Node's JSON parse errors can include part of the invalid input.
- Trigger: editing a config that contains keys/tokens incorrectly and loading it with `start`, `status`, etc. There is no path that writes config JSON from a remote upload.
- Evidence: with the synthetic input `literal:FAKE_SECRET_FOR_REVIEW`, `literal:FA` appeared in the error output. No real user config or key was read or used.
- Impact: secret fragments remain in terminal or support logs. `redactSecretRef` on the normal path does not protect the error path. Rated Medium because the attack precondition is narrower than in the general review's identical item.
- Recommendation: discard the parser text and provide only a fixed error code and safe position information. Use field allow-lists for zod error output as well and do not treat user input as unconditionally safe detail.
- Guardrails: missing error-output protection under 4.
- **Status: fixed in R3** — fixed `syntax` code; regression test.

### SEC-07. [Medium] Existing permissions, ownership and symbolic links of the secret config are not verified

- Location: `src/adapters/configStore.ts:26-30,55-61,69-71`, `src/cli/status.ts:33-35`.
- Problem: file mode, ownership and link status are not checked on read. Saves write to the existing path first and chmod afterwards. `mode: 600` does not change an existing file's permissions before writing, nor does it tighten an existing directory.
- Attack precondition: an existing config readable by other local accounts, or a layout where the attacker can change the path or parent directory. With a properly created and maintained user-only 700 directory the risk is low.
- Impact: a loosely-permissioned config is used silently, or the secret is written under the existing permission state. An attacker who can change the path could induce unintended overwrites or secret exposure through symbolic links. Arbitrary remote file writes or root access were not confirmed.
- Evidence: static analysis of the open/write order. No cross-account attack or real config change was performed.
- Recommendation: verify the config file's owner, type and permissions and the parent directory. Write to a safely created temp file in the same directory with mode 600 and replace atomically, defending against link races. Run as an ordinary user.
- Guardrails: 4's mode-600 requirement must apply to the whole lifetime — reading and replacing, not just creation.
- **Status: fixed in R3** — `lstat` checks (symlink, non-regular, permission bits) and atomic replacement.

### SEC-08. [Medium] Download metadata is trusted and the actual received bytes are not limited

- Location: `src/adapters/telegramAdapter.ts:76,86-96`, `src/core/pipeline.ts:135-136`.
- Problem: a missing `file_size` is treated as 0. The getFile response size, Content-Length and the streamed size are not checked before the whole `arrayBuffer()` is built. The pipeline does not re-check the real byte length either.
- Attack precondition: missing or inaccurate platform metadata, or an abnormal download response. An ordinary Telegram user is not assumed to forge `file_size` freely. Telegram has its own download limits.
- Evidence: with the adapter limit set to 8 bytes, a synthetic update without file_size and a 32-byte mock response, 32 bytes were returned unchanged. Even with 32 bytes declared in getFile, it was not rejected.
- Impact: the application's own size invariant is not guaranteed, so excessive memory can be consumed on abnormal responses.
- Recommendation: use metadata only as an early-rejection aid and enforce the cutoff on the actual accumulated stream bytes. Re-verify the length in the pipeline and handle negative, abnormal or missing values explicitly.
- **Status: fixed in R4** — getFile `file_size`, `content-length` and streaming accumulation are all checked; the pipeline re-checks the byte length.

### SEC-09. [Medium] Missing request deadlines and cancellation amplify denial-of-service impact

- Location: `src/adapters/providers/openai.ts:46-54,77-84`, `src/adapters/telegramAdapter.ts:63-65,94-96,138-145`, `src/cli/start.ts:94-105`.
- Problem: OpenAI fetch and Telegram file downloads have no overall deadline, body-size limit or shutdown cancellation signal. The real default long polling waits for the whole document job before processing the next update.
- Attack precondition: long responses, a proxy/server that never finishes the body, long-running upload processing. This does not mean a remote user controls a legitimate API server's responses.
- Impact: one job's long wait delays other chats and clean shutdown. Even with runtime network limits, the service deadline of the whole document job is not guaranteed.
- Evidence: the request and shutdown paths, and the installed grammY's sequential update processing. No experiment holding the network indefinitely was run.
- Recommendation: apply AbortSignal-based request and body deadlines, a maximum response size and a per-document deadline, and cancel on shutdown. Limit global concurrency and queue length while keeping per-chat order.
- **Status: fixed in R4 and R5** — deadlines and byte caps (R4); non-blocking dispatch, concurrency cap and drain (R5).

### SEC-10. [Medium] Limited defence against instructions inside documents and model output

- Location: `src/core/prompts.ts:25-36,40-53`, `src/adapters/providers/claude.ts:66-71,84-94`, `src/adapters/providers/openai.ts:68-89`, `src/core/pipeline.ts:266-275,313-336`.
- Problem: the document is the entire user message. The system role is separated, but there is no explicit rule that commands inside the document are data rather than instructions, and any non-empty text returned by the model is effectively posted as the translation.
- Attack precondition: the attacker can author instructions or hidden text in the document and the model follows them. Model behaviour is probabilistic; no actual model bypass was attempted in this review.
- Impact: integrity risks such as altered clauses, accounts or links, omitted key sentences, or phishing text that appears endorsed by the bot. Document content alone cannot execute shell commands, read environment variables or choose another chatId, and no such tools are given to the model.
- Evidence: static analysis of prompt construction and the output posting path. Not classified as definite API-key theft or remote code execution.
- Recommendation: mark document content as untrusted data and instruct the model not to follow internal instructions or role impersonation. Use delimiters only as an aid. Check for missing numbers, URLs or clauses against the source and flag anomalous results for review. Continue to grant the model no authority over tools or destinations.
- Guardrails: 2's posting target remains independent of model output and must stay so.
- **Status: fixed in R6** — both prompts state that the user message is data, not instructions; the model still has no tools or destination authority.

### SEC-11. [Medium] Link previews for URLs from the model or the document are not disabled

- Location: `src/adapters/telegramAdapter.ts:109-117`, `src/core/pipeline.ts:319-322`, `src/core/prompts.ts:29`.
- Problem: text posts do not set `link_preview_options: { is_disabled: true }`. URLs from untrusted documents and from the model travel this path.
- Attack precondition: an external URL ends up in the result and Telegram generates a preview for it. Can combine with a prompt-injection attempt to embed document content in a URL.
- Impact: external link access and tracking, and values embedded in the URL may be exposed to the destination. The direct chatId is kept, but incidental external access is not restricted. Direct SSRF from the application server or an actual exfiltration was not demonstrated.
- Evidence: the mock API payload for a synthetic URL sent via postText had no preview-disable option. The official Telegram API states that if the preview URL is omitted, the first URL in the message is used, and previews can be turned off with `is_disabled`. No real external preview call was tested. [Telegram LinkPreviewOptions](https://core.telegram.org/bots/api#linkpreviewoptions)
- Recommendation: disable previews by default for automatically posted messages. Treat Markdown images, HTML and URLs inside document files as untrusted data as well, and restrict network loading and executable HTML if a viewer is built later. Do not delete source URLs unconditionally, which would damage the translation.
- Guardrails: a complementary item to 2 regarding indirect external access outside the posting scope.
- **Status: fixed in R6** — `link_preview_options.is_disabled` on every text post.

### SEC-12. [Medium] Missing runtime schema validation at external response and event boundaries

- Location: `src/adapters/providers/openai.ts:22-24,77-89`, `src/adapters/providers/claude.ts:84-93`, `src/adapters/telegramAdapter.ts:72-96`, `src/core/config.ts:64-83`.
- Problem: config is validated with Zod, but OpenAI JSON is only type-asserted and Claude responses / Telegram events are not separately validated at runtime for the required structure and size invariants. TypeScript and SDK return types do not validate abnormal network data. Unknown config keys are stripped without error.
- Attack precondition: abnormal API/proxy responses or integration errors. External users are not assumed to control provider responses directly.
- Impact: `null`, wrong content types, etc. escape the expected ProviderError as TypeErrors and break the normal retry policy. Excessively large output is handled only after reception. A user who adds `allowedChatIds` to the config and believes they are protected gets no effect.
- Evidence: in the earlier execution review, 200 responses with `null` or numeric content both raised TypeErrors. In this review, adding `allowedChatIds` to the config parsed successfully and was removed. This does not mean an allow-list feature existed.
- Recommendation: apply Zod schemas and response-size caps to external responses and unify failures as safe error codes. Validate event IDs, sizes and file metadata. Define security settings explicitly and reject unknown keys so a wrong protective setting is noticed early.
- **Status: fixed in R1 and R4** — strict config schemas (R1); zod-validated OpenAI responses, Claude shape guard, byte caps (R4).

### SEC-13. [Low] Secret files at a custom config path are outside the Git exclusion rules

- Location: `.gitignore:12-15`, `src/cli/index.ts:79-83`, `src/cli/init.ts:208-213`, `src/adapters/configStore.ts:49-60`.
- Problem: `.env` variants are excluded, but a user-chosen secret config path inside the repository such as `.msg-agent/config.json` is not. The CLI's `--config` accepts paths inside the repository and can store literal secrets there.
- Trigger: the user chooses a config path inside the repository instead of the default home path and then commits the file.
- Impact: keys/tokens can be committed accidentally with `git add`. The default home-directory config is outside the repository and no real key commit was found in this review.
- Evidence: `git check-ignore .msg-agent/config.json config.json` excluded neither path. The tracked environment file is `.env.example` with empty values.
- Recommendation: exclude the project-local config directory from Git and warn clearly when literal config is stored inside the repository. Add secret scanning in CI or pre-commit, and prefer env references in operation. Do not exclude all JSON broadly.
- Guardrails: a missing supplementary control for 4's commit prevention.
- **Status: fixed in R3** — `.msg-agent/` added to `.gitignore`; `prepublishOnly` tarball check added later as an extra control.

## Verdict on guardrails 1, 2 and 4

| Guardrail | Confirmed protection | Remaining issues and verification limits (at review time) |
| --- | --- | --- |
| 1. No content on disk or in logs | Production file writes are concentrated in configStore. Extraction works on in-memory bytes, sent files are InputFile(bytes), and there is no content cache file. Application error logs mostly carry only error names/codes. | SEC-04's SDK log path was outside the existing audit. The privacy test centres on TXT/MD and FakeTranslator, so it does not prove no-storage across every dependency and operating environment. Logging file names and chatIds as metadata is allowed by the guardrail, but an operational retention period should be defined separately. |
| 2. Post only to the original chat | Every result post in `pipeline.ts:313-344` uses the received chatId. No path interprets model output as a chatId, and `/full` / `/summary` look up only the same chat's last document. | SEC-01 access control, SEC-05 destination and SEC-11 link-preview risks remained. `message_thread_id` is not preserved, so forum-topic isolation is not guaranteed; topics were not assumed to be a separate access boundary. |
| 4. Key and token protection | Secret input uses password prompts, literal values are masked in normal status, env references are supported, new default config is 600 with a 700 directory, and `.env` is excluded. | Destination, error output, existing permission and commit-prevention issues in SEC-05/06/07/13. The real home config and real environment values were neither inspected nor copied into the report. |

Guardrail 2's "no external forwarding" was interpreted as a limit on forwarding results, excluding the translation-provider requests that SPEC/DESIGN explicitly allow. The document itself is sent to the chosen external LLM API. If every external transmission were meant to be forbidden, that would conflict with the current product design and the wording should be clarified. Provider-side retention, training use and per-account retention policies are not verified by the local no-storage tests.

## Remaining attack-surface check

| Area | Result |
| --- | --- |
| SQL / database | No DB client, SQL query or ORM path in the code, so SQL injection and DB access control do not apply. |
| OS command / code injection | No document-driven shell execution, eval or dynamic code execution in production `src/`. LLM results are never executed. |
| XSS | No HTTP web UI or HTML renderer. Telegram postText sets no parse_mode, and DOCX HTML is never inserted into a web page. No web XSS path was confirmed. A separate sanitizer would be needed if generated Markdown were shown on the web later. |
| CSRF | No browser cookie authentication or web mutation endpoint, so classic CSRF does not apply. The missing Telegram command authorization is SEC-01. |
| Direct SSRF | No path where the app fetches URLs from uploaded content. The Telegram download host is fixed in code. OpenAI's baseUrl is a code option and is not taken from config or the model. The Claude environment-variable path exists separately as SEC-05. |
| DOCX external file reads | The installed Mammoth's `externalFileAccess` defaults to false and the project does not change it. No vulnerability reading arbitrary local files via external image paths was found. Keep this setting when preserving links or changing the conversion. |
| Redirects | No web redirect endpoint. Not pinning the redirect policy of fetch requests relies on trusting external servers. No current path was found where an attacker injects arbitrary redirects without controlling the initial destination or a trusted server. |
| Path-traversal uploads | The user's fileName is used in logs and attachment names but never in a local document storage path. No path was found where `../` in a file name overwrites server files. Local attacks on the config path are treated separately in SEC-07. |
| Privilege escalation | Apart from SEC-01's exposure of application admin rights, there is no sudo/setuid or OS privilege change path. The bot does not need to run as root. |
| Environment variables | `.env.example` secrets are empty and process.loadEnvFile reads the CWD file. No full environment dump was taken. Non-secret SDK control variables also affect the security boundary (SEC-04, SEC-05). |

## Dependency and supply-chain review

- `npm audit --json --ignore-scripts` was run read-only against the npm registry. After an initial sandbox DNS failure it completed with network allowed. Result: **0 known vulnerabilities** — critical/high/moderate/low/info all 0. Audited dependency metadata totals 291 packages (prod 56, dev 225; categories may overlap).
- This reflects known advisories in the registry at that time and does not prove the absence of malicious packages, undisclosed vulnerabilities or the safety of all transitive code. `npm audit fix`, dependency installs/upgrades and lockfile changes were not run.
- All resolved URLs in the lockfile within the checked range were `registry.npmjs.org`, with no missing integrity fields. Version and hash pinning help reproducibility and transport integrity but do not replace trust in package authors.
- Key locked versions: `@anthropic-ai/sdk` 0.124.0 (`package-lock.json:45`), Mammoth 1.12.2 (`:3043`), pdf-parse 2.4.5 (`:3257`), pdfjs-dist 5.4.296 (`:3277`), grammY 1.46.0, Zod 4.5.4, JSZip 3.10.1.
- `hasInstallScript` entries in the lockfile were esbuild 0.28.2 (`package-lock.json:2086`) and fsevents 2.3.3 (`:2471`). These are not classified as malicious. Install and build in an environment without secrets and allow only the necessary lifecycle scripts.
- The check and pre-publish gates in `package.json:24,28` contain no audit or secret scan. `npm ci` in CI, periodic advisory checks, secret scanning and release provenance verification could be added. No `.github` workflow was found.
- The npm package `files` is limited to dist, but the dev-dependency install and build supply chain remains subject to review. A full Git-history secret scan, verification of the already-published npm tarball, and signature/provenance verification were not performed here.

## Scope, execution results and limits

- Baseline: 2026-09-05, commit `fda3f25`, Node v24.12.0. Reviewed the 43 files under `src/`, the project guardrails, related tests, configuration, scripts, the lockfile and the installed core dependency implementations.
- `npm run check` re-run passed: typecheck, ESLint, Prettier, 20 test files / 178 tests. Core lines 97.19%, branches 86.79%. This coverage does not imply completeness of security attack cases.
- All application behaviour was reproduced with synthetic keys, synthetic documents and mock fetch/API. No real Telegram/LLM transmission of document input or results, no real billing, no reading of the user's home config, no large-scale DoS or real account attacks.
- Network access was used for the npm advisory lookup and to check public official documentation. No messages were sent to the registered bot, users or other chats.
- No new code or tests were created. Only this document was added; the earlier `001_CODE_REVIEW.md` and the existing source, configuration and lockfile were preserved. Coverage artifacts may have been generated by the existing checks.

Priority response was SEC-01 access control, SEC-02 cost/rate limits and SEC-03 parser resource isolation, followed by the error-log, environment-variable and file-permission issues under guardrails 1 and 4, and mock-based security regression tests using the real SDK. All items except full process isolation (SEC-03, queued for v0.2) were addressed in R1–R7 on 2026-09-06.
