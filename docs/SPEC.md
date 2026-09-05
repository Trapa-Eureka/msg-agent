# SPEC — msg-agent v0.1

Written: 2026-09-04 · Status: final (edit this document first when anything changes)

## 1. Background

In remote collaboration, foreign-language documents (contracts, manuals, notices, quotes) arrive through messengers every day. This removes the friction of downloading each file and pasting it into a translator: **the moment a document appears in a chat, a native-language version follows in the same chat.** It is a self-hosted agent that an individual installs from npm and runs with their own API key (no server, no sign-up).

## 2. First messenger decision: Telegram (rationale)

| Candidate | Verdict | Rationale |
|---|---|---|
| **Telegram** | **adopted for v0.1** | Long polling (getUpdates) needs no public URL or server → runs on a laptop immediately. @BotFather issues tokens without review. getFile downloads up to 20 MB — enough for documents |
| Slack | v0.2 | Socket Mode works without a public URL, but app creation and scope setup are long |
| Viber | v0.3 | High value in the Philippine market, but webhooks are mandatory → tunnel/deployment raises onboarding difficulty |
| Discord | later | Gateway bots are fine; low usage for document work |
| WhatsApp | later | Business Cloud API — Meta business verification, phone number, webhooks. Hardest for personal use |
| Teams | later | Azure bot registration — enterprise procedure |

Architecture requirement: add messengers in this order, each as a single `MessengerAdapter` implementation with no core changes.

## 3. Onboarding (CLI `init`)

1. **Native language** — pick from a fixed list of ten: Korean, English, Spanish, French, German, Japanese, Chinese, Italian, Russian, Latin (decided by Jin on 2026-09-05: the full-language autocomplete was too hard to pick from). Other languages can be set from the chat with `/lang <ISO 639 code>`. Phrase packs exist for ko and en only; other languages fall back to English messages (translation itself supports every language).
2. **AI provider** — choose Claude (default) or OpenAI and enter the API key → verified immediately with one call.
3. **Messenger** — fixed to Telegram in v0.1: paste the BotFather token → verify → "invite the bot to the chat you want".

Config is stored in `~/.msg-agent/config.json` (mode 600). `start` launches the daemon.

4. **Pairing (access control, R1)** — the bot accepts nobody by default. `start` prints a six-digit pairing code in the terminal; when the owner sends `/start <code>` to the bot, they are registered as owner and that chat is allowed. The owner allows other chats (groups) with `/allow` and revokes with `/deny`. Documents, `/full` and `/summary` are processed only for allowed chats or the owner; `/mode`, `/lang`, `/allow`, `/deny` are owner-only; everything else is ignored silently (metadata-only log).

## 4. Output-mode decision: full text vs summary

**Conclusion = smart mode by default.** It is not a choice between full text and summary; it depends on document length:

- **Short document (at or below the threshold, default ~3,000 characters of extracted text)** → full translation in the chat (split to the messenger's message limit; Telegram allows 4,096 characters per message).
- **Long document (above the threshold)** → a **structured native-language summary** in the chat (title, key clauses, figures, requests) **plus the full translation attached as a .md file**. Flooding the chat with full text kills the conversation; a summary alone loses information — skim the summary, open the file for the full text. That fits messenger UX.
- Commands: `/full` (this document's full text as a file), `/summary` (summarize again), `/mode full|summary|smart` (change the default mode), `/lang <language>` (change the native language).
- **Same-language documents are skipped**: if the detected language equals the native language, reply with one line: "This document is already in {language}."
- Partial translation (user-selected range) is out of scope for v0.1 because messenger UIs offer no good way to select a range — `/full` covers the request form; page selection (`/pages 3-5`) is a v0.2 candidate.

## 5. v0.1 scope

- Formats: text-layer PDF, DOCX, TXT/MD. Any source language (auto-detected).
- Telegram adapter (long polling), 1:1 chats and groups the bot is invited to.
- Smart mode + four commands. Progress messages ("Translating… n/m").
- Cost guards (R2): file ≤ 20 MB (Telegram limit); **extracted text length (whitespace included, the same measure as the strings actually sent)** capped by `maxChars` (default 120,000) — above it, refuse and ask to split the file; a per-document chunk cap; per-chat documents per hour (`limits.docsPerChatPerHour`, default 20, re-run commands included); a global daily character budget (`limits.dailyChars`, default 1,000,000). All counters are metadata kept in memory (guardrail 1).

## 6. v0.1 non-goals

- Scanned PDF / image OCR — v0.2. Layout-preserving DOCX output (translation in the original layout) — v0.3.
- MCP server (expose the core as a `translate_document` tool) — v0.2.
- Additional messengers (Slack, Viber, …), glossaries, multi-user server mode, audio/video subtitles.

## 7. Success criteria (v0.1 done)

- [x] e2e-mock: upload → detect → translate → post (short document full text / long document summary + file / same-language skip / four commands) all pass. — T9 `tests/e2e.test.ts`
- [x] Real smoke: one English PDF through a real Telegram bot → Korean summary + file received. — 2026-09-05, @docu_translate_bot, 4,755-char PDF, 55.6 s, every checklist item ✓ (TESTING §5)
- [x] Tests prove document content never remains in logs or on disk. — T10 `tests/privacy-audit.test.ts`
- [x] `npm run check` passes with `src/core/` coverage ≥ 90%. — 178 tests at the time, core 97% (`docs/COVERAGE.md`)

**v0.1 completion verdict: met (2026-09-05).** What remained was the release procedure (TASKS.md release checklist), completed 2026-09-06.

## 8. Open items

- [x] npm package and bin name — **decided: `msg-agent` (2026-09-05, Jin)**. `package.json` name/bin, config path `~/.msg-agent/`, README updated, `private` removed. Candidates at the time, for reference:
  1. `msg-agent` — same as the repository name, bin `msg-agent`
  2. `docslate` — short and brandable (document + translate), bin `docslate`
  3. `chatdoc-translate` — descriptive, bin `chatdoc-translate`
  - The scoped alternative `@shiz_son/msg-agent` was not needed. Applied: `package.json` name/bin `msg-agent`, config path `~/.msg-agent/`, README. `npm publish` is run by a human after the real smoke.
- [x] Short/long threshold default (3,000 chars) — after the 2026-09-05 real smoke (English résumé, 4,755 chars → summary + file), **kept at 3,000** (Jin). Per-user adjustment via config `inlineThresholdChars`.
- [ ] Whether the summary prompt should have per-document-type templates (contract / manual / notice) — review in v0.2
- [ ] Recommended webhook hosting for a Viber adapter (Cloudflare Tunnel vs deployment)
