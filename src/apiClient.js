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
  function applySnapshot(payload) {
    const grouped = (payload && payload.data) || {};
    COLLECTIONS.forEach(collectionName => {
      if (collectionName === 'system_config' || collectionName === 'status_log') return;
      const key = stateKey(collectionName);
      state.data[key] = Array.isArray(grouped[collectionName]) ? grouped[collectionName] : [];
    });

    const configs = Array.isArray(grouped.system_config) ? grouped.system_config : [];
    state.data.systemConfig = configs;
    const importConfig = configs.find(item => item.configKey === 'erp_import_rules') || null;
    const calendarConfig = configs.find(item => item.configKey === 'business_calendars') || null;
    state.importRuleConfigId = importConfig ? importConfig.id : null;
    state.calendarConfigId = calendarConfig ? calendarConfig.id : null;
    state.data.importRules = importConfig && Array.isArray(importConfig.rules) ? importConfig.rules : [];
    state.data.businessCalendars = calendarConfig && Array.isArray(calendarConfig.calendars) ? calendarConfig.calendars : [];

    const statusLog = Array.isArray(grouped.status_log) ? grouped.status_log : [];
    state.data.statusLog = statusLog;
    state.data.importRuns = statusLog.filter(entry => entry.entryType === 'erp_import_run');
  }
  async function loadAll() {
    const payload = await request('/records', { method: 'GET' });
    applySnapshot(payload);
    return payload;
  }
  async function createRecord(collectionName, data) {
    const payload = await request(`/records/${encodeURIComponent(collectionName)}`, {
      method: 'POST',
      body: JSON.stringify({ data })
    });
    await loadAll();
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
    await loadAll();
    return payload.id || id;
  }
  async function archiveRecord(collectionName, id, reason) {
    const payload = await request(`/records/${encodeURIComponent(collectionName)}/${encodeURIComponent(id)}/archive`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason || null })
    });
    await loadAll();
    return payload.id || id;
  }
  async function restoreRecord(collectionName, id) {
    const payload = await request(`/records/${encodeURIComponent(collectionName)}/${encodeURIComponent(id)}/restore`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    await loadAll();
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
    createRecord, updateRecord, archiveRecord, restoreRecord, nextCounter, logStatusChange
  };
})();
