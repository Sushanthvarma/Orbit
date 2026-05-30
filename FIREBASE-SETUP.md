# Firebase setup — Orbit web

Orbit uses Firebase for **Google sign-in** and **Firestore** for cross-device data sync. Everything is per-user: each signed-in account has its own private copy of groups, expenses, and settlements at `orbit/{uid}/…`.

Follow these steps once. The whole thing takes about five minutes.

---

## 1. Create a Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com).
2. Click **Add project**.
3. Name it (e.g. `orbit-web`). Disable Google Analytics — not needed for prototype.
4. Wait for the project to be created, then **Continue**.

## 2. Add a web app

1. On the project home, click the **Web** icon (`</>`).
2. Register an app — nickname `orbit-web`. **Do not** enable Firebase Hosting.
3. Firebase shows you a `firebaseConfig` block that looks like:

   ```js
   const firebaseConfig = {
     apiKey: "AIzaSy…",
     authDomain: "orbit-web-xxxxx.firebaseapp.com",
     projectId: "orbit-web-xxxxx",
     storageBucket: "orbit-web-xxxxx.appspot.com",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abc…"
   };
   ```

4. Copy each value into `firebase-config.js` in this folder, replacing the `REPLACE_ME` placeholders.

## 3. Enable Google sign-in

1. In the console sidebar, go to **Build → Authentication → Get started**.
2. **Sign-in method** tab → **Add new provider** → **Google** → toggle **Enable**.
3. Set a project support email (your own).
4. **Save**.

## 4. Enable Firestore

1. Sidebar → **Build → Firestore Database → Create database**.
2. Choose a region (e.g. `asia-south1` for India).
3. Start in **Production mode**.
4. **Create**.

## 5. Apply security rules

In Firestore → **Rules** tab, replace the contents with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Each user can only read/write their own subtree.
    match /orbit/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

Click **Publish**.

## 6. Allow your domain

Authentication → **Settings → Authorized domains** → add `localhost` if it isn't there already. Add your production domain when you deploy.

## 7. Run the app

```bash
cd C:\dev\Splitwise\orbit-web
python -m http.server 8001
# open http://localhost:8001
```

You should see the **Continue with Google** sign-in screen. Pick your account, accept the consent screen, and Orbit will:

- For a **new account**: seed the demo Indian dataset locally and push it to Firestore.
- For a **returning account**: pull your existing data from Firestore into the local cache.

Sign out from **Profile** → **Sign out**. Sign back in (same or different account) and your data restores from Firestore.

---

## Data model

```
orbit/{uid}                         — profile doc (uid, email, displayName, photoURL, updatedAt)
orbit/{uid}/users/{contactId}       — friend / contact records
orbit/{uid}/groups/{groupId}        — group records
orbit/{uid}/expenses/{expenseId}    — expense records
orbit/{uid}/settlements/{setId}     — settlement records
orbit/{uid}/meta/{key}              — meta key/value pairs (theme, selfUserId, etc.)
```

Per-user copies for now. A future migration will lift `groups` (and their `expenses` / `settlements`) to a root collection with `members: [uid]` arrays to enable real-time Splitwise-style shared groups.

## Troubleshooting

- **"Firebase setup required" gate stays up** → at least one field in `firebase-config.js` still says `REPLACE_ME`. Refresh after editing.
- **`auth/unauthorized-domain`** → add your dev or prod domain in Authentication → Settings → Authorized domains.
- **`permission-denied` on Firestore writes** → security rules not published, or `request.auth.uid` ≠ `{uid}` in the path. Re-paste the rules block above.
- **Popup blocked** → allow popups for `localhost:8001`, or we can switch to `signInWithRedirect` (one-line change in `cloud.js`).
