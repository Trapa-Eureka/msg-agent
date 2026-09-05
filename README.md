# msg-agent

[![npm](https://img.shields.io/npm/v/msg-agent)](https://www.npmjs.com/package/msg-agent) · Node.js 22.12+ · MIT

A **personal AI agent that auto-translates foreign-language documents posted in a messenger chat into your native language**.

- When a document file (PDF, DOCX, TXT/MD) is uploaded to a chat → detect the language → translate if it is not your native language → post the result in the same chat.
- Output defaults to **smart mode**: short documents get the full translation in the chat; long documents get a **native-language summary in the chat plus the full translation as a file attachment**. Switch with `/full`, `/summary`, `/mode`.
- Onboarding after `npm install` is three CLI questions: ① native language ② AI provider + API key (Claude by default, OpenAI supported) ③ messenger + token.
- **v0.1 messenger is Telegram.** Why: long polling runs on a laptop without a public URL or server, bot tokens need no review, and the file API is simple (20 MB bot download limit). Messengers sit behind the `MessengerAdapter` interface, so Slack (v0.2, Socket Mode) → Viber (v0.3, Philippine market) → Discord/WhatsApp/Teams are added as adapters only.

Identity: the product is an **Agent** (upload event → autonomous processing). An MCP server in v0.2 will expose the same core as a `translate_document` tool — "queries go through MCP, autonomous event handling is the Agent's job".

## Document map

| Document | Contents | When to read |
|---|---|---|
| `CLAUDE.md` | Agent steering — stack, commands, rules, guardrails | Start of every agent session (auto-loaded) |
| `docs/SPEC.md` | Product spec — onboarding, output-mode rationale, roadmap | Before feature discussions and scope decisions |
| `docs/DESIGN.md` | Technical design — pipeline, interfaces, Telegram constraints, CLI | Required before implementing |
| `docs/TESTING.md` | Test strategy — fake messenger/translator, edge cases | Before writing tests |
| `docs/TASKS.md` | Task backlog — agent execution units, completion criteria | When assigning work |
| `docs/WORKFLOW.md` | AI-native development rules (shared + repo-specific) | Once at the start, then as reference |
| `docs/HUMAN_PREP.md` | Checklist of things only a human can prepare (tokens, keys, documents, release steps) | Before starting a task |
| `docs/COVERAGE.md` | Core coverage report + privacy audit summary | After T10 |
| `docs/001_CODE_REVIEW.md`, `docs/002_SECURITY_REVIEW.md` | Full code and security review findings (2026-09-05) and their remediation status | When touching the reviewed areas |

## Development approach

Same as the previous three repos: **documents → agent implementation → verification**. The human (Jin) owns spec, review, real-token smoke tests and npm release approval; Claude Code implements one `docs/TASKS.md` task at a time. The shared gate is `npm run check`.

## Quick start

```bash
# Node.js 22.12 or newer
npm install
npm run cli -- init    # onboarding: native language / provider + API key / Telegram bot token (verified immediately)
npm run cli -- start   # start the daemon — send the six-digit code from the terminal to the bot as `/start <code>` to register as owner (once)
```

`npm run cli -- status` prints a config summary (keys and tokens redacted) and the bot connection state. Keys and tokens are stored only in `.env` (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `TELEGRAM_BOT_TOKEN`) or in `~/.msg-agent/config.json` (mode 600).

After the npm release, install globally instead: `npm i -g msg-agent` → `msg-agent init` / `msg-agent start` / `msg-agent status`.

### Chat commands

| Command | Effect |
|---|---|
| (upload a document) | Detect → translate if not the native language. Short: full text in chat; long: summary + `.md` file |
| `/full` | Full translation of the last document as a file |
| `/summary` | Summarize the last document again (+ file) |
| `/mode smart\|full\|summary` | Change the default output mode |
| `/lang <code>` | Change the native language (e.g. `/lang ko`) |
| `/start <code>` | Pairing: register as owner with the code shown in the terminal (once) |
| `/allow` · `/deny` | (owner) Allow / revoke the current chat |

The bot only processes documents from the paired owner and from allowed chats. Documents and commands from anyone else are ignored without a reply.

### Security notes for users

- **Your keys stay yours.** The package never ships credentials. On `init` you enter your own Anthropic/OpenAI API key and your own Telegram bot token; they are stored only in `.env` or `~/.msg-agent/config.json` (mode 600) and every API cost is billed to your account.
- **Nobody can use your bot until you pair it.** `start` prints a one-time six-digit code; send `/start <code>` to the bot from your own Telegram account. Documents and commands from anyone else are ignored silently. Use `/allow` in a group (as the owner) to let that group submit documents, `/deny` to revoke.
- **Rotate a leaked token.** In @BotFather run `/revoke` (or `/token`) to invalidate the old bot token, then re-run `init` or update `.env`. Rotate API keys in the provider console the same way.
- **Document content is never written to disk or logs.** Only metadata (file name, size, language, timings) is logged; an automated privacy audit enforces this on every `npm run check`.
- **For maintainers publishing to npm:** keep the npm account on two-factor authentication in "authorization and publishing" mode (a security key or an authenticator app), store the recovery codes safely, and note that `prepublishOnly` refuses to publish if the tarball would contain secret files or key-like strings.

### Verification

```bash
npm run check   # typecheck + lint + format + test (coverage thresholds + privacy audit)
npm run smoke -- [--chat <chatId>] [--wait 300]   # manual smoke with a real bot and real keys (humans only, TESTING §5)
```

## Status

- 2026-09-04: documentation phase (no code). Starting from T0.
- 2026-09-05: T0–T11 implemented, real Telegram bot + Claude smoke passed, threshold kept at 3,000, package name `msg-agent` decided.
- 2026-09-06: code and security review remediation R1–R7 done (214 tests), smoke re-passed. **v0.1.0 published to npm**: https://www.npmjs.com/package/msg-agent (`npm i -g msg-agent@0.1.0`), tag `v0.1.0`, repository public.
- 2026-09-06: all documentation and in-code comments/CLI text translated to English (Korean remains only as the product's Korean phrase pack and test fixtures); published as v0.1.1. v0.1.2 fixes `--version` (it printed a hard-coded 0.1.0; the CLI now reads `package.json`).
