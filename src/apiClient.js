/* apiClient.js - internal SQL/API data adapter.
   This is inactive unless APP_CONFIG.dataMode === 'api'. It keeps the browser
   contract close to the current Firestore-shaped state arrays while the final
   IT server/auth choices are still pending. */
(function () {
  const state = window.__state;

  const COLLECTION_STATE_KEY = {
    payment_requests: 'payments',
    updateRequests: 'updateRequests',
    contactLog: 'contactLog',
    kpiSnapshot: 'kpiSnapshot'
  };
  const COLLECTIONS = [
    'orders', 'shipments', 'payment_requests', 'exports', 'suppliers', 'officers',
    'documents', 'followups', 'issues', 'updateRequests', 'contactLog',
    'kpiSnapshot', 'status_log', 'system_config'
  ];
  const collectionHeads = {};

  function enabled() {
    return window.__usesApiDataMode && window.__usesApiDataMode();
  }
  function baseUrl() {
    const raw = (window.APP_CONFIG && window.APP_CONFIG.apiBaseUrl) || '/api';
    return String(raw).replace(/\/+$/, '');
  }
  function headers(extra) {
    const out = { ...(extra || {}) };
    const key = window.APP_CONFIG && window.APP_CONFIG.apiFunctionKey;
    if (key) out['x-functions-key'] = key;
    const officer = state && state.officer;
    const actor = (officer && (officer.code || officer.email || officer.fullName)) || '';
    if (actor) out['x-phoenix-user'] = String(actor);
    return out;
  }
  async function request(path, options) {
    if (!enabled()) throw new Error('API data mode is not enabled.');
    const response = await fetch(baseUrl() + path, {
      ...options,
      headers: headers({
        'content-type': 'application/json',
        ...(options && options.headers)
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `API request failed with HTTP ${response.status}.`);
      error.code = payload.code || response.status;
      throw error;
    }
    return payload;
  }
  function stateKey(collectionName) {
    return COLLECTION_STATE_KEY[collectionName] || collectionName;
  }
  function maxUpdatedAt(rows) {
    return (rows || []).reduce((max, row) => {
      const value = row && row.updatedAt ? new Date(row.updatedAt).getTime() : 0;
      return Number.isFinite(value) && value > max ? value : max;
    }, 0);
  }
  function rememberHead(row) {
    if (!row || !row.collectionName) return;
    collectionHeads[row.collectionName] = {
      maxUpdatedAt: row.maxUpdatedAt || null,
      count: Number(row.count || 0)
    };
  }
  function rememberHeads(rows) {
    (Array.isArray(rows) ? rows : []).forEach(rememberHead);
  }
  function applyCollection(collectionName, rows) {
    const data = Array.isArray(rows) ? rows : [];
    if (collectionName === 'system_config') {
      state.data.systemConfig = data;
      const importConfig = data.find(item => item.configKey === 'erp_import_rules') || null;
      const calendarConfig = data.find(item => item.configKey === 'business_calendars') || null;
      state.importRuleConfigId = importConfig ? importConfig.id : null;
      state.calendarConfigId = calendarConfig ? calendarConfig.id : null;
      state.data.importRules = importConfig && Array.isArray(importConfig.rules) ? importConfig.rules : [];
      state.data.businessCalendars = calendarConfig && Array.isArray(calendarConfig.calendars) ? calendarConfig.calendars : [];
    } else if (collectionName === 'status_log') {
      state.data.statusLog = data;
      state.data.importRuns = data.filter(entry => entry.entryType === 'erp_import_run');
    } else {
      state.data[stateKey(collectionName)] = data;
    }
    const latestUpdatedAt = maxUpdatedAt(data);
    collectionHeads[collectionName] = {
      maxUpdatedAt: latestUpdatedAt ? new Date(latestUpdatedAt).toISOString() : null,
      count: data.length
    };
  }
  function applySnapshot(payload) {
    const grouped = (payload && payload.data) || {};
    COLLECTIONS.forEach(collectionName => {
      applyCollection(collectionName, Array.isArray(grouped[collectionName]) ? grouped[collectionName] : []);
    });
  }
  async function loadAll() {
    const payload = await request('/records', { method: 'GET' });
    applySnapshot(payload);
    const heads = await loadHeads();
    rememberHeads(heads);
    return payload;
  }
  async function loadHeads() {
    const payload = await request('/records/heads', { method: 'GET' });
    return Array.isArray(payload.data) ? payload.data : [];
  }
  async function loadCollection(collectionName, options) {
    const params = new URLSearchParams();
    if (options && options.top != null) params.set('top', String(options.top));
    if (options && options.skip != null) params.set('skip', String(options.skip));
    if (options && options.changedSince) params.set('changedSince', String(options.changedSince));
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const payload = await request(`/records/${encodeURIComponent(collectionName)}${suffix}`, { method: 'GET' });
    applyCollection(collectionName, Array.isArray(payload.data) ? payload.data : []);
    return payload;
  }
  async function refreshCollectionAfterWrite(collectionName) {
    await loadCollection(collectionName);
  }
  async function pollChangedCollections() {
    const heads = await loadHeads();
    const changed = [];
    for (const row of heads) {
      const name = row.collectionName;
      const previous = collectionHeads[name] || {};
      const maxChanged = String(previous.maxUpdatedAt || '') !== String(row.maxUpdatedAt || '');
      const countChanged = Number(previous.count || 0) !== Number(row.count || 0);
      if (maxChanged || countChanged) {
        await loadCollection(name);
        rememberHead(row);
        changed.push(name);
      }
    }
    return changed;
  }
  async function createRecord(collectionName, data) {
    const payload = await request(`/records/${encodeURIComponent(collectionName)}`, {
      method: 'POST',
      body: JSON.stringify({ data })
    });
    await refreshCollectionAfterWrite(collectionName);
    return { id: payload.id };
  }
  async function updateRecord(collectionName, id, data, opts) {
    const payload = await request(`/records/${encodeURIComponent(collectionName)}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        data,
        expectedUpdatedAt: opts && opts.expectedUpdatedAt
      })
    });
    await refreshCollectionAfterWrite(collectionName);
    return payload.id || id;
  }
  async function archiveRecord(collectionName, id, reason) {
    const payload = await request(`/records/${encodeURIComponent(collectionName)}/${encodeURIComponent(id)}/archive`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason || null })
    });
    await refreshCollectionAfterWrite(collectionName);
    return payload.id || id;
  }
  async function restoreRecord(collectionName, id) {
    const payload = await request(`/records/${encodeURIComponent(collectionName)}/${encodeURIComponent(id)}/restore`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    await refreshCollectionAfterWrite(collectionName);
    return payload.id || id;
  }
  async function nextCounter(counterKey) {
    const payload = await request(`/counters/${encodeURIComponent(counterKey)}/next`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    return Number(payload.value || 0);
  }
  async function logStatusChange(recordType, recordId, action, details, extraFields) {
    await createRecord('status_log', {
      ...(extraFields || {}),
      entryType: recordType,
      refId: recordId,
      action: action || 'changed',
      entryText: details || ''
    });
  }

  window.PXApiClient = {
    enabled, loadAll, applySnapshot,
    loadCollection, loadHeads, pollChangedCollections,
    createRecord, updateRecord, archiveRecord, restoreRecord, nextCounter, logStatusChange
  };
})();
