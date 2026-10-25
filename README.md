# deal-harness

A sales agent harness that runs inside Claude Code (and later Claude Desktop, Codex, Gemini CLI). It reads Gmail and Sheets and writes Gmail drafts that you review and send yourself. It never sends. See `CLAUDE.md` and `BUILD_PLAN.md`.

## Phase 1 setup (by hand; the installer comes in Phase 9)

1. **Google OAuth client.** In your Google Cloud project, turn on the Gmail API and the Google Sheets API. Then create an OAuth client of type *Desktop app* and download its JSON. Add yourself as a test user on the OAuth consent screen.
2. **Build:** `npm install && npm run build`
3. **Sign in:** `DEAL_HARNESS_OAUTH_CLIENT=/path/to/client_secret.json node dist/cli/index.js login`. The refresh token goes in your OS keychain.
4. **Hook into Claude Code:** copy `.mcp.example.json` to `.mcp.json`, fill in the paths and your rate card Sheet, and restart Claude Code. `.mcp.json` is git-ignored.

## Tools

- `gmail_read`: a thread by id, or a Gmail search.
- `sheets_read`: a Sheet range, or every tab.
- `gmail_draft`: a reply or a new email, saved as a draft. Before anything is written, it runs `pricing.check`. Every price in the body has to be declared in `prices` with its rate card item, and none can be below the floor. Otherwise it creates no draft and returns the reasons.

MCP tool names use `_` rather than `.`, because Claude's tool-name rules don't allow dots.

## Rate card

Any layout works. On each tab the harness looks for a header row with an item column (product, plan, SKU, service…) and a price column (price, rate, fee, monthly, floor, minimum…), then reads the rows below it.

- **Floor:** a floor or minimum column if there is one. Otherwise list price minus max discount, if there's a discount column. Otherwise the list price.
- **Several price columns** (say Monthly and Annual) become variants. Pass `variant` to pick one. When it's left out, the highest floor applies.
- **Volume tiers:** read from a seats or quantity column ("1-10", "51+"), or from min/max qty columns. Blank item cells under an item belong to that item.
- **Currencies:** from a currency column, the cell (`$`, `S$`, `€`, `USD`…), or the header ("Price (SGD)"). The harness never converts currencies.

Optional settings:

- `DEAL_HARNESS_RATE_CARD_RANGE`: read only this range, e.g. `Pricing!A1:H100`.
- `DEAL_HARNESS_RATE_CARD_COLUMNS`: name the columns when the headers can't be guessed, e.g. `{"name":"Thing","list":"Ask","floor":"Num"}`. Roles are `id`, `name`, `floor`, `list`, `cost`, `max_discount`, `currency`, `unit`, `min_qty`, `max_qty` and `qty`.

## Commands

`npm run build` · `npm test` · `npm run lint && npm run typecheck` · `npm run serve`
