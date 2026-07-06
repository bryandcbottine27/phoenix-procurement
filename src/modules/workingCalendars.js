/* ============================================================
   WORKING CALENDARS -- entity holiday reference data
   ============================================================
   One shared system_config document stores holiday dates by entity. The data
   is read by PXUtils.workingDays*; this module only administers that reference
   data and never changes operational records. */
const { $, $$, escapeHtml, toast, currentRole } = window.PXUtils;
const workingCalendarState = window.__state;

function calendarDateKey(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value?.toDate ? value.toDate() : (value ? new Date(value) : null);
  if (!date || isNaN(date)) return '';
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function calendarFor(entity) {
  return (workingCalendarState.data.businessCalendars || []).find(calendar => calendar && calendar.entity === entity) || { entity, holidays: [] };
}
function normalizedHolidays(entries) {
  const used = new Set();
  return (entries || []).reduce((holidays, entry) => {
    const date = calendarDateKey(entry?.date);
    if (!date || used.has(date)) return holidays;
    used.add(date);
    holidays.push({ date, label: String(entry?.label || '').trim() });
    return holidays;
  }, []).sort((a, b) => a.date.localeCompare(b.date));
}
function formatHoliday(date) {
  if (!date) return '-';
  const parsed = new Date(`${date}T00:00:00`);
  return isNaN(parsed) ? date : parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
async function saveEntityCalendar(entity, holidays) {
  const calendars = (workingCalendarState.data.businessCalendars || []).filter(calendar => calendar && calendar.entity !== entity);
  calendars.push({ entity, holidays: normalizedHolidays(holidays) });
  const payload = { configKey: 'business_calendars', calendars };
  if (workingCalendarState.calendarConfigId) {
    await window.PXStore.updateRecord('system_config', workingCalendarState.calendarConfigId, payload, {
      log: { recordType: 'system_config', action: 'updated', details: `Working calendar updated for ${entity}` }
    });
  } else {
    await window.PXStore.createRecord('system_config', payload, {
      log: { recordType: 'system_config', action: 'created', details: 'Working calendar configuration created' }
    });
  }
}
function openWorkingCalendarForm(entity) {
  if (currentRole() !== 'admin') { toast('Only administrators can change working calendars.', 'danger'); return; }
  let draft = normalizedHolidays(calendarFor(entity).holidays || calendarFor(entity).holidayDates || []);
  const renderRows = () => {
    const mount = $('#working-calendar-rows');
    if (!mount) return;
    mount.innerHTML = draft.length ? draft.map((holiday, index) => `
      <div class="form-grid cols-2" style="align-items:end;margin-bottom:8px">
        <div class="field-group"><label>Holiday Date</label><input type="date" data-calendar-date="${index}" value="${escapeHtml(holiday.date)}" /></div>
        <div class="field-group" style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end"><div><label>Label</label><input type="text" data-calendar-label="${index}" value="${escapeHtml(holiday.label)}" placeholder="e.g. Public holiday" /></div><button class="btn btn-sm btn-icon" type="button" data-calendar-remove="${index}" title="Remove holiday">x</button></div>
      </div>`).join('') : '<p class="op-empty">No holiday dates added for this entity.</p>';
    $$('[data-calendar-remove]').forEach(button => button.addEventListener('click', () => {
      draft.splice(Number(button.dataset.calendarRemove), 1); renderRows();
    }));
  };
  const readRows = () => {
    draft = $$('[data-calendar-date]').map(input => ({
      date: input.value,
      label: $(`[data-calendar-label="${input.dataset.calendarDate}"]`)?.value || ''
    }));
  };
  window.openModal(`
    <div class="modal-head"><div><h2>Working Calendar - ${escapeHtml(entity)}</h2><div class="sub">Public and company holiday dates</div></div><button class="btn btn-ghost btn-icon" onclick="closeModal()" title="Close">x</button></div>
    <div class="modal-body">
      <div class="info-banner">Weekends and the dates below are excluded from working-day warning thresholds for ${escapeHtml(entity)}.</div>
      <div id="working-calendar-rows" style="margin-top:14px"></div>
      <button class="btn btn-sm" type="button" id="working-calendar-add" style="margin-top:8px">+ Add Holiday</button>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="working-calendar-save">Save Calendar</button></div>
  `);
  renderRows();
  $('#working-calendar-add').addEventListener('click', () => { readRows(); draft.push({ date: '', label: '' }); renderRows(); });
  $('#working-calendar-save').addEventListener('click', async () => {
    readRows();
    const clean = normalizedHolidays(draft);
    if (clean.length !== draft.filter(entry => entry.date || entry.label).length) { toast('Each holiday needs a unique valid date.', 'danger'); return; }
    const button = $('#working-calendar-save'); button.disabled = true; button.textContent = 'Saving...';
    try {
      await saveEntityCalendar(entity, clean);
      toast(`Working calendar saved for ${entity}.`, 'success'); window.closeModal();
    } catch (error) {
      toast('Could not save working calendar: ' + (error.message || error), 'danger');
      button.disabled = false; button.textContent = 'Save Calendar';
    }
  });
}

window.__renderers['workingcalendars'] = function () {
  const viewEl = $('#view-workingcalendars');
  if (!viewEl) return;
  const isAdmin = currentRole() === 'admin';
  viewEl.innerHTML = `
    <div class="page-head"><div class="title"><h1>Working Calendars</h1><span class="desc">Entity holiday dates used by working-day warnings and escalation controls.</span></div></div>
    <div class="info-banner">Weekends are excluded by default. Add approved public or company holiday dates for each entity before relying on working-day thresholds.</div>
    <div class="px-card-grid" style="margin-top:16px">
      ${window.REF.entities.map(meta => {
        const calendar = calendarFor(meta.code);
        const holidays = normalizedHolidays(calendar.holidays || calendar.holidayDates || []);
        return `<article class="px-card">
          <div class="px-card-top"><div><div class="px-card-title">${escapeHtml(meta.code)}</div><div class="px-card-sub">${holidays.length} holiday date${holidays.length === 1 ? '' : 's'} configured</div></div><span class="entity-badge" style="background:${meta.accent};color:#fff">${escapeHtml(meta.short)}</span></div>
          <div class="text-sm" style="min-height:58px">${holidays.length ? holidays.slice(0, 4).map(holiday => `<div>${escapeHtml(formatHoliday(holiday.date))}${holiday.label ? ` - ${escapeHtml(holiday.label)}` : ''}</div>`).join('') + (holidays.length > 4 ? `<div class="text-muted">+${holidays.length - 4} more</div>` : '') : '<span class="text-muted">No holiday dates yet. Weekends only.</span>'}</div>
          ${isAdmin ? `<div class="px-card-actions"><button class="btn btn-sm" data-edit-calendar="${escapeHtml(meta.code)}">Edit Calendar</button></div>` : '<div class="text-xs text-muted">View only</div>'}
        </article>`;
      }).join('')}
    </div>
  `;
  $$('[data-edit-calendar]', viewEl).forEach(button => button.addEventListener('click', () => openWorkingCalendarForm(button.dataset.editCalendar)));
};
