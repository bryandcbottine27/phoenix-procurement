/* ============================================================
   ERP IMPORT RULES -- System Settings administration screen
   ============================================================ */
const { $, $$, escapeHtml, toast, currentRole } = window.PXUtils;
const importRuleState = window.__state;

const ruleFunctionLabels = { technical: 'Technical', indirect: 'Indirect', supplychain: 'Supply Chain' };
const ruleEntityLabel = entity => entity === '*' ? 'All matching entities' : entity;
const ruleTypeLabel = type => type === 'localCurrency' ? 'Local currency' : 'Function';
const ruleValueLabel = value => value === window.PXImportRules.blank ? '(blank)' : (value || '-');

function ruleSummary(rule) {
  const source = `${rule.sourceField || 'ERP field'} = ${ruleValueLabel(rule.matchValue)}`;
  const guard = rule.requiresBlankField ? `, only if ${rule.requiresBlankField} is blank` : '';
  const secondary = rule.secondaryField ? `, ${rule.secondaryField} = ${ruleValueLabel(rule.secondaryMatchValue)}` : '';
  return `${source}${secondary}${guard}`;
}

function openImportRuleForm(rule) {
  const isAdmin = currentRole() === 'admin';
  if (!isAdmin) { toast('Only administrators can change ERP import rules.', 'danger'); return; }
  const isNew = !rule;
  const value = rule || {
    ruleType: 'function', entity: '*', erpSource: 'Business Central', sourceField: 'Purchaser Code',
    matchValue: '', requiresBlankField: '', secondaryField: '', secondaryMatchValue: '',
    resultValue: 'technical', priority: 100, active: true, notes: ''
  };
  window.openModal(`
    <div class="modal-head">
      <div><h2>${isNew ? 'New ERP Import Rule' : 'Edit ERP Import Rule'}</h2><div class="sub">Changes apply to the next import preview; existing POs are never altered until an import is committed.</div></div>
      <button class="btn btn-ghost btn-icon" onclick="closeModal()" title="Close">x</button>
    </div>
    <div class="modal-body">
      <form id="erp-rule-form">
        <div class="form-grid cols-3">
          <div class="field-group"><label>Rule Type</label><select name="ruleType"><option value="function" ${value.ruleType === 'function' ? 'selected' : ''}>Function</option><option value="localCurrency" ${value.ruleType === 'localCurrency' ? 'selected' : ''}>Local Currency</option></select></div>
          <div class="field-group"><label>Entity</label><select name="entity"><option value="*" ${value.entity === '*' ? 'selected' : ''}>All matching entities</option><option value="Phoenix" ${value.entity === 'Phoenix' ? 'selected' : ''}>Phoenix</option><option value="Seychelles Breweries" ${value.entity === 'Seychelles Breweries' ? 'selected' : ''}>Seychelles Breweries</option><option value="Edena" ${value.entity === 'Edena' ? 'selected' : ''}>Edena</option></select></div>
          <div class="field-group"><label>ERP Source</label><select name="erpSource"><option value="Navision" ${value.erpSource === 'Navision' ? 'selected' : ''}>Navision</option><option value="Business Central" ${value.erpSource === 'Business Central' ? 'selected' : ''}>Business Central</option></select></div>
          <div class="field-group"><label>Match ERP Field <span class="req">*</span></label><input name="sourceField" value="${escapeHtml(value.sourceField || '')}" required placeholder="e.g. Purchaser Code" /></div>
          <div class="field-group"><label>Match Value</label><input name="matchValue" value="${escapeHtml(value.matchValue === window.PXImportRules.blank ? '' : value.matchValue || '')}" placeholder="Leave blank to match a blank ERP field" /><div class="hint">Blank means the ERP field is blank.</div></div>
          <div class="field-group"><label>Result <span class="req">*</span></label><select name="resultValue"><optgroup label="Function"><option value="technical" ${value.resultValue === 'technical' ? 'selected' : ''}>Technical</option><option value="indirect" ${value.resultValue === 'indirect' ? 'selected' : ''}>Indirect</option><option value="supplychain" ${value.resultValue === 'supplychain' ? 'selected' : ''}>Supply Chain</option></optgroup><optgroup label="Currency"><option value="SCR" ${value.resultValue === 'SCR' ? 'selected' : ''}>SCR</option><option value="EUR" ${value.resultValue === 'EUR' ? 'selected' : ''}>EUR</option><option value="MUR" ${value.resultValue === 'MUR' ? 'selected' : ''}>MUR</option></optgroup></select></div>
          <div class="field-group"><label>Only When This Field Is Blank</label><input name="requiresBlankField" value="${escapeHtml(value.requiresBlankField || '')}" placeholder="e.g. Purchaser Code" /></div>
          <div class="field-group"><label>Secondary ERP Field</label><input name="secondaryField" value="${escapeHtml(value.secondaryField || '')}" placeholder="e.g. HOD ID" /></div>
          <div class="field-group"><label>Secondary Match Value</label><input name="secondaryMatchValue" value="${escapeHtml(value.secondaryMatchValue || '')}" placeholder="e.g. DNARAYANEN" /></div>
          <div class="field-group"><label>Priority</label><input type="number" min="1" name="priority" value="${Number(value.priority || 100)}" /><div class="hint">Lower number wins when more than one rule matches.</div></div>
          <div class="field-group"><label>Active</label><label style="padding-top:8px"><input type="checkbox" name="active" ${value.active !== false ? 'checked' : ''} style="width:auto;margin-right:6px"> Use this rule</label></div>
          <div class="field-group full"><label>Reason / Notes</label><textarea name="notes" placeholder="Why this business rule exists">${escapeHtml(value.notes || '')}</textarea></div>
        </div>
      </form>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="save-erp-rule">${isNew ? 'Create Rule' : 'Save Rule'}</button>
    </div>
  `);
  $('#save-erp-rule').addEventListener('click', async () => {
    const form = $('#erp-rule-form');
    if (!form.reportValidity()) return;
    const fd = new FormData(form);
    const button = $('#save-erp-rule');
    const input = {
      ...value,
      ruleType: fd.get('ruleType'), entity: fd.get('entity'), erpSource: fd.get('erpSource'),
      sourceField: fd.get('sourceField'), matchValue: fd.get('matchValue'),
      requiresBlankField: fd.get('requiresBlankField'), secondaryField: fd.get('secondaryField'),
      secondaryMatchValue: fd.get('secondaryMatchValue'), resultValue: fd.get('resultValue'),
      priority: fd.get('priority'), active: fd.get('active') === 'on', notes: fd.get('notes')
    };
    button.disabled = true; button.textContent = 'Saving...';
    try {
      await window.PXImportRules.saveRule(input);
      toast(`ERP import rule ${isNew ? 'created' : 'saved'}.`, 'success');
      window.closeModal();
    } catch (error) {
      toast('Could not save rule: ' + (error.message || error), 'danger');
      button.disabled = false; button.textContent = isNew ? 'Create Rule' : 'Save Rule';
    }
  });
}

window.__renderers['erpimportrules'] = function() {
  const viewEl = $('#view-erpimportrules');
  const isAdmin = currentRole() === 'admin';
  const filters = importRuleState.filters.erpImportRules || (importRuleState.filters.erpImportRules = { entity: '', source: '', type: '', showInactive: false });
  const configured = window.PXImportRules.storedRules();
  const baselineRules = window.PXImportRules.baselineRules();
  const missingBaselineKeys = baselineRules.filter(rule => !configured.some(stored => stored.ruleKey === rule.ruleKey));
  const effective = window.PXImportRules.effectiveRules();
  const rules = effective.filter(rule => (filters.entity ? rule.entity === filters.entity : true))
    .filter(rule => (filters.source ? rule.erpSource === filters.source : true))
    .filter(rule => (filters.type ? rule.ruleType === filters.type : true))
    .filter(rule => filters.showInactive || rule.active !== false);
  const storedKeys = new Set(configured.map(rule => rule.ruleKey));

  viewEl.innerHTML = `
    <div class="page-head">
      <div class="title"><h1>ERP Import Rules</h1><span class="desc">${rules.length} active rule${rules.length === 1 ? '' : 's'} used by the PO import preview</span></div>
      <div class="page-actions">
        ${isAdmin && missingBaselineKeys.length ? '<button class="btn" id="erp-rules-store-defaults">Store Approved Defaults</button>' : ''}
        ${isAdmin ? '<button class="btn btn-primary" id="erp-rules-new">+ New Rule</button>' : ''}
      </div>
    </div>
    <div class="card mb-16" style="background:var(--info-soft);border-color:var(--info-soft)">
      <h3 style="color:var(--info);margin-bottom:6px">Controlled import classification</h3>
      <p class="text-sm">Rules are evaluated in priority order. The approved baseline remains active until a stored rule replaces it, so imports cannot become unclassified while this reference data is being set up. Changes apply to future import previews only.</p>
    </div>
    <div class="toolbar" style="flex-wrap:wrap">
      <select id="erp-rule-entity"><option value="">All entities</option><option value="Phoenix" ${filters.entity === 'Phoenix' ? 'selected' : ''}>Phoenix</option><option value="Seychelles Breweries" ${filters.entity === 'Seychelles Breweries' ? 'selected' : ''}>Seychelles Breweries</option><option value="Edena" ${filters.entity === 'Edena' ? 'selected' : ''}>Edena</option><option value="*" ${filters.entity === '*' ? 'selected' : ''}>All matching entities</option></select>
      <select id="erp-rule-source"><option value="">All ERP sources</option><option value="Navision" ${filters.source === 'Navision' ? 'selected' : ''}>Navision</option><option value="Business Central" ${filters.source === 'Business Central' ? 'selected' : ''}>Business Central</option></select>
      <select id="erp-rule-type"><option value="">All rule types</option><option value="function" ${filters.type === 'function' ? 'selected' : ''}>Function</option><option value="localCurrency" ${filters.type === 'localCurrency' ? 'selected' : ''}>Local currency</option></select>
      <label class="text-sm" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="erp-rule-inactive" ${filters.showInactive ? 'checked' : ''} style="width:auto"> Include inactive</label>
      <div class="filter-count">${rules.length}</div>
    </div>
    <div class="px-card-grid">
      ${rules.map(rule => `
        <article class="px-card" style="cursor:default">
          <div class="px-card-top"><div><div class="px-card-title">${escapeHtml(ruleTypeLabel(rule.ruleType))} Rule</div><div class="px-card-sub">${escapeHtml(ruleEntityLabel(rule.entity))} - ${escapeHtml(rule.erpSource)}</div></div><span class="badge ${rule.active !== false ? 'success' : 'neutral'}">${rule.active !== false ? 'active' : 'inactive'}</span></div>
          <div class="text-sm"><strong>When:</strong> ${escapeHtml(ruleSummary(rule))}</div>
          <div class="text-sm"><strong>Then:</strong> ${escapeHtml(rule.ruleType === 'function' ? (ruleFunctionLabels[rule.resultValue] || rule.resultValue) : `${rule.resultValue} local`)}</div>
          <div class="text-xs text-muted">Priority ${Number(rule.priority || 100)} - ${storedKeys.has(rule.ruleKey) ? 'stored reference data' : 'approved baseline'}</div>
          ${rule.notes ? `<div class="text-xs text-muted">${escapeHtml(rule.notes)}</div>` : ''}
          ${isAdmin ? `<div style="margin-top:auto"><button class="btn btn-sm" data-erp-rule="${escapeHtml(rule.ruleKey)}">Edit</button></div>` : ''}
        </article>`).join('') || '<div class="empty-state"><h3>No rules match these filters</h3></div>'}
    </div>
  `;
  const rerender = () => window.__renderers['erpimportrules']();
  $('#erp-rule-entity').addEventListener('change', e => { filters.entity = e.target.value; rerender(); });
  $('#erp-rule-source').addEventListener('change', e => { filters.source = e.target.value; rerender(); });
  $('#erp-rule-type').addEventListener('change', e => { filters.type = e.target.value; rerender(); });
  $('#erp-rule-inactive').addEventListener('change', e => { filters.showInactive = e.target.checked; rerender(); });
  const newButton = $('#erp-rules-new'); if (newButton) newButton.addEventListener('click', () => openImportRuleForm(null));
  const storeDefaults = $('#erp-rules-store-defaults');
  if (storeDefaults) storeDefaults.addEventListener('click', async () => {
    storeDefaults.disabled = true; storeDefaults.textContent = 'Storing...';
    try {
      const result = await window.PXImportRules.storeApprovedDefaults({ onProgress: ({ stored, total }) => { storeDefaults.textContent = `Storing ${stored}/${total}...`; } });
      toast(result.stored ? `${result.stored} approved rules stored.` : 'Approved rules are already stored.', 'success');
    } catch (error) {
      toast('Could not store defaults: ' + (error.message || error), 'danger');
      storeDefaults.disabled = false; storeDefaults.textContent = 'Store Approved Defaults';
    }
  });
  $$('[data-erp-rule]').forEach(button => button.addEventListener('click', () => {
    openImportRuleForm(effective.find(rule => rule.ruleKey === button.dataset.erpRule) || null);
  }));
};
