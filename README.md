# deal-harness

A sales agent harness that runs inside Claude Code, Claude Desktop, Codex and Gemini CLI. It reads Gmail, Sheets, Drive and Calendar, keeps deal memory in plain markdown, and writes Gmail drafts that you review and send yourself. It never sends. See `CLAUDE.md` and `BUILD_PLAN.md`.

## Setup

1. **Google OAuth client.** In your Google Cloud project, turn on the Gmail, Sheets, Drive and Calendar APIs. Then create an OAuth client of type *Desktop app* and download its JSON. Add yourself as a test user on the OAuth consent screen.
2. **Install:** `npx deal-harness init` (from a checkout: `npm install && npm run build && node dist/cli/index.js init`). It:
   - installs its own copy in `~/.deal-harness/app`, which every app runs, by absolute path, with the node you ran it with;
   - creates your data folder (`~/deal-harness-data`, or `--data <folder>`) as a git repo;
   - finds the apps you have and sets each one up:

     | App | Server entry | Skills |
     |---|---|---|
     | Claude Code | `claude mcp add -s user` | `~/.claude/skills/` |
     | Claude Desktop | `claude_desktop_config.json` | zips in `~/.deal-harness/desktop-skills/` for you to upload (Settings → Capabilities → Skills) |
     | Codex | `~/.codex/config.toml` (`[mcp_servers.deal-harness]`) | `~/.agents/skills/` |
     | Gemini CLI | `~/.gemini/settings.json` (`mcpServers`) | `~/.agents/skills/` |

   - asks for the OAuth client JSON (saved in `config.local.md`, not committed) and signs you in to Google; the token goes in your OS keychain.

   Pick apps with `--apps claude-code,codex`. Skill folders you already have with the same names are left alone. Gemini only starts servers in folders you trust.
3. **Settings:** in `~/deal-harness-data/config.md`, set `rate card sheet` (a link is fine), `deals sheet` (your pipeline) and `max discount`.
4. **Check:** `deal-harness doctor` (or `node ~/.deal-harness/app/node_modules/deal-harness/dist/cli/index.js doctor`). It checks Node, the install, the data folder, Google, that the server starts with no sending tools, and each app's entry and skills.

`npx deal-harness@latest update` installs a newer version, brings your data folder's format up to date (it only adds, never overwrites), and refreshes every app. `deal-harness uninstall` takes the harness out of every app and removes the Google token (`--keep-login` keeps it); your data folder stays.

## Tools

| Tool | What it does |
|---|---|
| `gmail_read` | A thread by id, or a Gmail search |
| `gmail_draft` | A reply or new email, saved as a draft after every check passes |
| `sheets_read` | A Sheet range, or every tab |
| `drive_read` | A Doc, Slides, Sheet or text file as text; or a search |
| `calendar_read` | Events in a time window, or one event |
| `memory_list` / `memory_read` | Browse and read the data folder |
| `memory_write` | Write under `memory/` or `company/`, committed to git; new signals are quote-checked |
| `memory_add_signal` | Add one signal to an account; dropped if the quote isn't in its source |
| `memory_search` | Full-text search over memory |
| `meeting_notes` | A meeting's Gemini notes ("Notes by Gemini" Doc), or a list of recent meetings |
| `promise_log` / `promise_done` / `promises_due` | Commitments on a deal, ours and theirs, quote-checked; late ones with days late |
| `mail_scan` | Past mail you wrote in, grouped by outside company (cached) |
| `sent_samples` | Your own sent emails, quoted replies cut, to learn your voice |
| `outcome_log` | A past deal's outcome with its evidence, always unconfirmed |
| `history_stats` | ICP map and calibration baseline, computed from confirmed outcomes |
| `similar_deals` | Past deals most like a given one, with what worked and went wrong |
| `pipeline_read` | Deals from your deals Sheet (any layout), with the harness's latest probabilities |
| `deal_prior` | Base win rate for a deal like this one, from confirmed history |
| `probability_set` | Log a win probability with its reason (append-only) |
| `forecast` | Won, expected, likely and possible for a period, per currency |
| `scenario_model` | What-ifs: change deals and see the forecast move |
| `calibration_score` | How well probabilities matched confirmed outcomes (Brier score, predicted vs actual) |
| `pdf_export` | A memory file as a PDF in `<data>/exports/` |
| `stakeholder_view` | One person's role, words and promises, nothing else (for /prep's rehearsal) |
| `edits_capture` | Pairs harness drafts with what you sent; records the words you cut, changed or added |
| `lessons_learn` | Proposes lessons from edits repeated in 3+ drafts and from confirmed outcomes |
| `lesson_propose` | The agent proposes one lesson with its evidence |

Everything from outside (mail, files, events, memory) comes back inside an `OUTSIDE_DATA` block. MCP tool names use `_` rather than `.`, because Claude's tool-name rules don't allow dots.

## Checks inside `gmail_draft`

A draft is created only if all of these pass. Otherwise you get every reason back.

- **recipient:** a reply only goes to people on the thread, or others at their company. A new email only goes to people you've emailed before. Bcc only goes to your own domain. A planted Reply-To doesn't count as being on the thread.
- **pricing:** every money amount in the body is a declared price, line total or grand total, and no price is below its rate card floor.
- **discount:** every discount or freebie is declared. None goes past the rate card's max discount (or `max discount` in config), or pushes list price below the floor.
- **words:** nothing from the default risky-promise list, your `company/voice.md` "Never say" list or your accepted "Never write" lessons, and no unfilled placeholders.
- **leak:** no internal terms (floor, margin, win probability…), no rate card link, no local paths, no outside people's addresses, and no other customers' names.

`quote.check` runs inside every memory write that adds a signal.

## Skills

- `/company`: fill in what the harness knows about your company.
- `/account`: build or refresh one account's file.
- `/signals`: capture signals and promises from a thread, a file or a meeting's Gemini notes.
- `/nag`: what's late, and nudge drafts.
- `/proposal`: a checked pricing or proposal draft, with a deslop pass and a buyer critic (`buyer critic: off` in config.md turns it off).
- `/war`: an RFP battle card against one competitor, exported as a PDF.
- `/history`: rebuild past deals from mail; ICP map and baseline from the outcomes you confirm.
- `/plan`: a close plan and a pre-mortem built from how similar deals were lost.
- `/rift`: forecast scenarios and what-ifs, with every number computed by the harness.
- `/report`: forecast, calibration and what's working.
- `/prep`: a meeting brief with a stakeholder-by-stakeholder rehearsal.

## Confirming past outcomes

/history guesses how each past deal ended and saves it unconfirmed in `memory/history/outcomes.md`. Run `node dist/cli/index.js confirm` to go through them (y = right, w/l/n = it was won/lost/no decision, d = not a deal), or tick `[x]` by hand. The agent can't confirm outcomes, and unconfirmed ones never count in the ICP map, calibration or lessons.

## Lessons

Each draft the harness makes is remembered (in `memory/edits/pending.json`, git-ignored). `edits_capture`, or `node dist/cli/index.js learn`, pairs it with the email you actually sent and saves only the changed words in `memory/edits/<month>.md`. When you cut or change the same words in 3 or more drafts, or 3 or more confirmed deals share a loss reason, a lesson is proposed in `memory/lessons/proposed.md`. Run `node dist/cli/index.js lessons` to accept (a) or reject (r) each one. Accepted voice lessons go to `memory/lessons/accepted.md`, and "Never write" ones are then refused by `gmail_draft`; accepted plays go to `company/playbook.md`. Rejected lessons are never proposed again. The agent can propose, never accept.

## Scheduled runs

`node dist/cli/index.js schedule` runs `/prep` every evening and `/nag` every morning (times in config.md), headless through Claude Code's `claude -p`. Each run's output is saved in `<data>/runs/` and shows as a desktop notification. `schedule --remove` undoes it, and `run prep` or `run nag` runs one now. macOS and Linux only for now.

## Rate card

Any layout works. On each tab the harness looks for a header row with an item column (product, plan, SKU, service…) and a price column (price, rate, fee, monthly, floor, minimum…), then reads the rows below it.

- **Floor:** a floor or minimum column if there is one. Otherwise list price minus max discount, if there's a discount column. Otherwise the list price.
- **Several price columns** (say Monthly and Annual) become variants. Pass `variant` to pick one. When it's left out, the highest floor applies.
- **Volume tiers:** read from a seats or quantity column ("1-10", "51+"), or from min/max qty columns. Blank item cells under an item belong to that item.
- **Currencies:** from a currency column, the cell (`$`, `S$`, `€`, `USD`…), or the header ("Price (SGD)"). The harness never converts currencies.

If headers can't be guessed, set `rate card columns` in config.md, e.g. `{"name":"Thing","list":"Ask","floor":"Num"}`. Roles are `id`, `name`, `floor`, `list`, `cost`, `max_discount`, `currency`, `unit`, `min_qty`, `max_qty` and `qty`.

## Commands

`npm run build` · `npm test` · `npm run lint && npm run typecheck` · `npm run serve` · `npm run eval` (or `npm run eval -- injection`) · `npm run reindex`

`npm run eval` scores six sets (threads, outcomes, calibration, promises, edits, injection) and writes `evals/score.md`. The code-only parts are free and take seconds. `EVAL_AGENT=1 npm run eval` also runs Claude Code headless (`claude -p`) on recorded threads and scores what it writes; that takes a few minutes and uses model credits. `EVAL_MODEL` picks the model.
