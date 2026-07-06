/* orders.sortfilter.js — per-column Sort and Filter for the order tables.
   Kept generic and self-contained so every order list (Foreign/Local per stream, plus
   Closed Orders) gets the same behaviour. State lives on the per-view filters object
   (state.filters[viewKey]) as { sortKey, sortDir, colFilters:{key:text} } and persists
   through the existing render cycle. Column values are derived from the order object by
   column key, so no per-column config is needed. */
(function () {
  const S = () => window.__state;

  // Resolve a sortable/filterable value for a given column key from an order.
  function columnValue(o, key) {
    if (!o) return '';
    switch (key) {
      case 'orderId':   return o.orderId || '';
      case 'iprNumber': return o.iprNumber || '';
      case 'claimant':  return o.claimant || '';
      case 'supplier':  return o.supplier || '';
      case 'officer':   return o.officerCode || '';
      case 'amount':    return o.amount != null ? Number(o.amount) : null;
      case 'status':    return o.status || '';
      case 'category':  return o.category || '';
      case 'currency':  return o.currency || '';
      case 'requestedReceiptDate': return dateVal(o.requestedReceiptDate);
      case 'dateOfOrder':          return dateVal(o.dateOfOrder);
      case 'paymentDueDate':       return dateVal(o.paymentDueDate);
      case 'nextSupplierFollowupDate': return dateVal(o.nextSupplierFollowupDate);
      default: {
        // Fall back to a same-named field on the order (covers most columns).
        const v = o[key];
        if (v == null) return '';
        if (v && v.toDate) return v.toDate().getTime();
        return v;
      }
    }
  }
  function dateVal(d) {
    if (!d) return null;
    if (d.toDate) return d.toDate().getTime();
    const t = new Date(d).getTime();
    return isFinite(t) ? t : null;
  }

  // Text used for per-column filtering (always a lowercased string).
  function columnText(o, key) {
    const v = columnValue(o, key);
    if (v == null) return '';
    if (typeof v === 'number') {
      // For date columns, filter against the displayed date string too.
      if (/Date$/.test(key) || key === 'requestedReceiptDate') {
        try { return (window.PXUtils && window.PXUtils.fmtDate ? window.PXUtils.fmtDate(new Date(v)) : new Date(v).toLocaleDateString()).toLowerCase(); } catch (_) {}
      }
      return String(v).toLowerCase();
    }
    return String(v).toLowerCase();
  }

  // Apply per-column text filters to an array of orders.
  function applyColumnFilters(orders, colFilters) {
    if (!colFilters) return orders;
    const active = Object.keys(colFilters).filter(k => (colFilters[k] || '').trim() !== '');
    if (!active.length) return orders;
    return orders.filter(o => active.every(k => columnText(o, k).includes(colFilters[k].trim().toLowerCase())));
  }

  // Apply the active column sort to an array of orders (stable, in place).
  function applyColumnSort(orders, sortKey, sortDir) {
    if (!sortKey || !sortDir) return orders;
    const dir = sortDir === 'desc' ? -1 : 1;
    orders.sort((a, b) => {
      const va = columnValue(a, sortKey), vb = columnValue(b, sortKey);
      // Nulls/blanks always sort last regardless of direction.
      const ea = (va == null || va === ''), eb = (vb == null || vb === '');
      if (ea && eb) return 0;
      if (ea) return 1;
      if (eb) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' }) * dir;
    });
    return orders;
  }

  // Header click → cycle sort for a column: none → asc → desc → none.
  function toggleSort(viewKey, key) {
    const st = S(); if (!st) return;
    const f = st.filters[viewKey] || (st.filters[viewKey] = {});
    if (f.sortKey !== key) { f.sortKey = key; f.sortDir = 'asc'; }
    else if (f.sortDir === 'asc') { f.sortDir = 'desc'; }
    else { f.sortKey = null; f.sortDir = null; }
    reRender(viewKey);
  }

  function setColumnFilter(viewKey, key, value) {
    const st = S(); if (!st) return;
    const f = st.filters[viewKey] || (st.filters[viewKey] = {});
    f.colFilters = f.colFilters || {};
    f.colFilters[key] = value;
    reRender(viewKey, { preserveFocus: key });
  }

  function clearColumnFilters(viewKey) {
    const st = S(); if (!st) return;
    const f = st.filters[viewKey]; if (!f) return;
    f.colFilters = {};
    reRender(viewKey);
  }

  // Toggle the visibility of the filter row for a view.
  function toggleFilterRow(viewKey) {
    const st = S(); if (!st) return;
    const f = st.filters[viewKey] || (st.filters[viewKey] = {});
    f.showColFilters = !f.showColFilters;
    reRender(viewKey);
  }

  function reRender(viewKey, opts) {
    // Re-render the current orders view via the standard renderer, then optionally
    // restore focus to a filter input the user is typing in.
    const st = S();
    if (st && st.view && window.__renderers && window.__renderers[st.view]) {
      window.__renderers[st.view]();
    }
    if (opts && opts.preserveFocus) {
      const el = document.querySelector(`.col-filter-input[data-colkey="${opts.preserveFocus}"]`);
      if (el) { el.focus(); const v = el.value; el.value = ''; el.value = v; }
    }
  }

  // Sort indicator glyph for a header.
  function sortGlyph(viewKey, key) {
    const st = S(); const f = st && st.filters[viewKey];
    if (!f || f.sortKey !== key) return '';
    return f.sortDir === 'asc' ? ' ▲' : ' ▼';
  }

  window.PXOrderSortFilter = {
    columnValue, columnText, applyColumnFilters, applyColumnSort,
    toggleSort, setColumnFilter, clearColumnFilters, toggleFilterRow, sortGlyph
  };
})();
