/* ============================================================
   ORBIT WEB — Seed data
   Realistic Indian + global expense data for first-run seeding.
   ============================================================ */
(function (global) {
  'use strict';

  const today = new Date('2026-05-29T19:00:00+05:30');
  const D = (offsetDays, hh = 19, mm = 0) => {
    const d = new Date(today);
    d.setDate(d.getDate() - offsetDays);
    d.setHours(hh, mm, 0, 0);
    return d.toISOString();
  };

  // ============ USERS ============
  // Demo data — fake names, example.com emails, non-routable phone numbers.
  // Real signed-in users have this replaced by ensureSelfUserMatchesAuth().
  const users = [
    { id: 'u_self',  name: 'You',          handle: '@you',       email: 'you@example.com',         upi: 'you@upi',              avatar: 'av-c1', isSelf: true,  phone: '+91-99999-00001' },
    { id: 'u_rohan', name: 'Rohan',        handle: '@rohan',     email: 'rohan@example.com',       upi: 'rohan@upi',            avatar: 'av-c3', isSelf: false, phone: '+91-99999-00002' },
    { id: 'u_priya', name: 'Priya',        handle: '@priya',     email: 'priya@example.com',       upi: 'priya@upi',            avatar: 'av-c2', isSelf: false, phone: '+91-99999-00003' },
    { id: 'u_arjun', name: 'Arjun',        handle: '@arjun',     email: 'arjun@example.com',       upi: 'arjun@upi',            avatar: 'av-c5', isSelf: false, phone: '+91-99999-00004' },
    { id: 'u_ananya',name: 'Ananya',       handle: '@ananya',    email: 'ananya@example.com',      upi: 'ananya@upi',           avatar: 'av-c4', isSelf: false, phone: '+91-99999-00005' },
    { id: 'u_kavya', name: 'Kavya',        handle: '@kavya',     email: 'kavya@example.com',       upi: 'kavya@upi',            avatar: 'av-c6', isSelf: false, phone: '+91-99999-00006' },
    { id: 'u_vikram',name: 'Vikram',       handle: '@vikram',    email: 'vikram@example.com',      upi: 'vikram@upi',           avatar: 'av-c8', isSelf: false, phone: '+91-99999-00007' }
  ];

  // ============ GROUPS ============
  const groups = [
    { id: 'g_goa',    name: 'Goa Trip Dec ’26',  category: 'trip',      currency: 'INR', members: ['u_self','u_rohan','u_priya','u_arjun','u_ananya'], createdAt: D(70), emoji: 'GT', banner: 'travel' },
    { id: 'g_flat',   name: 'Flatmates Bandra',       category: 'household', currency: 'INR', members: ['u_self','u_rohan','u_kavya'], createdAt: D(180), emoji: 'FB', banner: 'household' },
    { id: 'g_foodies',name: 'Foodies Mumbai',         category: 'friends',   currency: 'INR', members: ['u_self','u_priya','u_arjun','u_ananya','u_vikram'], createdAt: D(120), emoji: 'FM', banner: 'friends' },
    { id: 'g_sunburn',name: 'Sunburn weekend',        category: 'friends',   currency: 'INR', members: ['u_self','u_rohan','u_arjun','u_kavya'], createdAt: D(55), emoji: 'SB', banner: 'trip' },
    { id: 'g_eu',     name: 'Europe Trip 2026',       category: 'trip',      currency: 'EUR', members: ['u_self','u_priya','u_ananya'], createdAt: D(40), emoji: 'EU', banner: 'travel' },
    { id: 'g_office', name: 'Office Lunch Sept',      category: 'work',      currency: 'INR', members: ['u_self','u_rohan','u_priya','u_vikram','u_kavya'], createdAt: D(240), emoji: 'OL', banner: 'work' }
  ];

  function equalSplit(total, members) {
    const per = Math.round((total / members.length) * 100) / 100;
    const splits = members.map((uid) => ({ userId: uid, amount: per }));
    const sum = splits.reduce((s, x) => s + x.amount, 0);
    splits[splits.length - 1].amount = Math.round((splits[splits.length - 1].amount + (total - sum)) * 100) / 100;
    return splits;
  }
  const grp = (id) => groups.find((g) => g.id === id);

  // ============ EXPENSES ============
  const expenses = [
    // --- Foodies Mumbai ---
    { id: 'e_001', groupId: 'g_foodies', title: 'Bombay Canteen dinner', amount: 4200, currency: 'INR',
      paidBy: 'u_self', splitMode: 'equal',
      splits: equalSplit(4200, grp('g_foodies').members),
      category: 'food', date: D(2, 21, 30), note: 'Five of us, Lower Parel' },

    { id: 'e_002', groupId: 'g_foodies', title: 'Hauz Khas Social drinks', amount: 3200, currency: 'INR',
      paidBy: 'u_priya', splitMode: 'equal',
      splits: equalSplit(3200, ['u_self','u_priya','u_arjun','u_ananya']),
      category: 'fun', date: D(8, 22, 15), note: 'Cocktails at Hauz Khas' },

    { id: 'e_003', groupId: 'g_foodies', title: 'Toit Bangalore', amount: 2940, currency: 'INR',
      paidBy: 'u_arjun', splitMode: 'equal',
      splits: equalSplit(2940, ['u_self','u_arjun','u_vikram']),
      category: 'food', date: D(14, 20, 0), note: 'Brewery weekend' },

    { id: 'e_004', groupId: 'g_foodies', title: 'Britto’s beach dinner', amount: 4020, currency: 'INR',
      paidBy: 'u_ananya', splitMode: 'equal',
      splits: equalSplit(4020, ['u_self','u_priya','u_arjun','u_ananya']),
      category: 'food', date: D(20, 21, 0), note: 'Calangute, Goa' },

    // --- Flatmates Bandra ---
    { id: 'e_005', groupId: 'g_flat', title: 'Bandra apartment rent — May', amount: 75000, currency: 'INR',
      paidBy: 'u_self', splitMode: 'equal',
      splits: equalSplit(75000, grp('g_flat').members),
      category: 'rent', date: D(28, 10, 0), note: '3BHK Pali Hill' },

    { id: 'e_006', groupId: 'g_flat', title: 'Tata Power electricity', amount: 6840, currency: 'INR',
      paidBy: 'u_rohan', splitMode: 'equal',
      splits: equalSplit(6840, grp('g_flat').members),
      category: 'bills', date: D(11, 9, 30), note: 'May bill' },

    { id: 'e_007', groupId: 'g_flat', title: 'JioFiber internet', amount: 1499, currency: 'INR',
      paidBy: 'u_kavya', splitMode: 'equal',
      splits: equalSplit(1499, grp('g_flat').members),
      category: 'bills', date: D(5, 11, 0), note: 'Monthly recurring' },

    { id: 'e_008', groupId: 'g_flat', title: 'Netflix Premium', amount: 797, currency: 'INR',
      paidBy: 'u_self', splitMode: 'equal',
      splits: equalSplit(797, grp('g_flat').members),
      category: 'bills', date: D(24, 9, 0), note: 'Recurring — 5th of every month', recurring: true },

    { id: 'e_009', groupId: 'g_flat', title: 'BigBasket groceries', amount: 3640, currency: 'INR',
      paidBy: 'u_rohan', splitMode: 'equal',
      splits: equalSplit(3640, grp('g_flat').members),
      category: 'shop', date: D(3, 18, 0), note: 'Weekly haul' },

    { id: 'e_010', groupId: 'g_flat', title: 'Maid + cook — May', amount: 12000, currency: 'INR',
      paidBy: 'u_self', splitMode: 'equal',
      splits: equalSplit(12000, grp('g_flat').members),
      category: 'bills', date: D(27, 9, 0), note: 'Shanta + Lata' },

    // --- Goa Trip Dec '26 ---
    { id: 'e_011', groupId: 'g_goa', title: 'IndiGo flights MUM→GOI', amount: 24800, currency: 'INR',
      paidBy: 'u_self', splitMode: 'equal',
      splits: equalSplit(24800, grp('g_goa').members),
      category: 'travel', date: D(35, 14, 0), note: '5 tickets, return' },

    { id: 'e_012', groupId: 'g_goa', title: 'Villa Anjuna — 3 nights', amount: 36000, currency: 'INR',
      paidBy: 'u_rohan', splitMode: 'equal',
      splits: equalSplit(36000, grp('g_goa').members),
      category: 'travel', date: D(32, 12, 0), note: '4BR private villa, North Goa' },

    { id: 'e_013', groupId: 'g_goa', title: 'Scooter rentals (3 days)', amount: 4800, currency: 'INR',
      paidBy: 'u_arjun', splitMode: 'equal',
      splits: equalSplit(4800, grp('g_goa').members),
      category: 'transport', date: D(30, 11, 0), note: '4 Activas' },

    { id: 'e_014', groupId: 'g_goa', title: 'Anjuna beach groceries', amount: 2640, currency: 'INR',
      paidBy: 'u_priya', splitMode: 'equal',
      splits: equalSplit(2640, grp('g_goa').members),
      category: 'shop', date: D(29, 19, 0), note: 'Snacks + drinks for villa' },

    { id: 'e_015', groupId: 'g_goa', title: 'Curlies sunset dinner', amount: 6800, currency: 'INR',
      paidBy: 'u_ananya', splitMode: 'equal',
      splits: equalSplit(6800, grp('g_goa').members),
      category: 'food', date: D(31, 21, 30), note: 'Seafood at Curlies, Anjuna' },

    // --- Sunburn weekend ---
    { id: 'e_016', groupId: 'g_sunburn', title: 'Sunburn passes × 4', amount: 10000, currency: 'INR',
      paidBy: 'u_self', splitMode: 'equal',
      splits: equalSplit(10000, grp('g_sunburn').members),
      category: 'fun', date: D(48, 11, 0), note: '2-day passes' },

    { id: 'e_017', groupId: 'g_sunburn', title: 'Pre-party at Tito’s', amount: 5400, currency: 'INR',
      paidBy: 'u_arjun', splitMode: 'equal',
      splits: equalSplit(5400, grp('g_sunburn').members),
      category: 'fun', date: D(47, 22, 0), note: 'Drinks before main day' },

    { id: 'e_018', groupId: 'g_sunburn', title: 'Cab from venue', amount: 1200, currency: 'INR',
      paidBy: 'u_kavya', splitMode: 'equal',
      splits: equalSplit(1200, grp('g_sunburn').members),
      category: 'transport', date: D(46, 3, 30), note: 'Uber XL surge' },

    // --- Office Lunch Sept ---
    { id: 'e_019', groupId: 'g_office', title: 'Office team lunch — Bombay Brasserie', amount: 8400, currency: 'INR',
      paidBy: 'u_vikram', splitMode: 'equal',
      splits: equalSplit(8400, grp('g_office').members),
      category: 'food', date: D(6, 13, 30), note: 'Friday team lunch' },

    { id: 'e_020', groupId: 'g_office', title: 'Cake for Priya’s birthday', amount: 1600, currency: 'INR',
      paidBy: 'u_self', splitMode: 'equal',
      splits: equalSplit(1600, ['u_self','u_rohan','u_vikram','u_kavya']),
      category: 'fun', date: D(13, 17, 0), note: 'Theobroma red velvet' },

    // --- Europe Trip 2026 (EUR) ---
    { id: 'e_021', groupId: 'g_eu', title: 'Hotel Pestana, Lisbon — 3 nights', amount: 720, currency: 'EUR',
      paidBy: 'u_self', splitMode: 'equal',
      splits: equalSplit(720, grp('g_eu').members),
      category: 'travel', date: D(15, 14, 0), note: 'Lisbon — Bairro Alto' },

    { id: 'e_022', groupId: 'g_eu', title: 'Hostal Grau, Barcelona — 2 nights', amount: 495, currency: 'EUR',
      paidBy: 'u_priya', splitMode: 'equal',
      splits: equalSplit(495, grp('g_eu').members),
      category: 'travel', date: D(12, 14, 0), note: 'Barcelona — El Raval' },

    { id: 'e_023', groupId: 'g_eu', title: 'Lisbon tram 28 tickets', amount: 18, currency: 'EUR',
      paidBy: 'u_ananya', splitMode: 'equal',
      splits: equalSplit(18, grp('g_eu').members),
      category: 'transport', date: D(14, 11, 0), note: '6 single tickets' },

    { id: 'e_024', groupId: 'g_eu', title: 'Tapas at El Xampanyet', amount: 82, currency: 'EUR',
      paidBy: 'u_self', splitMode: 'equal',
      splits: equalSplit(82, grp('g_eu').members),
      category: 'food', date: D(11, 21, 0), note: 'Born district' },

    { id: 'e_025', groupId: 'g_eu', title: 'Sagrada Familia entry', amount: 78, currency: 'EUR',
      paidBy: 'u_priya', splitMode: 'equal',
      splits: equalSplit(78, grp('g_eu').members),
      category: 'fun', date: D(12, 10, 0), note: '3 timed tickets' }
  ];

  // ============ SETTLEMENTS ============
  const settlements = [
    { id: 's_001', groupId: 'g_foodies', fromUser: 'u_rohan', toUser: 'u_self',
      amount: 800, currency: 'INR', method: 'upi', date: D(45, 18, 30), note: 'Previous tab' }
  ];

  const ORBIT_SEED = { users, groups, expenses, settlements, today };
  global.ORBIT_SEED = ORBIT_SEED;

  global.seedIfNeeded = async function seedIfNeeded() {
    const seeded = await OrbitDB.getMeta('seeded', false);
    if (seeded) return false;
    await OrbitDB.putAll('users', ORBIT_SEED.users);
    await OrbitDB.putAll('groups', ORBIT_SEED.groups);
    await OrbitDB.putAll('expenses', ORBIT_SEED.expenses);
    await OrbitDB.putAll('settlements', ORBIT_SEED.settlements);
    await OrbitDB.setMeta('seeded', true);
    await OrbitDB.setMeta('selfUserId', 'u_self');
    await OrbitDB.setMeta('plan', 'free');
    return true;
  };
})(window);
