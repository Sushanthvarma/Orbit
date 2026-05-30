# Hosting checklist — Orbit (GitHub Pages + custom domain)

Pre-launch steps that only you can do. The code is ready.

## 1. GitHub Pages

This repo is structured so the **repo root** is the deployable app.

1. Settings → Pages → **Source: Deploy from a branch** → `main` → `/ (root)`.
2. Wait for the green checkmark + Pages URL (e.g. `https://sushanthvarma.github.io/Orbit/`).

## 2. Custom domain

1. Add your domain in Settings → Pages → **Custom domain**.
2. GitHub will create a `CNAME` file at the repo root with your domain — commit it.
3. At your DNS provider, point the apex (or `www`) at GitHub Pages:
   - Apex `A` records: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - Or `CNAME` `www` → `sushanthvarma.github.io`
4. Tick **Enforce HTTPS** after the cert provisions (5–30 min).

## 3. Firebase Console — required for sign-in to work

Project: **orbit-f35be**

1. **Authentication → Settings → Authorized domains**: add your custom domain (and `sushanthvarma.github.io` if you'll use the Pages subdomain too). Without this, every sign-in fails with `auth/unauthorized-domain`.
2. **Authentication → Sign-in method**: confirm Google is enabled.
3. **Firestore → Rules**: paste contents of [`firestore.rules`](firestore.rules) and Publish. Without rules deployed, the DB is either fully open or fully closed.

## 4. Google Cloud Console — quota protection

1. Open Google Cloud Console for the `orbit-f35be` project → APIs & Services → Credentials → the Browser key.
2. **Application restrictions** → HTTP referrers → add:
   - `https://<your-domain>/*`
   - `https://sushanthvarma.github.io/*`
   - `http://localhost:*/*` (for dev)
3. **API restrictions** → restrict to: Identity Toolkit API, Cloud Firestore API, Firebase Installations API, Token Service API.

This stops anyone who scrapes the API key from spending your quota.

## 5. Gemini API key (optional, for AI quick-add)

Each user enters their own Gemini key in-app. As the operator you don't need one.

If you want a "shared demo key", **don't** ship it in source — Gemini doesn't support HTTP referrer restrictions, so any visitor can siphon it.

## 6. Smoke test on the live URL

- [ ] Sign in with Google works
- [ ] You land on a dashboard with seed demo data
- [ ] Create a new expense, refresh — it persists
- [ ] Open Firestore Console → confirm doc appeared under `orbit/<your-uid>/expenses/`
- [ ] Open in Safari / iOS → sign-in completes via redirect (popup is blocked there)
- [ ] PWA install prompt fires; installed icon opens to `/index.html#/dashboard`
- [ ] Service worker registers (DevTools → Application → Service workers)
- [ ] Toggle airplane mode → app shell still loads (offline cache)

## Known limits at launch

- No public Privacy / Terms pages yet — fine for personal/early-access launch, will need them for Google OAuth verification when you scale past 100 users (Google's threshold).
- Tesseract OCR worker downloads ~10 MB on first receipt scan; cached after that.
- Frankfurter FX feed treats INR / AED as targets only — the code rebases through EUR.

## Files & versions

- Service worker cache: `orbit-web-v5` (bump in `sw.js` if assets change)
- Script versions in `index.html` query strings — bump when shipping a new build to bust browser cache
