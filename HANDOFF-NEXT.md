# Orbit — Handoff / What's Next

Context for continuing the build (any AI model or developer can pick this up cold).
Repo: `C:\dev\Splitwise\orbit-web`  ·  Live: https://sushanthvarma.github.io/Orbit/  ·  Firebase project: `orbit-f35be`

---

## What this project is
Orbit — a Splitwise competitor (group expense split + UPI settle). Vanilla HTML/CSS/JS, no build step. Firebase Auth (Google) + Firestore. Deployed via GitHub Pages from repo root `Sushanthvarma/Orbit`.

Run locally: `cd orbit-web && python -m http.server 8001` → http://localhost:8001
Deploy: commit + push to `main`; GitHub Pages auto-builds. Then open `?reset=1` once to clear the service worker cache.

---

## DONE (already shipped to live, unless noted)

1. **Blank-screen bug fixed** — `.login-gate[hidden]{display:none!important}` in styles.css. (live)
2. **UI redesign** — dashboard hero card + 3D tilt, group cards, all chart/trip/analytics/profile component CSS (≈74 previously-unstyled classes). (live)
3. **Device-aware Pay** — `payViaUPI()` in app.js: mobile fires `upi://pay` (UPI app chooser); desktop shows a QR modal. (live)
4. **WhatsApp buttons** — `remindViaWhatsApp` / `inviteViaWhatsApp` / `waOpen` on settle rows. (live)
5. **Empty-start for launch** — `seedIfNeeded()` in seed.js now creates only the self user; demo data is opt-in via `loadDemoData()` + a "Load demo data" button in Settings → Data. (live)
6. **Multi-user re-architecture — BUILT, NOT DEPLOYED:**
   - **Phase A** — shared data model + membership security rules.
   - **Phase B** — invite-accept Cloud Functions + invite/join UI.
   - **Phase C** — realtime `onSnapshot` sync controller.

### New files from the multi-user work
- `groups.js` — shared-group data layer (`window.OrbitGroups`): createGroup, listMyGroups, addExpense/addSettlement (under `groups/{id}`), createInvite, acceptInvite (calls Cloud Function), leaveGroup, onMyGroups/onGroupExpenses realtime.
- `functions/index.js` + `functions/package.json` — `acceptInvite` + `leaveGroup` callable Cloud Functions (region `asia-south1`), transaction-safe, validate invites server-side so membership can't be forged.
- `firestore.rules` — REWRITTEN: legacy `orbit/{uid}` rules kept; added membership-based rules for `groups/`, `users/`, `invites/`.
- `rules-test/` — 22-assertion security-rules test suite (test.mjs, firebase.json, package.json).
- In `app.js`: `viewJoin()` (#/join/:code route), `inviteToGroup()` (Invite button on group detail), `RealtimeSync` controller (starts after sign-in, stops on sign-out).
- `index.html` loads `groups.js` as a module; versions bumped to app.js?v=15, groups.js?v=2, styles.css?v=9, sw cache orbit-web-v15.

### Data model (target / shared)
```
users/{uid}                profile (name,email,upi,phone,photoURL) + groupIds[]
groups/{groupId}           name,currency,emoji,createdBy,memberUids[],members{uid:{...}}
groups/{groupId}/expenses/{id}      title,amount,currency,paidBy(uid),splits[{uid,amount}],...
groups/{groupId}/settlements/{id}   fromUid,toUid,amount,...
invites/{code}             groupId,invitedBy,status,expiresAt
```
Access boundary = your uid in `groups/{id}.memberUids`. Shared records use random ids (`g_…`,`e_…`) so they never collide with legacy seed ids — merge-by-id is safe, no double-counting.

---

## WHAT'S NEXT (in order)

### STEP 0 — Verify the security rules (you, local; needs Java)
The rules test couldn't run because Java wasn't installed.
```powershell
winget install --id Microsoft.OpenJDK.17      # then RESTART PowerShell
java -version
cd C:\dev\Splitwise\orbit-web\rules-test
npm install --legacy-peer-deps "@firebase/rules-unit-testing@3.0.4" "firebase@10.12.4"
npm test
```
Expect "==== 22 passed, 0 failed ====". If any fail, fix `firestore.rules` before deploying.

### STEP 1 — Enable billing (you, Firebase Console)
Cloud Functions require the **Blaze (pay-as-you-go)** plan. Free tier is generous but Functions don't run on Spark. Firebase Console → upgrade project `orbit-f35be` to Blaze.

### STEP 2 — Deploy rules + functions (you, PowerShell)
```powershell
npm install -g firebase-tools
cd C:\dev\Splitwise\orbit-web
firebase login
firebase use orbit-f35be
cd functions && npm install && cd ..
firebase deploy --only firestore:rules,functions
```
This makes the secure invite→join flow work. (Rules alone — without functions — already enable shared groups + realtime; only the server-validated *join* needs the function.)

### STEP 3 — Firebase Console settings (you)
- Authentication → Settings → Authorized domains: add `sushanthvarma.github.io` (and any custom domain).
- (Optional, India-first) Authentication → Sign-in method: enable Phone.

### STEP 4 — PHASE D: data migration + unified UI (NOT BUILT — next dev/model)
This is the remaining engineering to make it a finished product:
1. **Surface shared groups in the UI.** Currently `groups.js` + RealtimeSync feed `State.groups`/`State.expenses`, but the create-group modal still writes LOCAL groups. Make "New group" optionally create a SHARED group (call `OrbitGroups.createGroup`), and make adding an expense to a shared group call `OrbitGroups.addExpense` (not just local OrbitDB). Right now local and shared paths are separate.
2. **Migrate existing per-user data** (`orbit/{uid}/groups|expenses`) into the shared `groups/` model: for each, map local `u_self` → real uid; local contacts become "pending" members until they accept an invite. Do this on a STAGING Firebase project first; reconcile balances to the paisa pre/post.
3. **Pending-member UX** — show invited-but-not-joined members distinctly; their splits are "pending".
4. **Cached balances (scale)** — optional Cloud Function recomputes `groups/{id}.balances` on each expense write so clients don't recompute large ledgers.
5. **Settlements via transaction** — wrap settle writes in Firestore transactions so concurrent settles can't double-count.

### Known open items / honest caveats
- Multi-user (A/B/C) is **built and syntax-valid but NOT deployed and NOT yet wired into the create-group / add-expense UI** — that's Phase D step 1.
- The create-group + add-expense flows still write to the LOCAL IndexedDB/`orbit/{uid}` model. Until Phase D step 1, shared groups are read/realtime-visible but new data entry still goes local.
- Rules tests unrun (Step 0). Do not deploy rules to production before they pass.
- Existing demo data may still be in your Firestore account — Settings → Data → "Clear to empty" wipes it (local + your cloud copy).

---

## File map (orbit-web/)
- `index.html` — shell + script tags (query-string versioned)
- `app.js` — router, all views (`render<Name>`), CRUD, Pay/WhatsApp, RealtimeSync, viewJoin/inviteToGroup
- `styles.css` — full cream-glass design system
- `db.js` — IndexedDB wrapper (legacy local store)
- `seed.js` — self-only seed + opt-in `loadDemoData`
- `cloud.js` — LEGACY per-user Firebase sync (orbit/{uid})
- `groups.js` — NEW shared multi-user layer (window.OrbitGroups)
- `functions/` — Cloud Functions (acceptInvite, leaveGroup)
- `firestore.rules` — security rules (legacy + shared)
- `rules-test/` — rules unit tests
- `fx.js` `ocr.js` `ai.js` `importers.js` `recurring.js` `activity.js` `exporters.js` — feature modules

Design source of truth: `../Orbit/design_handoff_orbit/` (README + 2 HTML prototypes).
