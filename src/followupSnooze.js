/* followupSnooze.js — per-officer snooze for My Work actions.
   Many My Work items are COMPUTED (no record to attach a flag to), so snoozes are
   keyed by the action's stable key (what|ref) plus the officer code, and stored in
   localStorage. Snoozes are personal, per-device, and transient — not shared business
   data — so localStorage is the right home (no Firestore write, works offline).

   A snoozed action is hidden from the active queues until its snooze date passes,
   then it resurfaces automatically. */
(function () {
  const KEY = 'phoenix_snoozes';

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
    catch (_) { return {}; }
  }
  function save(map) {
    try { localStorage.setItem(KEY, JSON.stringify(map)); } catch (_) {}
  }
  function who() {
    const o = (window.__state && window.__state.officer) || {};
    return o.code || 'anon';
  }
  // Compose the per-officer storage key for an action key.
  function storeKey(actionKey) { return who() + '::' + actionKey; }

  function todayMidnight() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

  // Is this action currently snoozed (snooze date still in the future)?
  function isSnoozed(actionKey) {
    if (!actionKey) return false;
    const map = load();
    const until = map[storeKey(actionKey)];
    if (!until) return false;
    const d = new Date(until);
    if (isNaN(d)) return false;
    if (d > new Date()) return true;
    // expired — clean it up lazily
    delete map[storeKey(actionKey)]; save(map);
    return false;
  }

  // The date an action is snoozed until, or null.
  function snoozedUntil(actionKey) {
    const map = load();
    const until = map[storeKey(actionKey)];
    return until || null;
  }

  // Snooze for N days from today (default 3). Pass an explicit ISO date to set exactly.
  function snooze(actionKey, days, explicitIso) {
    if (!actionKey) return;
    const map = load();
    let iso = explicitIso;
    if (!iso) {
      const d = todayMidnight();
      d.setDate(d.getDate() + (Number(days) || 3));
      d.setHours(23, 59, 59, 999);
      iso = d.toISOString();
    }
    map[storeKey(actionKey)] = iso;
    save(map);
  }

  function clearSnooze(actionKey) {
    if (!actionKey) return;
    const map = load();
    delete map[storeKey(actionKey)];
    save(map);
  }

  // All currently-active snoozes for the current officer: [{ actionKey, until }]
  function activeSnoozes() {
    const map = load();
    const prefix = who() + '::';
    const out = [];
    Object.keys(map).forEach(k => {
      if (k.indexOf(prefix) !== 0) return;
      const until = map[k];
      const d = new Date(until);
      if (!isNaN(d) && d > new Date()) out.push({ actionKey: k.slice(prefix.length), until });
    });
    return out;
  }

  window.PXSnooze = { isSnoozed, snoozedUntil, snooze, clearSnooze, activeSnoozes };
})();
