/* ============================================================
   ORBIT — Cloud Functions (Phase B)
   The trusted server-side membership operations. Clients CANNOT
   add themselves to a group directly (the security rules forbid a
   non-member from updating a group doc). Joining must go through
   acceptInvite, which runs with admin privileges and validates the
   invite before adding the caller to the group's member list.

   Deploy:  firebase deploy --only functions
   Region:  asia-south1 (Mumbai) — closest to India-first users.
   ============================================================ */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

initializeApp();
const db = getFirestore();
const REGION = 'asia-south1';

/**
 * acceptInvite({ code }) — callable.
 * Validates an invite code and adds the authenticated caller to the
 * target group as a member. Idempotent: re-accepting is a no-op.
 */
export const acceptInvite = onCall({ region: REGION }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to join a group.');

  const code = request.data && request.data.code;
  if (!code || typeof code !== 'string') {
    throw new HttpsError('invalid-argument', 'Missing invite code.');
  }

  const inviteRef = db.doc(`invites/${code}`);
  const inviteSnap = await inviteRef.get();
  if (!inviteSnap.exists) throw new HttpsError('not-found', 'Invite not found.');

  const invite = inviteSnap.data();
  if (invite.status === 'revoked') throw new HttpsError('failed-precondition', 'This invite was revoked.');
  if (invite.expiresAt && Date.now() > invite.expiresAt) {
    throw new HttpsError('failed-precondition', 'This invite has expired.');
  }

  const groupRef = db.doc(`groups/${invite.groupId}`);

  // Pull the caller's profile (best-effort) for the denormalized member map.
  const profileSnap = await db.doc(`users/${uid}`).get();
  const profile = profileSnap.exists ? profileSnap.data() : {};

  await db.runTransaction(async (tx) => {
    const groupSnap = await tx.get(groupRef);
    if (!groupSnap.exists) throw new HttpsError('not-found', 'Group no longer exists.');
    const group = groupSnap.data();
    const members = group.memberUids || [];

    if (!members.includes(uid)) {
      const joinedName = profile.name || 'New member';
      tx.update(groupRef, {
        memberUids: FieldValue.arrayUnion(uid),
        [`members.${uid}`]: {
          name: joinedName,
          upi: profile.upi || '',
          avatar: 'av-c' + ((members.length % 8) + 1)
        }
      });
      // Persistent "X joined" entry in the group's activity feed (deterministic
      // id so a re-accept never duplicates it).
      tx.set(db.doc(`groups/${invite.groupId}/activity/join_${uid}`), {
        type: 'member_joined', actorUid: uid, actorName: joinedName,
        createdAt: FieldValue.serverTimestamp()
      });
      // Founder-only global feed of every join across the app.
      tx.set(db.doc(`adminFeed/j_${invite.groupId}_${uid}`), {
        type: 'join', uid, name: joinedName,
        email: (request.auth.token && request.auth.token.email) || '',
        via: 'invite', groupId: invite.groupId, groupName: group.name || '',
        at: FieldValue.serverTimestamp()
      });
    }
    // Index the group on the user's profile for fast listing.
    tx.set(db.doc(`users/${uid}`), {
      uid,
      groupIds: FieldValue.arrayUnion(invite.groupId)
    }, { merge: true });

    // Mark the invite accepted (keep an audit trail of who accepted).
    tx.update(inviteRef, {
      status: 'accepted',
      acceptedBy: FieldValue.arrayUnion(uid),
      acceptedAt: FieldValue.serverTimestamp()
    });
  });

  return { ok: true, groupId: invite.groupId };
});

/**
 * leaveGroup({ groupId }) — callable.
 * Removes the caller from a group. The creator cannot leave their own
 * group (they must delete or transfer it — transfer is a later phase).
 */
export const leaveGroup = onCall({ region: REGION }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const groupId = request.data && request.data.groupId;
  if (!groupId) throw new HttpsError('invalid-argument', 'Missing groupId.');

  const groupRef = db.doc(`groups/${groupId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(groupRef);
    if (!snap.exists) return;
    const group = snap.data();
    if (group.createdBy === uid) {
      throw new HttpsError('failed-precondition', 'The group creator cannot leave; delete the group instead.');
    }
    tx.update(groupRef, {
      memberUids: FieldValue.arrayRemove(uid),
      [`members.${uid}`]: FieldValue.delete()
    });
    tx.set(db.doc(`users/${uid}`), { groupIds: FieldValue.arrayRemove(groupId) }, { merge: true });
  });
  return { ok: true };
});

/**
 * removeMember({ groupId, memberUid }) — callable.
 * The group creator removes ANOTHER member. Only the creator may do this,
 * and the creator cannot remove themselves (they delete the group instead).
 * Idempotent: removing someone already gone is a no-op. Writes a persistent
 * "X was removed" entry to the group's activity feed so every remaining
 * member sees it.
 */
export const removeMember = onCall({ region: REGION }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const groupId = request.data && request.data.groupId;
  const memberUid = request.data && request.data.memberUid;
  if (!groupId || !memberUid) throw new HttpsError('invalid-argument', 'Missing groupId or memberUid.');

  const groupRef = db.doc(`groups/${groupId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(groupRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Group no longer exists.');
    const group = snap.data();
    if (group.createdBy !== uid) {
      throw new HttpsError('permission-denied', 'Only the group owner can remove members.');
    }
    if (memberUid === uid) {
      throw new HttpsError('failed-precondition', 'The owner cannot remove themselves; delete the group instead.');
    }
    const members = group.memberUids || [];
    const inRoster = members.includes(memberUid);
    const inMap = !!(group.members && group.members[memberUid]);
    if (!inRoster && !inMap) return; // nothing to remove — idempotent

    const removedName = (group.members && group.members[memberUid] && group.members[memberUid].name) || 'A member';
    const updates = { [`members.${memberUid}`]: FieldValue.delete() };
    if (inRoster) updates.memberUids = FieldValue.arrayRemove(memberUid);
    tx.update(groupRef, updates);

    // Persistent "X was removed" entry (deterministic id so a re-remove
    // never duplicates it).
    tx.set(db.doc(`groups/${groupId}/activity/remove_${memberUid}`), {
      type: 'member_removed', actorUid: uid, targetUid: memberUid,
      targetName: removedName, createdAt: FieldValue.serverTimestamp()
    });
    // Drop the group from the removed member's profile index (only real
    // accounts have a profile; ghosts that never joined don't).
    if (inRoster) {
      tx.set(db.doc(`users/${memberUid}`), { groupIds: FieldValue.arrayRemove(groupId) }, { merge: true });
    }
  });
  return { ok: true, groupId, memberUid };
});

/**
 * claimPending() — callable.
 * Links the caller's VERIFIED identity (Google email / phone-OTP number) to
 * any pending "ghost" placeholders invited under that handle, across every
 * group, and rewrites those groups' expense/settlement participant ids
 * ghost -> uid. It is a pure relabel — amounts are never touched, so balances
 * are preserved exactly. Idempotent: tickets are deleted as they're claimed.
 */
export const claimPending = onCall({ region: REGION }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const token = request.auth.token || {};
  const handles = [];
  if (token.email && token.email_verified) handles.push(String(token.email).toLowerCase());
  if (token.phone_number) handles.push(String(token.phone_number));
  if (!handles.length) return { ok: true, claimed: [] };

  const profileSnap = await db.doc(`users/${uid}`).get();
  const profile = profileSnap.exists ? profileSnap.data() : {};
  const claimed = [];

  for (const handle of handles) {
    const tickets = await db.collection(`pendingClaims/${handle}/tickets`).get();
    for (const t of tickets.docs) {
      const { groupId, ghostId } = t.data();
      if (!groupId || !ghostId) { await t.ref.delete().catch(() => {}); continue; }
      await db.runTransaction(async (tx) => {
        const groupRef = db.doc(`groups/${groupId}`);
        const gSnap = await tx.get(groupRef);
        if (!gSnap.exists) { tx.delete(t.ref); return; }
        // All reads before any writes (Firestore transaction rule).
        const expSnap = await tx.get(db.collection(`groups/${groupId}/expenses`));
        const setSnap = await tx.get(db.collection(`groups/${groupId}/settlements`));
        const group = gSnap.data();
        const members = group.memberUids || [];
        const ghostName = (group.members && group.members[ghostId] && group.members[ghostId].name) || profile.name || 'Member';

        const groupUpdate = { [`members.${ghostId}`]: FieldValue.delete() };
        if (!members.includes(uid)) {
          groupUpdate.memberUids = FieldValue.arrayUnion(uid);
          groupUpdate[`members.${uid}`] = { name: profile.name || ghostName, upi: profile.upi || '', avatar: 'av-c' + ((members.length % 8) + 1) };
          tx.set(db.doc(`groups/${groupId}/activity/join_${uid}`), {
            type: 'member_joined', actorUid: uid, actorName: profile.name || ghostName,
            createdAt: FieldValue.serverTimestamp()
          });
          tx.set(db.doc(`adminFeed/j_${groupId}_${uid}`), {
            type: 'join', uid, name: profile.name || ghostName,
            email: (request.auth.token && request.auth.token.email) || '',
            via: 'contact-claim', groupId, groupName: group.name || '',
            at: FieldValue.serverTimestamp()
          });
        }
        tx.update(groupRef, groupUpdate);

        expSnap.forEach((d) => {
          const e = d.data(); let changed = false;
          if (e.paidBy === ghostId) { e.paidBy = uid; changed = true; }
          if (Array.isArray(e.splits)) {
            e.splits = e.splits.map((s) => (s && s.userId === ghostId ? (changed = true, { ...s, userId: uid }) : s));
          }
          if (changed) tx.update(d.ref, { paidBy: e.paidBy, splits: e.splits });
        });
        setSnap.forEach((d) => {
          const s = d.data(); const upd = {};
          if (s.fromUser === ghostId) upd.fromUser = uid;
          if (s.toUser === ghostId) upd.toUser = uid;
          if (s.fromUid === ghostId) upd.fromUid = uid;
          if (s.toUid === ghostId) upd.toUid = uid;
          if (Object.keys(upd).length) tx.update(d.ref, upd);
        });

        tx.set(db.doc(`users/${uid}`), { uid, groupIds: FieldValue.arrayUnion(groupId) }, { merge: true });
        tx.delete(t.ref);
      });
      claimed.push(groupId);
    }
  }
  return { ok: true, claimed };
});
