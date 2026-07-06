/* ============================================================
   ERP IMPORT RULES -- shared business-rule engine
   ============================================================
   Reference-data rules are deliberately kept outside the importer so a
   supervisor can maintain purchaser/manager mappings without changing code.
   The approved baseline stays in code as a fail-safe until it is stored in
   Firestore; stored rows override the matching baseline rule by ruleKey. */
(function () {
  const state = window.__state;
  const U = value => String(value == null ? '' : value).trim().toUpperCase();
  const blank = '__BLANK__';
  const functionRule = (ruleKey, entity, sourceField, matchValue, resultValue, priority, extra = {}) => ({
    ruleKey, ruleType: 'function', entity, erpSource: entity === 'Phoenix' ? 'Navision' : 'Business Central',
    sourceField, matchValue, resultValue, priority, active: true, ...extra
  });
  const localCurrencyRule = (ruleKey, entity, resultValue) => ({
    ruleKey, ruleType: 'localCurrency', entity, erpSource: 'Business Central',
    sourceField: 'Currency Code', matchValue: blank, resultValue, priority: 10, active: true
  });

  const BASELINE_RULES = [
    functionRule('phx-mgr-bthomas', 'Phoenix', 'Purchasing Mgr ID', 'BTHOMAS', 'technical', 10),
    functionRule('phx-mgr-bbottine', 'Phoenix', 'Purchasing Mgr ID', 'BBOTTINE', 'technical', 10),
    functionRule('phx-mgr-dchristine', 'Phoenix', 'Purchasing Mgr ID', 'DCHRISTINE', 'technical', 10),
    functionRule('phx-mgr-radaken', 'Phoenix', 'Purchasing Mgr ID', 'RADAKEN', 'indirect', 10),
    functionRule('phx-mgr-aa', 'Phoenix', 'Purchasing Mgr ID', 'AA', 'supplychain', 10),
    functionRule('phx-mgr-mcombes', 'Phoenix', 'Purchasing Mgr ID', 'MCOMBES', 'supplychain', 10),
    functionRule('phx-dnarayanen-hod-self', 'Phoenix', 'Purchasing Mgr ID', 'DNARAYANEN', 'supplychain', 10,
      { secondaryField: 'HOD ID', secondaryMatchValue: 'DNARAYANEN' }),
    functionRule('phx-dnarayanen-hod-gmerle', 'Phoenix', 'Purchasing Mgr ID', 'DNARAYANEN', 'technical', 20,
      { secondaryField: 'HOD ID', secondaryMatchValue: 'GMERLE' }),
    functionRule('phx-dnarayanen-fallback', 'Phoenix', 'Purchasing Mgr ID', 'DNARAYANEN', 'technical', 100),

    ...[
      ['BB01', 'technical'], ['BR01', 'supplychain'], ['DC01', 'technical'], ['EJ01', 'technical'],
      ['EL01', 'technical'], ['ET01', 'indirect'], ['HB01', 'technical'], ['MK01', 'supplychain'],
      ['RA01', 'indirect'], ['SH01', 'supplychain'], ['SL01', 'supplychain'], ['SN01', 'supplychain'],
      ['TV01', 'indirect'], ['VS01', 'technical'], ['YA01', 'technical']
    ].map(([code, fn]) => functionRule(`bc-purchaser-${code.toLowerCase()}`, '*', 'Purchaser Code', code, fn, 10,
      { erpSource: 'Business Central', notes: 'Shared Seychelles Breweries and Edena purchaser-code rule.' })),

    ...[
      ['PROCUREMENT TECHNICAL', 'technical'], ['PROCUREMENT INDIRECTS', 'indirect'],
      ['ROBERT ADAKEN', 'indirect'], ['SUPPLYCHAIN', 'supplychain'],
      ['ANOUSHA A BANSROPUN', 'supplychain'], ['DHARMARAJEN GOINDEN GOUNDAN', 'supplychain'],
      ['SYLVIA ARISSOL', 'supplychain']
    ].map(([name, fn]) => functionRule(`bc-createdby-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, '*', 'Created By', name, fn, 100,
      { erpSource: 'Business Central', requiresBlankField: 'Purchaser Code', notes: 'Fallback only when Purchaser Code is blank.' })),

    localCurrencyRule('bc-local-sey-scr', 'Seychelles Breweries', 'SCR'),
    localCurrencyRule('bc-local-edena-eur', 'Edena', 'EUR')
  ];

  const clone = value => JSON.parse(JSON.stringify(value));
  const storedRules = () => Array.isArray(state.data.importRules) ? state.data.importRules : [];
  const isActive = rule => rule && rule.active !== false;

  function effectiveRules() {
    const storedByKey = new Map(storedRules().filter(rule => rule && rule.ruleKey).map(rule => [rule.ruleKey, rule]));
    const baselineKeys = new Set(BASELINE_RULES.map(rule => rule.ruleKey));
    const baseline = BASELINE_RULES.map(rule => ({ ...rule, ...(storedByKey.get(rule.ruleKey) || {}), baseline: true }));
    const custom = storedRules().filter(rule => rule && !baselineKeys.has(rule.ruleKey)).map(rule => ({ ...rule, baseline: false }));
    return [...baseline, ...custom];
  }

  function sortRules(a, b, entity) {
    const priority = Number(a.priority || 100) - Number(b.priority || 100);
    if (priority) return priority;
    const aScope = a.entity === entity ? 0 : 1;
    const bScope = b.entity === entity ? 0 : 1;
    if (aScope !== bScope) return aScope - bScope;
    const aSpecific = a.secondaryField ? 0 : 1;
    const bSpecific = b.secondaryField ? 0 : 1;
    if (aSpecific !== bSpecific) return aSpecific - bSpecific;
    return String(a.ruleKey || '').localeCompare(String(b.ruleKey || ''));
  }

  function matchesValue(expected, actual) {
    return U(expected) === blank ? !U(actual) : U(expected) === U(actual);
  }

  function matchingRule(ruleType, context) {
    const values = context.values || {};
    return effectiveRules()
      .filter(rule => isActive(rule) && rule.ruleType === ruleType)
      .filter(rule => (rule.entity === '*' || rule.entity === context.entity) && rule.erpSource === context.erpSource)
      .filter(rule => !rule.requiresBlankField || !U(values[rule.requiresBlankField]))
      .filter(rule => matchesValue(rule.matchValue, values[rule.sourceField]))
      .filter(rule => !rule.secondaryField || matchesValue(rule.secondaryMatchValue, values[rule.secondaryField]))
      .sort((a, b) => sortRules(a, b, context.entity))[0] || null;
  }

  function resolveFunction(context) {
    const rule = matchingRule('function', context);
    return rule ? rule.resultValue : null;
  }

  function resolveLocalCurrency(context) {
    const rule = matchingRule('localCurrency', context);
    return rule ? rule.resultValue : null;
  }

  function persistedFor(ruleKey) {
    return storedRules().find(rule => rule.ruleKey === ruleKey) || null;
  }

  function cleanRule(input) {
    return {
      ruleKey: String(input.ruleKey || `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      ruleType: input.ruleType === 'localCurrency' ? 'localCurrency' : 'function',
      entity: input.entity || '*',
      erpSource: input.erpSource || 'Business Central',
      sourceField: String(input.sourceField || '').trim(),
      matchValue: String(input.matchValue || '').trim() || blank,
      requiresBlankField: String(input.requiresBlankField || '').trim() || null,
      secondaryField: String(input.secondaryField || '').trim() || null,
      secondaryMatchValue: String(input.secondaryMatchValue || '').trim() || null,
      resultValue: String(input.resultValue || '').trim(),
      priority: Math.max(1, Number(input.priority || 100)),
      active: input.active !== false,
      notes: String(input.notes || '').trim() || null
    };
  }

  function validateRule(rule) {
    const functions = ['technical', 'indirect', 'supplychain'];
    if (!rule.sourceField) return 'ERP field is required.';
    if (rule.ruleType === 'function' && !functions.includes(rule.resultValue)) return 'Function rules must return Technical, Indirect, or Supply Chain.';
    if (rule.ruleType === 'localCurrency' && !/^[A-Z]{3}$/.test(rule.resultValue.toUpperCase())) return 'Local-currency rules must return a 3-letter currency code.';
    if (rule.secondaryField && !rule.secondaryMatchValue) return 'Enter the secondary match value or clear the secondary field.';
    return null;
  }

  async function persistConfiguredRules(rules, action, details) {
    const payload = { configKey: 'erp_import_rules', rules: clone(rules) };
    if (state.importRuleConfigId) {
      await window.PXStore.updateRecord('system_config', state.importRuleConfigId, payload, {
        log: { recordType: 'erp_import_rule', action, details }
      });
      state.data.importRules = payload.rules;
      return state.importRuleConfigId;
    }
    const ref = await window.PXStore.createRecord('system_config', payload, {
      log: { recordType: 'erp_import_rule', action, details }
    });
    state.importRuleConfigId = ref.id;
    state.data.importRules = payload.rules;
    return ref.id;
  }

  async function saveRule(input) {
    const rule = cleanRule(input);
    const error = validateRule(rule);
    if (error) throw new Error(error);
    const existing = persistedFor(rule.ruleKey);
    const detail = `${rule.ruleType} rule: ${rule.entity === '*' ? 'all matching entities' : rule.entity}, ${rule.sourceField}=${rule.matchValue} -> ${rule.resultValue}`;
    const rules = storedRules().filter(item => item.ruleKey !== rule.ruleKey);
    rules.push(rule);
    return persistConfiguredRules(rules, existing ? 'updated' : 'created', detail);
  }

  async function storeApprovedDefaults(opts = {}) {
    const known = new Set(storedRules().map(rule => rule.ruleKey));
    const missing = BASELINE_RULES.filter(rule => !known.has(rule.ruleKey));
    if (!missing.length) return { stored: 0, total: 0 };
    const rules = [...storedRules(), ...missing.map(clone)];
    if (opts.onProgress) opts.onProgress({ stored: missing.length, total: missing.length });
    await persistConfiguredRules(rules, 'initialised', `${missing.length} approved ERP import rules stored.`);
    return { stored: missing.length, total: missing.length };
  }

  window.PXImportRules = {
    blank,
    baselineRules: () => clone(BASELINE_RULES),
    effectiveRules,
    storedRules,
    persistedFor,
    resolveFunction,
    resolveLocalCurrency,
    cleanRule,
    validateRule,
    saveRule,
    storeApprovedDefaults
  };
})();
