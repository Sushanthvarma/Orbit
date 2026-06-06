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

## Persistence & atomicity

All local writes go through `db.js`. Single-store writes use `put`/`delete`;
any action that must touch **more than one store** (e.g. an expense **and** its
activity-feed entry, or a settlement + its activity entry) uses
`OrbitDB.writeTx([...])`, which applies every op inside **one IndexedDB
transaction** — so a crash mid-write can never leave the stores out of sync
(all-or-nothing; a partial failure rolls everything back). There is **no
denormalised balance cache** — balances are always recomputed from the
expense/settlement records, so they can't drift out of sync with the ledger.

## Cloud sync & conflict strategy

Orbit is **local-first**: IndexedDB is the working copy; Firestore is the
backup / multi-device mirror. The strategy:

- **Write-through.** Every local `put`/`writeTx`/`delete` is mirrored to
  Firestore for the signed-in user (`installCloudWriteThrough`), keyed by the
  record's own `id`. Because writes are **keyed by id and idempotent**, a retry
  after a network blip can never create a duplicate.
- **Versioning.** Every entity write stamps a monotonic `updatedAt` (ms epoch)
  via `db.js`. This is the version field for **last-write-wins**: the higher
  `updatedAt` is the winner. `OrbitDB.mergeByUpdatedAt(local, remote)` performs
  that merge (unit-tested in `_qa_persist.mjs`).
- **Shared groups** (`/groups/{id}`) sync in real time via Firestore
  `onSnapshot`; incoming docs are merged by id (`mergeById`). Membership changes
  go through trusted Cloud Functions (`acceptInvite`/`removeMember`/…), never
  the client, so the roster can't be forged.

### Known limitation (tracked)

The legacy per-user pull (`enterApp` → `pullAll`) is currently
**cloud-authoritative**: on sign-in it replaces the local copy with the cloud
copy. That correctly propagates deletions, but a write made **while offline**
(and not yet mirrored) can be lost on the next sign-in. The proper fix is to
(a) enable Firestore's `persistentLocalCache` so offline writes queue and sync
natively, and (b) switch the pull to a non-destructive
`mergeByUpdatedAt` + tombstones for deletions. The `updatedAt` stamping and the
merge helper above are the groundwork; the rewire needs a staging project with
two real devices to validate before shipping.

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
