/* ============================================================
   ORBIT WEB — Personal-finance engine (OrbitFinance)

   Framework-agnostic pure logic ported from the FinEase prototype and
   verified against its 112-case unit suite. Every function takes plain
   data in and returns plain data out — no DOM, no globals — so it's
   unit-testable and reused by the Orbit view layer (app.js).
   ============================================================ */
(function (global) {
  'use strict';

  // ---- Accounts / net worth -------------------------------------------------
  const ACCOUNT_TYPES = [
    { key: 'checking', label: 'Checking', sign: 1 },
    { key: 'savings', label: 'Savings', sign: 1 },
    { key: 'cash', label: 'Cash', sign: 1 },
    { key: 'investment', label: 'Investment', sign: 1 },
    { key: 'credit', label: 'Credit card', sign: -1 },
    { key: 'loan', label: 'Loan', sign: -1 },
    { key: 'other', label: 'Other', sign: 1 }
  ];
  function accountSign(type) {
    const t = ACCOUNT_TYPES.find((x) => x.key === type);
    return t ? t.sign : 1;
  }
  function netWorthByCurrency(accounts) {
    const out = {};
    (accounts || []).forEach((a) => {
      const cur = a.currency || 'INR';
      out[cur] = (out[cur] || 0) + (parseFloat(a.balance) || 0) * accountSign(a.type);
    });
    return out;
  }
  function netWorthTotal(accounts, base) {
    return netWorthByCurrency(accounts)[base || 'INR'] || 0;
  }
  function assetsLiabilities(accounts, base) {
    base = base || 'INR';
    let assets = 0, liabilities = 0;
    (accounts || []).forEach((a) => {
      if ((a.currency || 'INR') !== base) return;
      const bal = parseFloat(a.balance) || 0;
      if (accountSign(a.type) < 0) liabilities += Math.abs(bal);
      else assets += bal;
    });
    return { assets, liabilities, net: assets - liabilities };
  }
  function snapshotNetWorth(history, netWorth, todayISO) {
    const arr = Array.isArray(history) ? history.slice() : [];
    const date = todayISO || new Date().toISOString().slice(0, 10);
    const existing = arr.find((h) => h.date === date);
    if (existing) existing.netWorth = netWorth;
    else arr.push({ date, netWorth });
    arr.sort((a, b) => (a.date < b.date ? -1 : 1));
    return arr.length > 730 ? arr.slice(-730) : arr;
  }

  // Full net worth = accounts + investments − loans + your live Splitwise
  // position (money owed to you is an asset, money you owe is a liability).
  // `data.splitwiseNet` is derived from the existing expense/settlement ledger,
  // so it's never a duplicate entry — it updates the instant a split changes.
  function computeNetWorth(data, base) {
    base = base || 'INR';
    const al = assetsLiabilities(data.accounts || [], base);
    const inv = investmentsTotal(data.investments || [], base);
    const loans = loansOutstandingTotal(data.loans || [], base);
    return al.net + inv - loans + (parseFloat(data.splitwiseNet) || 0);
  }

  // ---- Transactions ---------------------------------------------------------
  const TXN_EXPENSE_CATEGORIES = {
    housing: 'Housing', food: 'Food & Groceries', transport: 'Transportation',
    utilities: 'Utilities', education: 'Education', insurance: 'Insurance',
    subscription: 'Subscriptions', healthcare: 'Healthcare',
    entertainment: 'Entertainment', shopping: 'Shopping', other: 'Other'
  };
  const TXN_INCOME_CATEGORIES = {
    salary: 'Salary', business: 'Business', freelance: 'Freelance',
    investment: 'Investment', rental: 'Rental', gift: 'Gift', refund: 'Refund', other: 'Other'
  };
  function txnCategoryLabel(cat) {
    return TXN_EXPENSE_CATEGORIES[cat] || TXN_INCOME_CATEGORIES[cat] || (cat === 'transfer' ? 'Transfer' : cat);
  }
  const CATEGORY_KEYWORDS = {
    food: ['grocery', 'groceries', 'supermarket', 'walmart', 'restaurant', 'cafe', 'coffee', 'starbucks', 'dinner', 'lunch', 'food', 'zomato', 'swiggy', 'mcdonald', 'pizza', 'bigbasket'],
    transport: ['uber', 'lyft', 'ola', 'fuel', 'petrol', 'diesel', 'gas station', 'metro', 'bus', 'train', 'taxi', 'parking', 'toll', 'rapido'],
    housing: ['rent', 'mortgage', 'maintenance', 'property tax', 'society'],
    utilities: ['electric', 'electricity', 'water bill', 'gas bill', 'internet', 'broadband', 'wifi', 'phone bill', 'mobile recharge', 'airtel', 'jio'],
    subscription: ['netflix', 'spotify', 'prime', 'youtube', 'icloud', 'subscription', 'hbo', 'disney', 'hotstar'],
    healthcare: ['pharmacy', 'doctor', 'hospital', 'clinic', 'medicine', 'medical', 'dental', 'apollo'],
    entertainment: ['movie', 'cinema', 'game', 'concert', 'bar', 'pub', 'bookmyshow', 'pvr'],
    shopping: ['amazon', 'flipkart', 'myntra', 'mall', 'store', 'clothing', 'shoes'],
    insurance: ['insurance', 'premium', 'policy', 'lic'],
    education: ['tuition', 'course', 'school', 'college', 'udemy', 'book', 'coursera'],
    salary: ['salary', 'payroll', 'paycheck', 'wages'],
    business: ['invoice', 'client', 'business'],
    freelance: ['freelance', 'gig', 'consulting', 'upwork'],
    investment: ['dividend', 'interest', 'capital gain', 'mutual fund', 'stock', 'sip'],
    refund: ['refund', 'reimbursement', 'cashback']
  };
  function guessCategory(description, type) {
    const d = (description || '').toLowerCase();
    if (!d) return null;
    const valid = type === 'income' ? TXN_INCOME_CATEGORIES : TXN_EXPENSE_CATEGORIES;
    for (const cat of Object.keys(CATEGORY_KEYWORDS)) {
      if (!valid[cat]) continue;
      if (CATEGORY_KEYWORDS[cat].some((kw) => d.includes(kw))) return cat;
    }
    return null;
  }
  // Income / expense / net for a calendar month. Transfers are excluded.
  function monthlyTransactions(txns, year, month) {
    const inMonth = (txns || []).filter((t) => {
      const dt = new Date(t.date);
      return dt.getFullYear() === year && dt.getMonth() === month;
    });
    const income = inMonth.filter((t) => t.type === 'income').reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
    const expense = inMonth.filter((t) => t.type === 'expense').reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
    return { txns: inMonth, income, expense, net: income - expense };
  }
  function categoryBreakdown(txns, year, month) {
    const map = {};
    (txns || []).filter((t) => {
      const dt = new Date(t.date);
      return t.type === 'expense' && dt.getFullYear() === year && dt.getMonth() === month;
    }).forEach((t) => { map[t.category] = (map[t.category] || 0) + (parseFloat(t.amount) || 0); });
    return Object.keys(map).map((c) => ({ category: c, amount: map[c] })).sort((a, b) => b.amount - a.amount);
  }

  // ---- Budgets --------------------------------------------------------------
  // Actual = this calendar month's expense transactions in the category.
  function actualSpendForCategory(txns, category, now) {
    now = now || new Date();
    return (txns || []).filter((t) => t.type === 'expense' && t.category === category)
      .filter((t) => { const d = new Date(t.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); })
      .reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
  }
  function computeBudgets(budgets, txns, now) {
    return (budgets || []).map((b) => {
      const limit = parseFloat(b.amount) || 0;
      const actual = actualSpendForCategory(txns, b.category, now);
      const pct = limit > 0 ? (actual / limit) * 100 : (actual > 0 ? 100 : 0);
      return { id: b.id, category: b.category, limit, actual, pct, over: actual > limit, remaining: limit - actual };
    });
  }

  // ---- Goals ----------------------------------------------------------------
  function monthsBetween(d1, d2) {
    if (isNaN(d1) || isNaN(d2)) return 0;
    return Math.max(0, (d2.getFullYear() - d1.getFullYear()) * 12 + d2.getMonth() - d1.getMonth());
  }
  function computeGoal(g) {
    const target = parseFloat(g.target) || 0;
    const saved = parseFloat(g.saved) || 0;
    const contribution = parseFloat(g.monthlyContribution) || 0;
    const pct = target > 0 ? Math.min(100, (saved / target) * 100) : 0;
    const remaining = Math.max(0, target - saved);
    let monthsToGoal = null;
    if (remaining <= 0) monthsToGoal = 0;
    else if (contribution > 0) monthsToGoal = Math.ceil(remaining / contribution);
    let requiredMonthly = null;
    if (g.targetDate && remaining > 0) {
      const m = monthsBetween(new Date(), new Date(g.targetDate));
      if (m > 0) requiredMonthly = remaining / m;
    }
    return { target, saved, contribution, pct, remaining, monthsToGoal, requiredMonthly, complete: remaining <= 0 };
  }

  // ---- Loans & debt payoff --------------------------------------------------
  function monthsElapsed(start, asOf) {
    if (!(start instanceof Date) || isNaN(start) || isNaN(asOf)) return 0;
    return Math.max(0, (asOf.getFullYear() - start.getFullYear()) * 12 + (asOf.getMonth() - start.getMonth()));
  }
  // `principal` is the balance at startDate; amortize forward to asOfDate.
  function loanOutstanding(loan, asOfDate) {
    const principal = parseFloat(loan.principal) || 0;
    const emi = parseFloat(loan.emi) || 0;
    const annualRate = parseFloat(loan.interestRate) || 0;
    if (principal <= 0) return 0;
    // No start date → treat the loan as starting "as of now" so its full balance
    // shows (NOT epoch 1970, which would make it look fully paid / ₹0).
    const start = loan.startDate ? new Date(loan.startDate) : (asOfDate ? new Date(asOfDate) : new Date());
    const n = monthsElapsed(start, asOfDate || new Date());
    if (n <= 0) return principal;
    const r = annualRate / 100 / 12;
    const bal = r === 0 ? principal - emi * n : principal * Math.pow(1 + r, n) - emi * (Math.pow(1 + r, n) - 1) / r;
    return Math.max(0, bal);
  }
  function loansOutstandingTotal(loans, base) {
    base = base || 'INR';
    return (loans || []).filter((l) => (l.currency || 'INR') === base)
      .reduce((s, l) => s + loanOutstanding(l, new Date()), 0);
  }
  function simulateDebtPayoff(loans, strategy, extra) {
    const today = new Date();
    let debts = (loans || []).map((l) => ({
      name: l.name, balance: loanOutstanding(l, today),
      rate: (parseFloat(l.interestRate) || 0) / 100 / 12, emi: parseFloat(l.emi) || 0
    })).filter((d) => d.balance > 0 && d.emi > 0);
    if (!debts.length) return { months: 0, totalInterest: 0, order: [], impossible: false, empty: true };
    const order = debts.slice().sort((a, b) => strategy === 'snowball' ? a.balance - b.balance : b.rate - a.rate).map((d) => d.name);
    let months = 0, totalInterest = 0;
    const extraPool = Math.max(0, parseFloat(extra) || 0);
    const MAX = 1200;
    while (debts.some((d) => d.balance > 0.01) && months < MAX) {
      months++;
      debts.forEach((d) => { if (d.balance > 0) { const i = d.balance * d.rate; d.balance += i; totalInterest += i; } });
      let budget = debts.reduce((s, d) => s + (d.balance > 0 ? d.emi : 0), 0) + extraPool;
      for (const name of order) {
        const d = debts.find((x) => x.name === name);
        if (!d || d.balance <= 0) continue;
        const pay = Math.min(budget, d.balance);
        d.balance -= pay; budget -= pay;
        if (budget <= 0) break;
      }
    }
    return { months, totalInterest, order, impossible: debts.some((d) => d.balance > 0.01), empty: false };
  }

  // ---- Investments ----------------------------------------------------------
  function investmentsTotal(investments, base) {
    base = base || 'INR';
    return (investments || []).filter((i) => (i.currency || 'INR') === base)
      .reduce((s, i) => s + (parseFloat(i.currentValue) || 0), 0);
  }

  // ---- Subscriptions --------------------------------------------------------
  const SUB_CYCLE_MONTHS = { weekly: 1 / 4.345, monthly: 1, quarterly: 3, yearly: 12 };
  function subMonthlyCost(s) { return (parseFloat(s.amount) || 0) / (SUB_CYCLE_MONTHS[s.cycle] || 1); }
  function computeSubscriptions(subs) {
    const monthly = (subs || []).reduce((sum, s) => sum + subMonthlyCost(s), 0);
    return { count: (subs || []).length, monthly, yearly: monthly * 12 };
  }

  // ---- Recurring engine -----------------------------------------------------
  function advanceDate(dateStr, frequency) {
    const d = new Date(dateStr);
    if (frequency === 'weekly') d.setDate(d.getDate() + 7);
    else if (frequency === 'biweekly') d.setDate(d.getDate() + 14);
    else if (frequency === 'quarterly') d.setMonth(d.getMonth() + 3);
    else if (frequency === 'yearly') d.setFullYear(d.getFullYear() + 1);
    else d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  }
  // Pure: returns the transactions that should be posted + updated rule copies.
  // The app persists them. Guarded against runaway loops.
  function dueRecurring(rules, todayISO) {
    const today = todayISO ? new Date(todayISO) : new Date();
    today.setHours(23, 59, 59, 999);
    const posts = [];
    const updated = (rules || []).map((r) => Object.assign({}, r));
    updated.forEach((rule) => {
      if (rule.active === false || !rule.nextDate) return;
      let guard = 0;
      while (new Date(rule.nextDate) <= today && guard < 120) {
        posts.push({
          type: rule.type, amount: parseFloat(rule.amount) || 0, date: rule.nextDate,
          category: rule.category, description: rule.description, account: rule.account || null,
          recurring: true, ruleId: rule.id
        });
        rule.lastPosted = rule.nextDate;
        rule.nextDate = advanceDate(rule.nextDate, rule.frequency);
        guard++;
      }
    });
    return { posts, rules: updated };
  }

  // ---- Trends ---------------------------------------------------------------
  function computeTrends(txns, months) {
    const out = [];
    const now = new Date();
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const m = monthlyTransactions(txns, d.getFullYear(), d.getMonth());
      out.push({ label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), income: m.income, expense: m.expense, net: m.net });
    }
    return out;
  }

  // ---- Smart insights -------------------------------------------------------
  // `fmt` is a money formatter (e.g. amt => fmtMoney(amt,'INR')). Returns a
  // prioritized list of { icon, level, text }.
  function generateInsights(data, fmt) {
    fmt = fmt || ((n) => String(Math.round(n)));
    const out = [];
    const now = new Date();
    const txns = data.txns || [];
    const thisM = monthlyTransactions(txns, now.getFullYear(), now.getMonth());
    const lastDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastM = monthlyTransactions(txns, lastDate.getFullYear(), lastDate.getMonth());

    if (lastM.expense > 0 && thisM.expense > 0) {
      const pct = ((thisM.expense - lastM.expense) / lastM.expense) * 100;
      if (Math.abs(pct) >= 5) out.push({ icon: pct > 0 ? '📈' : '📉', level: pct > 0 ? 'warn' : 'good',
        text: `Spending is ${pct > 0 ? 'up' : 'down'} ${Math.abs(pct).toFixed(0)}% vs last month (${fmt(thisM.expense)} vs ${fmt(lastM.expense)}).` });
    }
    const hist = data.nwHistory || [];
    if (hist.length >= 2) {
      const latest = hist[hist.length - 1].netWorth, prior = hist[0].netWorth;
      if (prior !== 0) {
        const pct = ((latest - prior) / Math.abs(prior)) * 100;
        if (Math.abs(pct) >= 1) out.push({ icon: pct >= 0 ? '💎' : '⚠️', level: pct >= 0 ? 'good' : 'bad',
          text: `Net worth is ${pct >= 0 ? 'up' : 'down'} ${Math.abs(pct).toFixed(0)}% over the tracked period (now ${fmt(latest)}).` });
      }
    }
    const over = computeBudgets(data.budgets || [], txns).filter((b) => b.over);
    if (over.length) {
      const worst = over.slice().sort((a, b) => (b.actual - b.limit) - (a.actual - a.limit))[0];
      out.push({ icon: '🚨', level: 'bad', text: `${over.length} budget${over.length > 1 ? 's' : ''} over limit — worst: ${txnCategoryLabel(worst.category)} (${fmt(worst.actual)} of ${fmt(worst.limit)}).` });
    }
    if (thisM.income > 0) {
      const rate = ((thisM.income - thisM.expense) / thisM.income) * 100;
      if (rate >= 20) out.push({ icon: '🌟', level: 'good', text: `Strong ${rate.toFixed(0)}% savings rate this month — keep it up!` });
      else if (rate < 0) out.push({ icon: '🔻', level: 'bad', text: `You're spending more than you earn this month (${rate.toFixed(0)}% savings rate).` });
    }
    const bd = categoryBreakdown(txns, now.getFullYear(), now.getMonth());
    if (bd.length) out.push({ icon: '🏷️', level: 'info', text: `Top spending category this month: ${txnCategoryLabel(bd[0].category)} (${fmt(bd[0].amount)}).` });
    (data.goals || []).forEach((g) => {
      const c = computeGoal(g);
      if (!c.complete && c.monthsToGoal !== null && c.monthsToGoal <= 12)
        out.push({ icon: '🎯', level: 'good', text: `"${g.name}" is ${c.pct.toFixed(0)}% funded — ~${c.monthsToGoal} months to go.` });
    });
    const subs = computeSubscriptions(data.subs || []);
    if (subs.count > 0) out.push({ icon: '🔁', level: 'info', text: `${subs.count} subscriptions costing ${fmt(subs.monthly)}/mo (${fmt(subs.yearly)}/yr).` });
    const debt = simulateDebtPayoff(data.loans || [], 'avalanche', 0);
    if (!debt.empty && !debt.impossible && debt.months > 0)
      out.push({ icon: '⚡', level: 'info', text: `At current EMIs you'll be debt-free in ${Math.floor(debt.months / 12)}y ${debt.months % 12}m.` });

    const order = { bad: 0, warn: 1, good: 2, info: 3 };
    out.sort((a, b) => order[a.level] - order[b.level]);
    return out;
  }

  // ---- Financial vitals: health score, runway, savings rate ----------------
  const LIQUID_TYPES = ['savings', 'checking', 'cash'];
  function liquidCash(accounts, base) {
    base = base || 'INR';
    return (accounts || []).filter((a) => LIQUID_TYPES.includes(a.type) && (a.currency || 'INR') === base)
      .reduce((s, a) => s + (parseFloat(a.balance) || 0), 0);
  }
  function normMonthly(amount, freq) {
    const a = parseFloat(amount) || 0;
    if (freq === 'yearly') return a / 12;
    if (freq === 'quarterly') return a / 3;
    if (freq === 'weekly') return a * 4.345;
    if (freq === 'biweekly') return a * 2.1725;
    return a; // monthly
  }
  function financialMetrics(data, base) {
    base = base || 'INR';
    const cash = liquidCash(data.accounts, base);
    const inv = investmentsTotal(data.investments, base);
    const loansOut = loansOutstandingTotal(data.loans, base);
    const recur = (data.recurring || []).filter((r) => r.active !== false);
    const recurIncome = recur.filter((r) => r.type === 'income').reduce((s, r) => s + normMonthly(r.amount, r.frequency), 0);
    const recurExpense = recur.filter((r) => r.type === 'expense').reduce((s, r) => s + normMonthly(r.amount, r.frequency), 0);
    const subsMonthly = computeSubscriptions(data.subs).monthly;
    const monthlyEMI = (data.loans || []).filter((l) => loanOutstanding(l, new Date()) > 0).reduce((s, l) => s + (parseFloat(l.emi) || 0), 0);
    // Fall back to this month's actual transactions when there are no rules yet.
    const now = new Date();
    const mt = monthlyTransactions(data.txns, now.getFullYear(), now.getMonth());
    const monthlyIncome = recurIncome > 0 ? recurIncome : mt.income;
    const monthlyExpense = (recurExpense + subsMonthly) > 0 ? (recurExpense + subsMonthly) : mt.expense;
    const monthlyBurn = monthlyExpense + monthlyEMI;
    const monthlySurplus = monthlyIncome - monthlyBurn;
    const runway = monthlyBurn > 0 ? cash / monthlyBurn : 999;
    const savingsRate = monthlyIncome > 0 ? (monthlySurplus / monthlyIncome) * 100 : 0;
    const netWorth = computeNetWorth(data, base);
    let health = 0;
    const ef = monthlyBurn > 0 ? cash / (monthlyBurn * 6) : 1;          // 6-month emergency fund
    health += Math.min(ef * 30, 30);
    health += monthlySurplus > 0 ? 25 : 0;                             // positive cash flow
    const dti = monthlyIncome > 0 ? loansOut / (monthlyIncome * 12) : 0;
    health += Math.max(0, 25 - dti * 25);                              // debt ratio
    health += netWorth > 0 ? Math.min((inv / netWorth) * 20, 20) : 0;  // invested ratio
    health = Math.round(Math.max(0, Math.min(100, health)));
    const hasData = (data.accounts || []).length || (data.txns || []).length || (data.loans || []).length;
    if (!hasData) health = 0;
    return { liquidCash: cash, monthlyIncome, monthlyExpense, monthlyEMI, monthlyBurn, monthlySurplus, runway, savingsRate, healthScore: health, netWorth };
  }

  // ---- Cash-flow projection: roll the liquid balance forward N months -------
  function cashflowProjection(data, months, base) {
    base = base || 'INR'; months = months || 12;
    let balance = liquidCash(data.accounts, base);
    const now = new Date();
    const recur = (data.recurring || []).filter((r) => r.active !== false);
    const subsMonthly = computeSubscriptions(data.subs).monthly;
    const out = [];
    for (let i = 0; i < months; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const income = recur.filter((r) => r.type === 'income').reduce((s, r) => s + normMonthly(r.amount, r.frequency), 0);
      const expense = recur.filter((r) => r.type === 'expense').reduce((s, r) => s + normMonthly(r.amount, r.frequency), 0) + subsMonthly;
      const emi = (data.loans || []).filter((l) => loanOutstanding(l, d) > 0).reduce((s, l) => s + (parseFloat(l.emi) || 0), 0);
      const opening = balance;
      balance = balance + income - expense - emi;
      out.push({ label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), opening, income, expense, emi, closing: balance });
    }
    return out;
  }

  // ---- Bill / renewal reminders (next 3 days) -------------------------------
  function remindersDue(data) {
    const now = new Date(), soon = new Date(now.getTime() + 3 * 86400000);
    const items = [];
    (data.subs || []).forEach((s) => { if (s.nextRenewal) { const d = new Date(s.nextRenewal); if (d >= now && d <= soon) items.push({ kind: 'subscription', name: s.name, amount: s.amount, date: s.nextRenewal }); } });
    (data.recurring || []).forEach((r) => { if (r.active !== false && r.nextDate && r.type === 'expense') { const d = new Date(r.nextDate); if (d >= now && d <= soon) items.push({ kind: 'bill', name: r.description, amount: r.amount, date: r.nextDate }); } });
    return items;
  }

  // ---- Natural-language quick-add (local, AI-free fallback) ------------------
  // "paid 1200 for fuel at indian oil" -> {type:expense, amount:1200, category:transport, description:...}
  function parseFinanceText(text) {
    const t = (text || '').trim();
    if (!t) return null;
    const low = t.toLowerCase();
    const m = low.replace(/[,]/g, '').match(/(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(k|lakh|l|cr)?/i);
    if (!m) return null;
    let amount = parseFloat(m[1]);
    const unit = (m[2] || '').toLowerCase();
    if (unit === 'k') amount *= 1000; else if (unit === 'l' || unit === 'lakh') amount *= 100000; else if (unit === 'cr') amount *= 10000000;
    const incomeWords = ['received', 'got', 'salary', 'credited', 'refund', 'earned', 'income', 'cashback', 'bonus', 'dividend', 'paid me', 'sent me'];
    const type = incomeWords.some((w) => low.includes(w)) ? 'income' : 'expense';
    const category = guessCategory(low, type) || (type === 'income' ? 'other' : 'other');
    // description: strip the amount + leading verbs for a cleaner label
    const desc = t.replace(/(?:₹|rs\.?|inr)?\s*\d+(?:\.\d+)?\s*(k|lakh|l|cr)?/i, '').replace(/^\s*(paid|spent|bought|for|on|got|received|earned|add(?:ed)?)\s+/i, '').trim() || (type === 'income' ? 'Income' : 'Expense');
    return { type, amount, category, description: desc.charAt(0).toUpperCase() + desc.slice(1) };
  }

  // ---- CSV export -----------------------------------------------------------
  function csvCell(v) { const s = (v == null) ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function buildFinanceCSV(data) {
    const rows = [['Type', 'Name', 'Amount', 'Category', 'Detail', 'Date']];
    const push = (a) => rows.push(a.map(csvCell));
    (data.accounts || []).forEach((a) => push(['Account', a.name, a.balance, a.type, a.currency || 'INR', '']));
    (data.investments || []).forEach((i) => push(['Investment', i.fundName, i.currentValue, i.category, i.platform || '', '']));
    (data.loans || []).forEach((l) => push(['Loan', l.name, loanOutstanding(l, new Date()), 'outstanding', (l.interestRate || 0) + '%', l.startDate || '']));
    (data.txns || []).forEach((t) => push(['Transaction', t.description, (t.type === 'income' ? '' : '-') + t.amount, t.category, t.type, t.date || '']));
    (data.budgets || []).forEach((b) => push(['Budget', txnCategoryLabel(b.category), b.amount, b.category, 'monthly', '']));
    (data.goals || []).forEach((g) => push(['Goal', g.name, g.target, 'saved:' + (g.saved || 0), '', g.targetDate || '']));
    (data.subs || []).forEach((s) => push(['Subscription', s.name, s.amount, s.category, s.cycle, s.nextRenewal || '']));
    return rows.map((r) => r.join(',')).join('\r\n');
  }

  // ---- Deep transactions: methods, rich filtering, CSV import, payee stats ----
  const PAYMENT_METHODS = { upi: 'UPI', card: 'Card', cash: 'Cash', netbanking: 'Net banking', wallet: 'Wallet', bank: 'Bank transfer', other: 'Other' };
  const METHOD_ICON = { upi: '📱', card: '💳', cash: '💵', netbanking: '🏦', wallet: '👛', bank: '🏛️', other: '•' };

  // Filter a transaction list by any combination of facets. All optional.
  function filterTransactions(txns, f) {
    f = f || {};
    return (txns || []).filter((t) => {
      if (f.type && f.type !== 'all' && t.type !== f.type) return false;
      if (f.category && f.category !== 'all' && t.category !== f.category) return false;
      if (f.account && f.account !== 'all' && t.account !== f.account && t.fromAccount !== f.account && t.toAccount !== f.account) return false;
      if (f.method && f.method !== 'all' && (t.method || '') !== f.method) return false;
      if (f.status && f.status !== 'all' && (t.status || 'cleared') !== f.status) return false;
      if (f.source === 'manual' && t.source === 'split') return false;
      if (f.min !== undefined && f.min !== '' && (parseFloat(t.amount) || 0) < parseFloat(f.min)) return false;
      if (f.max !== undefined && f.max !== '' && (parseFloat(t.amount) || 0) > parseFloat(f.max)) return false;
      if (f.tag) { const tags = (t.tags || []).map((x) => String(x).toLowerCase()); if (!tags.includes(String(f.tag).toLowerCase())) return false; }
      if (f.from && new Date(t.date) < new Date(f.from)) return false;
      if (f.to && new Date(t.date) > new Date(f.to + 'T23:59:59')) return false;
      if (f.q) {
        const q = String(f.q).toLowerCase();
        const hay = [(t.description || ''), (t.payee || ''), (t.notes || ''), (t.tags || []).join(' '), txnCategoryLabel(t.category)].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function splitCsvLine(line) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === ',' && !q) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  }
  // Parse a bank/statement CSV into transaction drafts. Handles a signed Amount
  // column or separate Debit/Credit columns; auto-detects a header row.
  function parseTxnCSV(text) {
    const lines = (text || '').split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return [];
    const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
    const hasHeader = header.some((h) => /date|amount|description|debit|credit|narration|particular/.test(h));
    const find = (re) => header.findIndex((h) => re.test(h));
    const di = hasHeader ? find(/date/) : 0;
    const desci = hasHeader ? find(/desc|narration|particular|detail|payee|name/) : 1;
    const ai = hasHeader ? find(/amount/) : 2;
    const debiti = hasHeader ? find(/debit|withdraw/) : -1;
    const crediti = hasHeader ? find(/credit|deposit/) : -1;
    const out = [];
    for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
      const c = splitCsvLine(lines[i]);
      if (!c.length) continue;
      const rawDate = c[di >= 0 ? di : 0] || '';
      const d = new Date(rawDate);
      const date = isNaN(d) ? null : d.toISOString().slice(0, 10);
      const description = (c[desci >= 0 ? desci : 1] || '').trim() || 'Imported';
      let amount = 0, type = 'expense';
      if (debiti >= 0 || crediti >= 0) {
        const deb = parseFloat((c[debiti] || '').replace(/[^0-9.\-]/g, '')) || 0;
        const cre = parseFloat((c[crediti] || '').replace(/[^0-9.\-]/g, '')) || 0;
        if (cre > 0) { amount = cre; type = 'income'; } else { amount = deb; type = 'expense'; }
      } else {
        const v = parseFloat((c[ai >= 0 ? ai : 2] || '').replace(/[^0-9.\-]/g, '')) || 0;
        amount = Math.abs(v); type = v >= 0 ? 'income' : 'expense';
      }
      if (!amount) continue;
      out.push({ date: date || new Date().toISOString().slice(0, 10), description, amount, type, category: guessCategory(description, type) || 'other' });
    }
    return out;
  }
  // Dedupe drafts against existing txns by date+amount+description.
  function dedupeTxns(drafts, existing) {
    const key = (t) => (t.date || '') + '|' + (parseFloat(t.amount) || 0) + '|' + (t.description || '').toLowerCase().slice(0, 24);
    const seen = new Set((existing || []).map(key));
    return (drafts || []).filter((d) => { const k = key(d); if (seen.has(k)) return false; seen.add(k); return true; });
  }
  // Filter to expense transactions in a period (null period = all time).
  function expensesInPeriod(txns, year, month) {
    return (txns || []).filter((t) => {
      if (t.type !== 'expense') return false;
      if (year != null) { const d = new Date(t.date); if (d.getFullYear() !== year || d.getMonth() !== month) return false; }
      return true;
    });
  }
  // Spending grouped by payee (or description) for a period.
  function payeeBreakdown(txns, year, month) {
    const map = {};
    expensesInPeriod(txns, year, month).forEach((t) => { const k = t.payee || t.description || 'Other'; map[k] = (map[k] || 0) + (parseFloat(t.amount) || 0); });
    return Object.keys(map).map((k) => ({ key: k, label: k, amount: map[k] })).sort((a, b) => b.amount - a.amount);
  }
  // Spending grouped by payment method for a period.
  function methodBreakdown(txns, year, month) {
    const map = {};
    expensesInPeriod(txns, year, month).forEach((t) => { const k = t.method || 'other'; map[k] = (map[k] || 0) + (parseFloat(t.amount) || 0); });
    return Object.keys(map).map((k) => ({ key: k, label: PAYMENT_METHODS[k] || k, icon: METHOD_ICON[k] || '•', amount: map[k] })).sort((a, b) => b.amount - a.amount);
  }
  // Spending grouped by tag (a txn can carry several) for a period.
  function tagBreakdown(txns, year, month) {
    const map = {};
    expensesInPeriod(txns, year, month).forEach((t) => { (t.tags || []).forEach((tag) => { map[tag] = (map[tag] || 0) + (parseFloat(t.amount) || 0); }); });
    return Object.keys(map).map((k) => ({ key: k, label: '#' + k, amount: map[k] })).sort((a, b) => b.amount - a.amount);
  }

  global.OrbitFinance = {
    ACCOUNT_TYPES, accountSign, netWorthByCurrency, netWorthTotal, assetsLiabilities,
    financialMetrics, cashflowProjection, remindersDue, parseFinanceText, buildFinanceCSV, csvCell, normMonthly, liquidCash,
    PAYMENT_METHODS, METHOD_ICON, filterTransactions, parseTxnCSV, dedupeTxns, payeeBreakdown, methodBreakdown, tagBreakdown, expensesInPeriod, splitCsvLine,
    snapshotNetWorth, computeNetWorth,
    TXN_EXPENSE_CATEGORIES, TXN_INCOME_CATEGORIES, txnCategoryLabel, CATEGORY_KEYWORDS,
    guessCategory, monthlyTransactions, categoryBreakdown,
    actualSpendForCategory, computeBudgets,
    computeGoal, monthsBetween,
    loanOutstanding, loansOutstandingTotal, simulateDebtPayoff, monthsElapsed,
    investmentsTotal,
    SUB_CYCLE_MONTHS, subMonthlyCost, computeSubscriptions,
    advanceDate, dueRecurring,
    computeTrends, generateInsights
  };
})(window);
