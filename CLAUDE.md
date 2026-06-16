# CLAUDE.md — Orbit (Split + Money super-app)

> Agent context. Read this first. It tells you what the app is, where everything lives,
> how to run the (3,900+) tests, how to deploy, and the rules you must not break.

## What this is
**Orbit** is one combined personal-finance super-app, vanilla HTML/CSS/JS, **no build step**:
- **Split** — Splitwise-style group expense splitting + UPI settle (the original app).
- **Money** — a full personal-finance suite (net worth, transactions, budgets, goals, loans,
  investments, recurring, subscriptions, pending bills, cash-flow forecast, trends/analytics).

The two halves are **unified, not bolted on**: your live Splitwise balance feeds net worth, and
your share of group expenses flows into spending/budgets as read-only "virtual" transactions —
**no duplicate storage**. See [MONEY.md](MONEY.md) for the deep finance reference.

## ⚠️ CRITICAL — two deploy targets, never confuse them
| Target | URL | How | Rule |
|---|---|---|---|
| **Existing live Splitwise** | `https://sushanthvarma.github.io/Orbit/` (GitHub Pages, builds from `main`) | `git push` to main | **DO NOT touch / deploy here without explicit ask.** It serves the *original* app to real users. |
| **Money super-app** (the combined app you work on) | `https://orbit-money-f35be.web.app` | `firebase deploy --only hosting --config firebase.money.json --project orbit-f35be` | This is where all the Split+Money work is deployed. Separate Firebase Hosting **site** `orbit-money-f35be`. |

The finance work lives in this repo's **working tree but is git-uncommitted** (`git status` shows many `M`).
It is deployed **only** to the Firebase Money site, so the GitHub Pages live app stays untouched. Do not
`git commit`/`git push` unless the user explicitly asks.

## ⚠️ Two directories (the app and its tests are separate)
- **App code (this repo):** `C:\dev\Splitwise\orbit-web`
- **Tests:** `C:\dev\Personal Expence\tests\*.mjs` — Playwright/Node, they serve **this** repo over a
  local http server with a stubbed `OrbitCloud` (bypasses Firebase auth). Run them **from**
  `C:\dev\Personal Expence`.
- **FinEase reference** (the original standalone finance app the Money features were ported from):
  `C:\dev\Personal Expence\deploy-695c71cb1d16439d099704ba_extracted\index.html` — read-only source of truth for parity.

Tip for VSCode: open a **multi-root workspace** with both `C:\dev\Splitwise\orbit-web` and
`C:\dev\Personal Expence` so you can edit the app and its tests together.

## Architecture (how the app works)
- **No framework, no bundler.** `index.html` loads each `*.js` with a `?v=N` cache-buster query.
- **Routing:** hash-based (`#/networth`, `#/transactions`, …). `route()` dispatches in `app.js`.
- **DOM:** a hyperscript helper `h(tag, attrs, children)` builds elements. `setMain(node)` swaps `#main`.
- **State:** one global `State` object (in `app.js`). `render()` re-renders the current route.
- **Storage:** `OrbitDB` (`db.js`) — an IndexedDB wrapper (stores keyed by `id`; `fin_nwhistory` by `date`).
  `put/getAll/delete/clear/getMeta/setMeta` + pub/sub. Cloud write-through wraps `put`.
- **Cloud sync:** `OrbitCloud` (`cloud.js`) — Firebase Auth (Google) + Firestore. `STORE_COLLECTIONS`
  drives pull/push; data at `orbit/{uid}/{store}/{id}`. All 9 `fin_*` stores are included.
- **Namespaces:** `OrbitFinance` (finance.js, pure logic), `OrbitFX` (fx.js, currency format/rates),
  `OrbitAI` (ai.js, NL parse), `OrbitExport` (exporters.js), `OrbitOCR` (ocr.js, image downscale),
  `OrbitRecurring` (recurring.js).
- **Firebase project:** `orbit-f35be`. API key & config in `firebase-config.js`.

## The Money suite (quick map — full detail in MONEY.md)
- **Pure logic:** `finance.js` → `window.OrbitFinance` (net worth, budgets, goals, loan amortization,
  debt payoff, subscriptions, recurring, cash-flow projection, financial metrics, NL parse, CSV
  import, filtering, breakdowns). **Test this heavily — it's pure and fast.**
- **UI:** all `viewX()` Money screens are in `app.js` (`viewNetWorth`, `viewTransactions`,
  `viewBudgets`, `viewGoals`, `viewInvestments`, `viewLoans`, `viewRecurring`, `viewSubscriptions`,
  `viewPending`, `viewCashflow`, `viewTrends`).
- **Data stores (IndexedDB + cloud):** `fin_accounts, fin_investments, fin_loans, fin_txns,
  fin_budgets, fin_goals, fin_subs, fin_recurring, fin_nwhistory`.
- **Navigation:** top bar has a **Split | Money** segmented toggle (`#navPrimary`) + a contextual
  **sub-nav** row (`#subnav`). Built by `renderTopNav()`; routes/sections in `NAV_SECTIONS` +
  `sectionForRoute()`. Sub-nav icons are cloned from the (hidden) sidebar SVGs.
- **Demo data:** `window.loadFinanceDemo()` seeds sample data, **every record tagged `demo:true`**.
  `clearDemoData()` / `clearFinanceDemo()` remove exactly the demo records (user data survives).

## Conventions (match these)
- **Bump the `?v=N`** in `index.html` for any file you edit (`app.js`, `styles.css`, `finance.js`, …)
  or the browser serves stale cached JS. Current: `app.js?v=124 styles.css?v=64 finance.js?v=6`.
- **Money display rounds to whole units** via `finMoney()` (no paise); storage keeps precision.
- **Icons:** use the SVG set — `finIcon(name, size, color)` (names: wallet, receipt, chart, target,
  bank, repeat, bolt, pie, calendar, tag, card, clock, coins, sparkle). Section headings use
  `finSectionTitle(icon, text)`. Rings/donuts: `finRing()`, `finDonut()`. Avoid raw emoji in new UI.
- **Empty states:** `finEmpty(title, sub, withSeed, iconName)` (renders its own icon badge).
- **Test helpers** are exposed on `window.OrbitApp.__test` (e.g. `finData, finAllTxns,
  finSplitwiseNet, clearFinanceDemo, clearDemoData`).

## Run the tests (from `C:\dev\Personal Expence`)
```powershell
cd "C:\dev\Personal Expence"
# Pure-logic units (fast, no browser) — 3,653 assertions:
node tests/finance-unit.mjs
node tests/finance-unit2.mjs
# Browser E2E suites (Playwright; need: npx playwright install chromium once):
node tests/orbit-finance.mjs   # 22 — core finance CRUD
node tests/orbit-journey.mjs   # 20 — full real-user journey across every feature
node tests/orbit-txn.mjs       # 18 — deep transactions (filters/CSV/bulk/detail)
node tests/orbit-clear.mjs     # 13 — data-clear (demo cleared, user data survives)
node tests/orbit-networth.mjs orbit-unify.mjs orbit-seed.mjs orbit-nav.mjs orbit-intel.mjs
# Visual / matrix diagnostics:
node tests/ui-overlap-diag.mjs # overlap + transparency across mobile/desktop × light/dark × 11 screens
node tests/capture-all.mjs     # writes screenshots to tests/audit/
# Adversarial QA suites authored by agents:
node tests/agent-txn.mjs tests/agent-bgl.mjs tests/agent-subs.mjs
```
**Green baseline:** 3,910 tests pass (3,653 unit + 135 browser + 122 agent QA), overlap matrix clean.
The Playwright tests hard-code `ROOT = 'C:/dev/Splitwise/orbit-web'` and stub `OrbitCloud`.

## Deploy (the Money site only)
```powershell
cd "C:\dev\Splitwise\orbit-web"
firebase deploy --only hosting --config firebase.money.json --project orbit-f35be
# Verify the live versions match index.html:
curl -s "https://orbit-money-f35be.web.app/index.html" | Select-String "app.js\?v="
```
Always run the test battery **before** deploying.

## Known issues / not-yet-done (honest list)
- **Multi-currency FX:** `computeNetWorth` filters to the base currency only — **foreign-currency
  accounts are silently excluded** from net worth (no FX conversion). This is the last real FinEase
  parity gap. (`OrbitFX` exists for rates; wiring it into net worth is the next big feature.)
- **NL quick-add** keeps only the **first** amount and drops a leading minus (`parseFinanceText`).
- **CSV import** accepts rows with an unparseable date (defaults to today, silently).
- **Modal save race:** under *very rapid* automated submission, ~15% of saves no-op and leave the
  backdrop open. Not reproducible at human pace; tests retry around it. Worth hardening if touched.
- **Git:** the whole finance build is **uncommitted** in this repo. Don't commit/push without asking.
- The **Split** side is the original app — well-tested and polished; change it cautiously.

## Hard rules (don't)
- Don't deploy to / push the **GitHub Pages** live app without an explicit request.
- Don't break the **Split** side while working on Money (run `orbit-unify.mjs` after Split-adjacent edits).
- Don't attempt to extract Firebase/credential tokens from disk (it's blocked and not needed).
- Don't add a build step / framework / TypeScript — keep it vanilla, match the surrounding style.
- Always bump `?v=N` after editing a JS/CSS file, and run tests before deploying.

## Where to go next
Read [MONEY.md](MONEY.md) for the finance engine + screen-by-screen detail and the prioritized
backlog. The single highest-value next feature is **multi-currency FX in net worth**.
