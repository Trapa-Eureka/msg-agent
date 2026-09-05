# HUMAN_PREP — things the human (Jin) prepares personally

Written: 2026-09-05 · Basis: `docs/WORKFLOW.md` §4 (limits of autonomy), `docs/SPEC.md` §3·§7·§8, `docs/DESIGN.md` §4·§7, `docs/TESTING.md` §5

Only items the agent cannot do on the human's behalf. Grouped by when they are needed; check them before starting the related task.
Mark completed items `[x]` with the date.

## 1. Before T0 (now)

- [x] **Repository cleanup** — `.DS_Store` was in the first commit. Add it to `.gitignore` in T0 and untrack it with `git rm --cached .DS_Store`.
      → Done 2026-09-05: `.gitignore` (OS files, node_modules, dist, coverage, .env) added, `.DS_Store` untracked.
- [x] **Decide repository visibility** — could stay private until the npm release (no CI, badges or integrations; zero stars/forks). Guardrail 4 (never commit keys/tokens) applies either way.
      Set to private for now.
      → 2026-09-05: PRIVATE confirmed with `gh repo view`.
- [x] **Choose a LICENSE** — no license file existed. Required for an npm release, so decide (MIT, etc.) early.
      MIT it is.
      → Done 2026-09-05: `LICENSE` (MIT, Copyright (c) 2026 Trapa-Eureka) added at the root. `"license": "MIT"` to be set in `package.json` during T0.
- [x] **Check the Node version** — requirement Node 22.12+ (raised in R7: commander 15 needs 22.12+). v24.12.0 / npm 11.6.2 confirmed on 2026-09-05.

## 2. Before T7 (CLI onboarding) and T11 (smoke)

### Telegram

- [x] **Issue the bot token** — done 2026-09-05: `TELEGRAM_BOT_TOKEN` in `.env`, getMe confirmed (@docu_translate_bot). @BotFather `/newbot`. Store the token only in `.env` (`TELEGRAM_BOT_TOKEN`) or `~/.msg-agent/config.json` (mode 600). Never commit or log it.
- [x] **Register commands** — no longer needed (2026-09-05, T5): the adapter registers them with `setMyCommands` on `start()`. Skip BotFather `/setcommands`.
- [x] **Disable group privacy mode** — confirmed off in the 2026-09-05 smoke (can_read_all_group_messages=true). In privacy mode the bot does not receive ordinary messages or files in groups. For group use: `/setprivacy` → Disable, then remove the bot from the group and re-add it. `npm run smoke` shows the state via getMe.
- [x] **Test chats** — smoke done in a 1:1 chat (2026-09-05); owner pairing done 2026-09-06 (chat allowed). Groups: privacy mode confirmed off; a real group upload is optional (after `/allow`).

### AI provider

- [x] **Anthropic API key** (default provider) — done 2026-09-05: `ANTHROPIC_API_KEY` in `.env`, verified with a models lookup. Check the credit balance.
- [x] **OpenAI API key** (optional) — done 2026-09-05: `OPENAI_API_KEY` in `.env`, verified with a models lookup. Only needed to exercise the OpenAI adapter for real.

### Real documents for the smoke (SPEC §7)

- [x] **One short English PDF** — done 2026-09-06: cover-letter PDF, 2,102 chars → `inline_full` (full text in chat), 23.5 s.
- [x] **One long English PDF** — done 2026-09-05: 4,755-char résumé → summary + file.
- [x] **Run the smoke** — passed 2026-09-05: English PDF (4,755 chars) → summary_plus_file, summary + file received, 55.6 s. Re-run after the review remediation (R1–R7) passed on 2026-09-06: pairing (`/start <code>` → access.paired) done, short-PDF inline_full path confirmed. Every checklist item ✓.
- [x] Use non-sensitive documents — translations are posted to a real chat.

## 3. Release, after T11

- [x] **npm package name** — `msg-agent` (decided 2026-09-05). Recorded in SPEC §8.
- [x] **Unify bin name and config path** — done 2026-09-05: bin `msg-agent`, config `~/.msg-agent/config.json`, CLI name and README updated, `private` removed from `package.json` (publishing still happens only via a human `npm publish`).
- [x] **npm account** — logged in as shiz_son; 2FA confirmed 2026-09-06 (account shows "Enabled for authorization and publishing", one security key).
- [x] **Approve the threshold default** — kept at 3,000 on 2026-09-05 (SPEC §8).
- [x] **History check** — full commit scan on 2026-09-05 (sk-ant- / sk-proj- / bot-token patterns): 0 hits. `.env` was never tracked.
- [x] **Make the repository public** — switched by the user on 2026-09-06, PUBLIC confirmed with `gh repo view`.
  ```bash
  gh repo edit Trapa-Eureka/msg-agent --visibility public --accept-visibility-change-consequences
  ```
- [x] **npm publish** — done 2026-09-06: `msg-agent@0.1.0` published (80.9 kB, 138 files), tag `v0.1.0` pushed, `npx msg-agent@0.1.0 --version` → 0.1.0. `prepublishOnly` (check + build + tarball check) passed.
  ```bash
  cd /Volumes/DevWork/work/msg-agent
  npm publish            # enter the OTP / touch the security key if 2FA asks
  git tag v0.1.0 && git push origin v0.1.0
  ```
  After publishing: `npx msg-agent@0.1.0 --version` → `0.1.0`

## 4. Always human-owned (summary of WORKFLOW §4)

- Managing real bot tokens and API keys, and running smoke tests (they post to real chats)
- npm publishing and the package name
- Approving output-mode policy and threshold default changes
- The order in which new messenger adapters are started (SPEC §2 table)
