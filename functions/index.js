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
      tx.update(groupRef, {
        memberUids: FieldValue.arrayUnion(uid),
        [`members.${uid}`]: {
          name: profile.name || 'New member',
          upi: profile.upi || '',
          avatar: 'av-c' + ((members.length % 8) + 1)
        }
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
