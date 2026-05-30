// Firestore security-rules unit tests for Orbit Phase A (shared groups).
// Run against the Firestore emulator. Proves membership-based access.
import {
  initializeTestEnvironment, assertSucceeds, assertFails
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs
} from 'firebase/firestore';
import fs from 'fs';

const PROJECT = 'orbit-rules-test';
let env;
let pass = 0, fail = 0;
const results = [];

async function check(name, fn) {
  try { await fn(); results.push('PASS  ' + name); pass++; }
  catch (e) { results.push('FAIL  ' + name + '  — ' + (e.message || e)); fail++; }
}

// Seed data bypassing rules (admin context).
async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // alice + bob are members of g1; carol is NOT.
    await setDoc(doc(db, 'groups/g1'), {
      name: 'Goa Trip', currency: 'INR', createdBy: 'alice',
      memberUids: ['alice', 'bob'], members: {}
    });
    await setDoc(doc(db, 'groups/g1/expenses/e1'), { title: 'Dinner', amount: 4200, paidBy: 'alice', currency: 'INR' });
    await setDoc(doc(db, 'users/alice'), { name: 'Alice' });
    await setDoc(doc(db, 'invites/inv1'), { groupId: 'g1', invitedBy: 'alice', status: 'pending' });
    // legacy data for regression check
    await setDoc(doc(db, 'orbit/alice/expenses/old1'), { title: 'legacy', amount: 100 });
  });
}

const ctx = (uid) => uid ? env.authenticatedContext(uid) : env.unauthenticatedContext();
const db = (uid) => ctx(uid).firestore();

async function run() {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: fs.readFileSync('../firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 }
  });
  await env.clearFirestore();
  await seed();

  // ---- GROUP READ ----
  await check('member (bob) CAN read group g1', () => assertSucceeds(getDoc(doc(db('bob'), 'groups/g1'))));
  await check('non-member (carol) CANNOT read group g1', () => assertFails(getDoc(doc(db('carol'), 'groups/g1'))));
  await check('signed-out CANNOT read group g1', () => assertFails(getDoc(doc(db(null), 'groups/g1'))));

  // ---- GROUP EXPENSES ----
  await check('member (bob) CAN read group expense', () => assertSucceeds(getDoc(doc(db('bob'), 'groups/g1/expenses/e1'))));
  await check('member (bob) CAN write a group expense', () => assertSucceeds(setDoc(doc(db('bob'), 'groups/g1/expenses/e2'), { title: 'Cab', amount: 800, paidBy: 'bob', currency: 'INR' })));
  await check('non-member (carol) CANNOT read group expense', () => assertFails(getDoc(doc(db('carol'), 'groups/g1/expenses/e1'))));
  await check('non-member (carol) CANNOT write group expense', () => assertFails(setDoc(doc(db('carol'), 'groups/g1/expenses/e9'), { title: 'evil', amount: 1 })));

  // ---- GROUP CREATE ----
  await check('user CAN create a group with self as creator+member', () => assertSucceeds(setDoc(doc(db('dave'), 'groups/g2'), { name: 'Flat', createdBy: 'dave', memberUids: ['dave'], currency: 'INR', members: {} })));
  await check('user CANNOT create a group claiming someone else as creator', () => assertFails(setDoc(doc(db('dave'), 'groups/g3'), { name: 'X', createdBy: 'eve', memberUids: ['eve'], currency: 'INR', members: {} })));
  await check('user CANNOT create a group they are not a member of', () => assertFails(setDoc(doc(db('dave'), 'groups/g4'), { name: 'X', createdBy: 'dave', memberUids: ['someone-else'], currency: 'INR', members: {} })));

  // ---- GROUP UPDATE ----
  await check('member (bob) CAN update group (e.g. rename)', () => assertSucceeds(updateDoc(doc(db('bob'), 'groups/g1'), { name: 'Goa Trip 2026' })));
  await check('member CANNOT hijack the createdBy field', () => assertFails(updateDoc(doc(db('bob'), 'groups/g1'), { createdBy: 'bob' })));
  await check('non-member (carol) CANNOT update group', () => assertFails(updateDoc(doc(db('carol'), 'groups/g1'), { name: 'hacked' })));

  // ---- GROUP DELETE ----
  await check('non-creator member (bob) CANNOT delete group', () => assertFails(deleteDoc(doc(db('bob'), 'groups/g1'))));
  await check('creator (alice) CAN delete own group', async () => {
    // use a throwaway group so we don't disturb g1
    await env.withSecurityRulesDisabled(async (c) => setDoc(doc(c.firestore(), 'groups/gdel'), { createdBy: 'alice', memberUids: ['alice'], name: 'tmp', currency: 'INR' }));
    return assertSucceeds(deleteDoc(doc(db('alice'), 'groups/gdel')));
  });

  // ---- USERS PROFILES ----
  await check('signed-in user CAN read another profile', () => assertSucceeds(getDoc(doc(db('carol'), 'users/alice'))));
  await check('user CAN write own profile', () => assertSucceeds(setDoc(doc(db('carol'), 'users/carol'), { name: 'Carol' })));
  await check('user CANNOT write another user profile', () => assertFails(setDoc(doc(db('carol'), 'users/alice'), { name: 'hacked' })));

  // ---- INVITES ----
  await check('member (alice) CAN create invite for own group', () => assertSucceeds(setDoc(doc(db('alice'), 'invites/inv2'), { groupId: 'g1', invitedBy: 'alice', status: 'pending' })));
  await check('non-member (carol) CANNOT create invite for g1', () => assertFails(setDoc(doc(db('carol'), 'invites/inv3'), { groupId: 'g1', invitedBy: 'carol', status: 'pending' })));
  await check('signed-in invitee CAN read an invite', () => assertSucceeds(getDoc(doc(db('carol'), 'invites/inv1'))));

  // ---- LEGACY REGRESSION ----
  await check('legacy: owner CAN read own orbit data', () => assertSucceeds(getDoc(doc(db('alice'), 'orbit/alice/expenses/old1'))));
  await check('legacy: other user CANNOT read someone\'s orbit data', () => assertFails(getDoc(doc(db('bob'), 'orbit/alice/expenses/old1'))));

  await env.cleanup();
  console.log('\n' + results.join('\n'));
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
}
run().catch((e) => { console.error('RUNNER ERROR', e); process.exit(2); });
