# MONEY.md — Orbit personal-finance suite (reference + backlog)

Deep reference for the **Money** half of Orbit. Pairs with [CLAUDE.md](CLAUDE.md) (setup/deploy/tests).

## Data model (IndexedDB stores + cloud, all keyed by `id` except `fin_nwhistory` by `date`)
| Store | Shape (key fields) |
|---|---|
| `fin_accounts` | `{id, name, type(savings\|checking\|cash\|credit\|loan\|other), balance, currency}` |
| `fin_txns` | `{id, type(income\|expense\|transfer), amount, date, category, account, payee, method, tags[], status(cleared\|pending), description, notes, attachment(dataURL), fromAccount, toAccount}` |
| `fin_budgets` | `{id, category, amount}` (amount = monthly limit) |
| `fin_goals` | `{id, name, target, saved, monthlyContribution, targetDate}` |
| `fin_loans` | `{id, name, principal, emi, interestRate, startDate, endDate, currency}` |
| `fin_investments` | `{id, fundName, platform, category(equity\|debt\|liquid\|hybrid\|gold\|crypto\|other), currentValue, currency}` |
| `fin_subs` | `{id, name, amount, cycle(weekly\|monthly\|quarterly\|yearly), nextRenewal}` |
| `fin_recurring` | `{id, type, amount, description, category, frequency, nextDate, account, active}` |
| `fin_nwhistory` | `{date, netWorth}` (one snapshot per day) |

Demo records additionally carry `demo:true` so `clearFinanceDemo()` can remove exactly them.
`State.finAccounts / finTxns / finBudgets / finGoals / finLoans / finInvestments / finSubs /
finRecurring / finNwHistory / finBase` mirror these in memory.

## OrbitFinance API (`finance.js` — pure, fully unit-tested)
Money/net-worth: `ACCOUNT_TYPES, accountSign, netWorthByCurrency, netWorthTotal, assetsLiabilities,
computeNetWorth(data, base), investmentsTotal, liquidCash`.
Transactions: `TXN_EXPENSE_CATEGORIES, TXN_INCOME_CATEGORIES, txnCategoryLabel, CATEGORY_KEYWORDS,
guessCategory(text, type), monthlyTransactions, categoryBreakdown, actualSpendForCategory,
filterTransactions(txns, filter), payeeBreakdown, methodBreakdown, tagBreakdown, expensesInPeriod`.
Budgets/goals: `computeBudgets(budgets, txns), computeGoal(goal)`.
Loans: `loanOutstanding(loan, asOf), loansOutstandingTotal, simulateDebtPayoff(loans, strategy, extra)`.
Subscriptions/recurring: `SUB_CYCLE_MONTHS, subMonthlyCost, computeSubscriptions, advanceDate,
dueRecurring, normMonthly`.
Insight/forecast: `financialMetrics(data, base)` (health/runway/savingsRate/burn), `cashflowProjection(
data, months, base)`, `generateInsights, computeTrends, remindersDue, snapshotNetWorth`.
Intelligence/IO: `parseFinanceText(text)` (NL → `{type,amount,category,description}`; understands
k/lakh/cr), `parseTxnCSV(text)` (+`dedupeTxns`, `splitCsvLine`), `buildFinanceCSV, csvCell`.
Payment metadata: `PAYMENT_METHODS, METHOD_ICON`.

Invariants the unit suites enforce (see `finance-unit2.mjs`): `computeNetWorth = assetsLiabilities.net
+ investmentsTotal − loansOutstandingTotal + splitwiseNet`; budget `pct = actual/limit*100`,
`over = actual>limit`; goal `complete ⇔ saved≥target`, `pct` capped 0–100; subscriptions
`monthly = Σ subMonthlyCost`, `yearly = 12×monthly`; cash-flow `closing = opening+income−expense−emi`
and `opening[i+1] = closing[i]`; loan outstanding non-increasing over time and ≥ 0.

## Screens (all `viewX()` in `app.js`)
- **Net worth** — first-run welcome card when empty; else a hero net-worth KPI (incl. live Splitwise
  position) + assets/liabilities + `financialVitalsRow()` (health/runway/savings) + Smart insights +
  unified Splitwise balance card + accounts. Has CSV/PDF **Export** menu.
- **Transactions** — KPIs, a **collapsible** filter bar (search + period/type/category/account/method/
  status; inline on desktop, behind a "Filters" toggle on mobile), month nav, bulk select
  (recategorize/tag/delete), per-row detail modal, **CSV import**, **⚡ Quick add** (NL). Merges
  manual txns + Splitwise virtual share txns (read-only, `source:'split'`).
- **Budgets / Goals / Loans / Investments / Subscriptions / Recurring** — CRUD + insights.
  Goals render as a **card-grid with ring progress**; Investments shows an **allocation donut** +
  2-column holdings; Loans has a **debt-payoff planner** (avalanche/snowball + extra payment).
- **Pending** — unpaid (status `pending`) bills + upcoming recurring + upcoming renewals; "✓ Paid".
- **Cash flow** — 24-month projected-balance chart (axes/gridlines) + month-by-month table.
- **Trends** — net-worth line chart + 12-month income-vs-expense bars + Top merchants / By method /
  By tag breakdowns. Charts (`finLineChart`, `finBarChart`) have real Y-axis currency ticks,
  X labels, gridlines, point markers.

## Unification (no duplicates)
`finData()` returns `{accounts, txns(=finAllTxns()), investments, loans, budgets, goals, subs,
recurring, splitwiseNet}`. `finVirtualTxns()` derives read-only "your share" txns from group
expenses (`ORBIT_CAT_TO_FIN` maps Split categories → finance categories). `finSplitwiseNet()` =
owed-to-you − you-owe, folded into net worth. Nothing is double-stored.

## Backlog (prioritized — do these next)
1. **★ Multi-currency FX in net worth** *(biggest gap)*. Today `assetsLiabilities`/`computeNetWorth`
   count only base-currency accounts; foreign accounts vanish. Wire `OrbitFX` (rates) so balances
   convert into `finBase()`. Touch points: `assetsLiabilities`, `investmentsTotal`, `loanOutstanding`
   totals, `netWorthTotal`. Add unit tests (mixed-currency portfolios) + a settings control for base.
2. **Goals contribute UX** — replace the `prompt()` with a small modal; allow linking a contribution
   to an account (transfer).
3. **Brand/merchant logos** for subscriptions (favicon avatar + monogram fallback).
4. **Harden NL parse** — support multiple amounts / signed amounts; show a confirm preview already
   exists in Quick add, extend it.
5. **CSV import** — warn on unparseable-date rows instead of defaulting to today; column-mapping UI.
6. **Reminders** — schedule browser notifications for `remindersDue()` (bills/renewals) on load.
7. **Recurring catch-up** — when a rule is back-dated > 120 cycles, fully reconcile (currently caps).

## Gotchas
- Bump `?v=N` in `index.html` after editing `finance.js`/`app.js`/`styles.css`.
- `finMoney()` rounds for display; never use it for math — use the raw numbers from `OrbitFinance`.
- The Trends/Cashflow charts and Goals rings/Investments donut use `svgEl()` + `finRing/finDonut`
  (defined near `viewTrends` in `app.js`). They read `svgEl` which is a module-scope `const`.
- Sub-nav icons are **cloned** from `.sidebar .nav-item[data-route="X"] .nav-icon svg` (the sidebar is
  hidden in the top-nav layout but kept for this + data-route hooks).
- Don't make the transactions filter bar `position:sticky` with a glass `.card` background again —
  in dark mode that's transparent and overlaps the ledger (the bug that was just fixed).
