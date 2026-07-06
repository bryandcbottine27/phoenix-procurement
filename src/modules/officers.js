const { $, $$, escapeHtml, doc, updateDoc, serverTimestamp, toast,
  cmGetColumns, cmRenderTable, cmOpenManager, cmExportCSV, currentRole } = window.PXUtils;
const state = window.__state;
const db = window.__db;

window.__renderers['officers'] = function() {
  const viewEl = $('#view-officers');
  const officers = state.data.officers;
  const isAdmin = currentRole() === 'admin';

  const roleLabel = r => {
    if (r === 'officer') return 'procurement / sc officer';
    if (r === 'procurement') return 'procurement / sc manager';
    if (r === 'logistics') return 'logistics manager';
    if (r === 'accounts') return 'finance';
    return {
      stakeholder: 'internal stakeholder (claimant)',
      procurement_senior_manager: 'senior procurement manager',
      sc_manager: 'supply chain manager',
      sc_supervisor: 'supply chain supervisor',
      sc_officer: 'supply chain officer (specialist)',
      procurement_technical_manager: 'procurement manager (technical & service)',
      procurement_technical_supervisor: 'procurement supervisor (technical & service)',
      procurement_technical_officer: 'procurement officer (technical & service)',
      procurement_indirect_manager: 'procurement manager (indirect)',
      procurement_indirect_supervisor: 'procurement supervisor (indirect)',
      procurement_indirect_officer: 'procurement officer (indirect)',
      procurement_manager: 'procurement / sc manager',
      procurement_supervisor: 'procurement / sc supervisor',
      procurement_officer: 'procurement / sc officer',
      logistics_manager: 'logistics manager',
      logistics_supervisor: 'logistics supervisor',
      logistics_officer: 'logistics officer',
      demand_supervisor: 'demand planning supervisor',
      demand_officer: 'demand planning officer',
      finance: 'finance',
      admin: 'admin'
    }[r] || (r || 'procurement / sc officer');
  };
  const fnLabel = f => f === 'technical' ? 'Technical' : f === 'indirect' ? 'Indirect' : f === 'supplychain' ? 'Supply Chain' : (f || '');
  const offCols = [
    { key: 'code', label: 'Code', render: o => `<span class="mono" style="font-weight:600">${escapeHtml(o.code || '—')}</span>`, raw: o => o.code },
    { key: 'fullName', label: 'Full Name', render: o => escapeHtml(o.fullName || '—'), raw: o => o.fullName },
    { key: 'email', label: 'Email', render: o => `<span class="text-sm">${escapeHtml(o.email || '—')}</span>`, raw: o => o.email },
    { key: 'role', label: 'Role', render: o => `<span class="badge ${o.role==='admin'?'primary':(String(o.role||'').startsWith('logistics')?'accent':((o.role==='accounts'||o.role==='finance'||o.role==='stakeholder')?'neutral':'info'))}">${escapeHtml(roleLabel(o.role))}</span>`, csv: o => roleLabel(o.role) },
    { key: 'function', label: 'Function', render: o => o.function ? `<span class="badge info" style="font-size:10.5px">${escapeHtml(fnLabel(o.function))}</span>` : '<span class="text-xs text-muted">—</span>', csv: o => fnLabel(o.function) },
    { key: 'active', label: 'Active', render: o => o.active !== false ? '<span class="badge success">Active</span>' : '<span class="badge neutral">Inactive</span>', csv: o => o.active !== false ? 'Active' : 'Inactive' },
    { key: '_edit', label: '', render: o => isAdmin ? `<button class="btn btn-sm" onclick="openOfficerForm('${o.id}')">Edit</button>` : '', csv: () => '' }
  ];

  viewEl.innerHTML = `
    <div class="page-head">
      <div class="title"><h1>Officers &amp; Roles</h1><span class="desc">${officers.length} officer(s) — single source of truth for who's who</span></div>
      <div class="page-actions">
        <div class="col-mgr"><button class="btn" id="off-col-btn">⚙ Columns</button></div>
        <button class="btn" id="off-export-btn">⤓ Export Excel</button>
      </div>
    </div>
    <div class="card mb-16" style="background: var(--info-soft); border-color: var(--info-soft)">
      <h3 style="color: var(--info); margin-bottom: 8px">How officers are linked to login accounts</h3>
      <p class="text-sm">Each user should sign in with their own username/password. To onboard someone:</p>
      <ol style="margin: 8px 0 0 20px; font-size: 13px; line-height: 1.7">
        <li>IT creates the user's login account in Firebase Authentication / SSO.</li>
        <li>An admin creates or updates the officer record below with the user's <strong>email</strong> or <strong>Auth UID</strong>.</li>
        <li>The admin sets the correct <strong>role</strong>, <strong>function</strong>, officer code and active status.</li>
      </ol>
      <p class="text-xs text-muted" style="margin-top:8px">No shared departmental login should be used; My Work and audit trails depend on the individual authenticated user.</p>
    </div>
    ${cmRenderTable('officers', offCols, officers, {}, {
      idField: 'id',
      emptyHtml: '<tr><td colspan="99" class="empty-state"><div class="ic">👥</div><h3>No officers yet</h3></td></tr>'
    })}
  `;
  $('#off-col-btn').addEventListener('click', e => cmOpenManager('officers', offCols, e.target, () => window.__renderers['officers']()));
  $('#off-export-btn').addEventListener('click', () => cmExportCSV('officers', offCols, officers, 'officers', {}));
};

window.openOfficerForm = function(officerId) {
  const o = state.data.officers.find(x => x.id === officerId);
  if (!o) { toast('Officer not found', 'danger'); return; }
  const isAdmin = currentRole() === 'admin';
  if (!isAdmin) { toast('Only administrators can edit officer roles.', 'danger'); return; }

  window.openModal(`
    <div class="modal-head">
      <div><h2>Edit Officer</h2><div class="sub">${escapeHtml(o.email || '')}</div></div>
      <button class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <form id="off-form">
        <div class="form-grid">
          <div class="field-group"><label>Code <span class="req">*</span></label>
            <input name="code" value="${escapeHtml(o.code||'')}" required maxlength="3" style="text-transform:uppercase" ${isAdmin?'':'readonly'} />
            <div class="hint">2-letter unique code, e.g. BB</div>
          </div>
          <div class="field-group"><label>Full Name <span class="req">*</span></label><input name="fullName" value="${escapeHtml(o.fullName||'')}" required /></div>
          <div class="field-group"><label>Email / Login</label><input name="email" type="email" value="${escapeHtml(o.email||'')}" placeholder="user@company.com" /></div>
          <div class="field-group"><label>Auth UID</label><input name="authUid" value="${escapeHtml(o.authUid||'')}" placeholder="Firebase/SSO user id" /></div>
          <div class="field-group"><label>Role</label>
            <select name="role" ${isAdmin?'':'disabled'}>
              <option value="procurement_senior_manager" ${o.role==='procurement_senior_manager'?'selected':''}>Senior Procurement Manager</option>
              <option value="sc_manager" ${o.role==='sc_manager'?'selected':''}>Supply Chain Manager</option>
              <option value="sc_supervisor" ${o.role==='sc_supervisor'?'selected':''}>Supply Chain Supervisor</option>
              <option value="sc_officer" ${o.role==='sc_officer'?'selected':''}>Supply Chain Officer (Specialist)</option>
              <option value="procurement_technical_manager" ${o.role==='procurement_technical_manager'||o.role==='procurement_manager'||o.role==='procurement_supervisor'||o.role==='procurement'?'selected':''}>Procurement Manager (Technical &amp; Service)</option>
              <option value="procurement_technical_supervisor" ${o.role==='procurement_technical_supervisor'?'selected':''}>Procurement Supervisor (Technical &amp; Service)</option>
              <option value="procurement_technical_officer" ${o.role==='procurement_technical_officer'||o.role==='procurement_officer'||o.role==='officer'?'selected':''}>Procurement Officer (Technical &amp; Service)</option>
              <option value="procurement_indirect_manager" ${o.role==='procurement_indirect_manager'?'selected':''}>Procurement Manager (Indirect)</option>
              <option value="procurement_indirect_supervisor" ${o.role==='procurement_indirect_supervisor'?'selected':''}>Procurement Supervisor (Indirect)</option>
              <option value="procurement_indirect_officer" ${o.role==='procurement_indirect_officer'?'selected':''}>Procurement Officer (Indirect)</option>
              <option value="logistics_manager" ${o.role==='logistics_manager'||o.role==='logistics'?'selected':''}>Logistics Manager</option>
              <option value="logistics_officer" ${o.role==='logistics_officer'?'selected':''}>Logistics Officer</option>
              <option value="demand_supervisor" ${o.role==='demand_supervisor'?'selected':''}>Demand Planning Supervisor</option>
              <option value="demand_officer" ${o.role==='demand_officer'?'selected':''}>Demand Planning Officer</option>
              <option value="finance" ${o.role==='finance'||o.role==='accounts'?'selected':''}>Finance</option>
              <option value="stakeholder" ${o.role==='stakeholder'?'selected':''}>Internal Stakeholder (Claimant)</option>
              <option value="admin" ${o.role==='admin'?'selected':''}>Admin (IT — full access)</option>
            </select>
          </div>
          <div class="field-group"><label>Procurement Function</label>
            <select name="function" ${isAdmin?'':'disabled'}>
              <option value="">— Any —</option>
              <option value="technical" ${o.function==='technical'?'selected':''}>Procurement Technical</option>
              <option value="indirect" ${o.function==='indirect'?'selected':''}>Procurement Indirect</option>
              <option value="supplychain" ${o.function==='supplychain'?'selected':''}>Supply Chain</option>
            </select>
            <div class="hint">Officer's default function (optional)</div>
          </div>
          <div class="field-group"><label>Status</label>
            <label style="padding-top:8px"><input type="checkbox" name="active" ${o.active !== false?'checked':''} style="width:auto;margin-right:6px" ${isAdmin?'':'disabled'}> Active</label>
          </div>
        </div>
        <div class="section-divider">Delegation <span class="hint" style="text-transform:none;letter-spacing:0;font-weight:400;color:var(--muted-soft);font-size:11px">(Increment 5d — delegate My Work during absence)</span></div>
        <div class="form-grid cols-3">
          <div class="field-group"><label>Delegate My Work to</label>
            <select name="delegateToCode">
              <option value="">— No delegation —</option>
              ${(state.data.officers||[]).filter(x=>x.id!==officerId && x.active!==false).map(x=>`<option value="${escapeHtml(x.code||'')}" ${o.delegateToCode===x.code?'selected':''}>${escapeHtml(x.fullName||x.code)} (${escapeHtml(x.code||'')})</option>`).join('')}
            </select>
          </div>
          <div class="field-group"><label>Delegate Until (inclusive)</label><input type="date" name="delegateUntil" value="${o.delegateUntil||''}" /></div>
          <div class="field-group"><label>Reason <span class="hint" style="text-transform:none;font-weight:400;font-size:10px">e.g. Annual leave</span></label><input type="text" name="delegateReason" value="${escapeHtml(o.delegateReason||'')}" maxlength="100" /></div>
        </div>
      </form>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="save-off">Save</button>
    </div>
  `);
  $('#save-off').addEventListener('click', async () => {
    const fd = new FormData($('#off-form'));
    const data = { code: (fd.get('code')||'').toUpperCase(), fullName: fd.get('fullName'), email: String(fd.get('email') || '').trim().toLowerCase(), authUid: String(fd.get('authUid') || '').trim() || null, role: fd.get('role') || o.role, function: fd.get('function') || null, active: fd.get('active') === 'on',
      delegateToCode: fd.get('delegateToCode') || null,
      delegateUntil: fd.get('delegateUntil') || null,
      delegateReason: fd.get('delegateReason') || null };
    if (!data.code || !data.fullName) { toast('Code and name required', 'danger'); return; }
    try {
      await window.PXStore.updateRecord('officers', officerId, data);
      toast('Officer updated', 'success');
      window.closeModal();
    } catch (err) { toast('Save failed: ' + err.message, 'danger'); }
  });
};
