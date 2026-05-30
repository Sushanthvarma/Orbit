/* ============================================================
   ORBIT WEB — Live FX rates (frankfurter.app, free, no key)

   API: https://api.frankfurter.app/latest?from=EUR&to=INR,USD,GBP
        https://api.frankfurter.app/2026-05-01?from=EUR&to=INR

   Rates are cached in meta store keyed by ISO date (YYYY-MM-DD) so we
   refetch at most once per day per base currency.

   Public API:
     await OrbitFX.rate(amount, fromCur, toCur, dateISO?)
       → { converted, rate, from, to, date, cached }
     await OrbitFX.refresh(['INR','USD','EUR','GBP'])     // prefetch
     OrbitFX.format(converted, currency)                  // pretty string

   Falls back to a baked-in approximation table if the network call fails,
   so the UI never breaks. The "stale" flag tells the caller it's a fallback.
   ============================================================ */
(function (global) {
  'use strict';

  const ENDPOINT = 'https://api.frankfurter.app';
  const SUPPORTED = ['INR', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'JPY', 'SGD', 'AED'];
  // Frankfurter ECB feed only supports these as `from`. INR / AED are
  // ECB target-only — for those we fetch EUR and rebase client-side.
  const LIVE_BASES = ['EUR', 'USD', 'GBP', 'AUD', 'CAD', 'JPY', 'SGD'];

  // Rough fallback rates pinned to mid-2026 — only used if network fails.
  // Base = EUR. (One EUR equals this many of target.)
  const FALLBACK_EUR = {
    EUR: 1.00, USD: 1.08, INR: 94.50, GBP: 0.86, AUD: 1.64,
    CAD: 1.48, JPY: 167.0, SGD: 1.46, AED: 3.97
  };

  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function metaKey(base, date) { return 'fx_' + base + '_' + date; }

  async function fetchLive(base, date) {
    const path = (date && date !== todayISO()) ? '/' + date : '/latest';
    // If frankfurter doesn't support this base directly (INR, AED), fetch
    // EUR rates and rebase to the requested base.
    const useBase = LIVE_BASES.includes(base) ? base : 'EUR';
    const targets = SUPPORTED.filter((c) => c !== useBase).join(',');
    const url = ENDPOINT + path + '?from=' + encodeURIComponent(useBase) + '&to=' + targets;
    const res = await fetch(url);
    if (!res.ok) throw new Error('FX HTTP ' + res.status);
    const body = await res.json();
    if (!body.rates) throw new Error('No rates in response');
    body.rates[useBase] = 1;

    if (useBase !== base) {
      const baseRate = body.rates[base];
      if (!baseRate) throw new Error('Base ' + base + ' not in response');
      const rebased = {};
      Object.keys(body.rates).forEach((c) => { rebased[c] = Math.round((body.rates[c] / baseRate) * 10000) / 10000; });
      rebased[base] = 1;
      body.rates = rebased;
      body.base = base;
    }
    return body;
  }

  async function getRates(base, date) {
    base = (base || 'EUR').toUpperCase();
    date = date || todayISO();
    if (!SUPPORTED.includes(base)) return null;

    if (global.OrbitDB) {
      const cached = await OrbitDB.getMeta(metaKey(base, date), null);
      if (cached && cached.rates) return { ...cached, cached: true };
    }
    try {
      const live = await fetchLive(base, date);
      if (global.OrbitDB) await OrbitDB.setMeta(metaKey(base, date), live);
      return { ...live, cached: false };
    } catch (e) {
      console.warn('FX fetch failed, using fallback', e);
      // Derive rates from EUR fallback
      const fb = {};
      const baseRateFromEur = FALLBACK_EUR[base];
      if (!baseRateFromEur) return null;
      SUPPORTED.forEach((c) => {
        if (FALLBACK_EUR[c]) fb[c] = Math.round((FALLBACK_EUR[c] / baseRateFromEur) * 10000) / 10000;
      });
      return { rates: fb, base, date, cached: false, stale: true };
    }
  }

  async function rate(amount, fromCur, toCur, dateISO) {
    fromCur = (fromCur || 'INR').toUpperCase();
    toCur = (toCur || fromCur).toUpperCase();
    if (fromCur === toCur) return { converted: amount, rate: 1, from: fromCur, to: toCur, date: dateISO || todayISO(), cached: true };
    const r = await getRates(fromCur, dateISO);
    if (!r || !r.rates[toCur]) return { converted: amount, rate: 1, from: fromCur, to: toCur, date: dateISO || todayISO(), cached: true, error: 'no-rate' };
    const conv = Math.round(amount * r.rates[toCur] * 100) / 100;
    return { converted: conv, rate: r.rates[toCur], from: fromCur, to: toCur, date: r.date, cached: !!r.cached, stale: !!r.stale };
  }

  async function refresh(currencies) {
    const list = currencies && currencies.length ? currencies : ['INR', 'USD', 'EUR', 'GBP'];
    for (const c of list) await getRates(c, todayISO());
  }

  function format(amount, currency) {
    const sym = ({ INR: '₹', USD: '$', EUR: '€', GBP: '£', AUD: 'A$', CAD: 'C$', JPY: '¥', SGD: 'S$', AED: 'د.إ' })[currency] || '';
    const abs = Math.abs(amount);
    const str = abs.toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US', {
      maximumFractionDigits: 2, minimumFractionDigits: abs % 1 === 0 ? 0 : 2
    });
    return (amount < 0 ? '−' : '') + sym + str;
  }

  global.OrbitFX = { rate, refresh, getRates, format, SUPPORTED };
})(window);
