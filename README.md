# Orbit Web

A real desktop web application for splitting expenses — a Splitwise-killer with
sidebar navigation, multi-column workspace layout, full CRUD on groups /
expenses / settlements, analytics, and UPI deep-linked settlement.

Inspired by the look and feel of Linear, Vercel and Stripe dashboards.

## Run

You can open `index.html` directly in a modern browser, but to enable the
service worker and `upi://` protocol redirects it's best to serve it:

```bash
cd orbit-web
python3 -m http.server 8001
# then open http://localhost:8001
```

Or any other static server:

```bash
npx serve .
# or
npx http-server -p 8001 .
```

## Stack

- 100% vanilla JavaScript — no React, no build step.
- IndexedDB for persistence (`db.js`).
- Hash router, multi-view SPA (`app.js`).
- Inline SVG for all charts.
- Service worker for offline cache (`sw.js`).
- PWA manifest with desktop shortcuts (`manifest.json`).

## Pages

| Route             | What it does                                              |
| ----------------- | --------------------------------------------------------- |
| `#/dashboard`     | KPI cards, recent-activity table, settle panel, 28-day chart |
| `#/groups`        | Filterable grid of group cards                            |
| `#/groups/:id`    | Group detail with Expenses / Balances / Settle / Settings tabs |
| `#/expenses`      | Master expense table with filters, bulk delete, CSV export |
| `#/trips`         | Trip groups with per-trip daily-spend bar charts          |
| `#/analytics`     | Donut + bar charts, top categories / groups / people     |
| `#/activity`      | Chronological feed across groups                          |
| `#/settle`        | Smart settle (debt simplification) per currency           |
| `#/profile`       | Account, UPI, theme, data export / wipe                   |
| `#/upgrade`       | Four-tier pricing page                                    |

## Keyboard shortcuts

- `/`  Focus global search
- `n`  Add expense
- `g`  Go to groups
- `d`  Go to dashboard
- `Esc` Close modal

## Data

First launch seeds 7 users, 6 groups, 25 expenses, and 1 settlement that
reflect a realistic Indian + Europe context. Use **Profile → Reset to seed
data** to start over, or **Wipe all data** to clear everything.

CSV export and JSON backup are real downloads (Blob URLs).

## UPI deep links

Pay buttons construct an `upi://pay?pa=…&pn=…&am=…&cu=INR&tn=…` URL. On
desktop the browser pops the protocol-handler dialog (or fails silently if no
handler is installed) — that's expected. On Android with a UPI app installed
the app launches with the amount pre-filled.

## Files

```
orbit-web/
├── index.html        shell
├── styles.css        full design system + sidebar + tables + modals + charts
├── db.js             IndexedDB wrapper
├── seed.js           realistic Indian seed data
├── app.js            router, state cache, all views, all CRUD
├── sw.js             service worker (offline cache)
├── manifest.json     PWA manifest
├── icons/            app icons (svg, 192, 512, maskable-512)
└── README.md         this file
```
