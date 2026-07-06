/* ============================================================
   DOCUMENT SERVICE — SharePoint-ready folder and metadata rules
   ------------------------------------------------------------
   This does not create SharePoint folders yet. It centralises the naming,
   logical path, storage-provider, and document-presence rules so the current
   demo document cabinet can map cleanly to Microsoft Graph later.
   ============================================================ */
(function () {
  const REF = window.REF || {};
  const state = window.__state || { data: {} };

  const FALLBACK_FOLDERS = [
    { key: 'purchase_order', label: 'PO', icon: 'PO' },
    { key: 'shipping_documents', label: 'Shipping Documents', icon: 'SHIP' },
    { key: 'payment_request', label: 'Payment', icon: 'PAY' },
    { key: 'grn', label: 'GRN', icon: 'GRN' }
  ];

  function data() { return state.data || {}; }
  function folders() { return (REF.documentFolders && REF.documentFolders.length) ? REF.documentFolders : FALLBACK_FOLDERS; }
  function folderDef(key) { return folders().find(f => f.key === key) || folders()[0] || FALLBACK_FOLDERS[0]; }
  function folderLabel(key) { return folderDef(key).label || key || 'PO'; }
  function defaultFolderForType(documentType) {
    return (REF.documentTypeFolder && REF.documentTypeFolder[documentType]) || 'purchase_order';
  }
  function normalizeFolderKey(folder, documentType) {
    const suggested = folder || defaultFolderForType(documentType);
    return folders().some(f => f.key === suggested) ? suggested : 'purchase_order';
  }
  function documentLinkOf(doc) { return doc && (doc.documentUrl || doc.url || doc.link || ''); }
  function isPresent(doc) {
    return !!doc && (['received', 'approved'].includes(doc.status) || !!doc.fileData || !!documentLinkOf(doc));
  }
  function storageProviderFor(doc) {
    if (documentLinkOf(doc)) return 'sharepoint-link';
    if (doc && doc.fileData) return 'demo-firestore';
    return 'metadata-only';
  }
  function cleanSegment(value, fallback) {
    let s = String(value || '').trim();
    if (!s) s = fallback || 'Unknown';
    return s
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/\.+$/g, '')
      .trim()
      .slice(0, 120) || (fallback || 'Unknown');
  }
  function findOrderByOrderNo(orderNo, source) {
    return (source.orders || []).find(o => o.orderId === orderNo) || null;
  }
  function findOrderForDoc(doc, source = data()) {
    if (!doc) return null;
    if (doc.relatedType === 'order') return (source.orders || []).find(o => o.id === doc.relatedId) || null;
    if (doc.relatedType === 'shipment') {
      const shipment = (source.shipments || []).find(s => s.id === doc.relatedId) || null;
      return shipment ? findOrderByOrderNo(shipment.orderId, source) : null;
    }
    if (doc.relatedType === 'payment') {
      const payment = (source.payments || []).find(p => p.id === doc.relatedId) || null;
      return payment ? findOrderByOrderNo(payment.orderId, source) : null;
    }
    return null;
  }
  function findShipmentForDoc(doc, source = data()) {
    if (!doc || doc.relatedType !== 'shipment') return null;
    return (source.shipments || []).find(s => s.id === doc.relatedId) || null;
  }
  function findPaymentForDoc(doc, source = data()) {
    if (!doc || doc.relatedType !== 'payment') return null;
    return (source.payments || []).find(p => p.id === doc.relatedId) || null;
  }
  function orderFolderName(order) {
    if (!order) return cleanSegment('Unlinked PO');
    return cleanSegment(`${order.orderId || 'PO'} - ${order.supplier || order.erpVendorName || 'Supplier'}`, 'PO - Supplier');
  }
  function shipmentFolderName(shipment, order) {
    return cleanSegment(
      (shipment && shipment.shipmentId) || (order && order.orderId ? `${order.orderId} (Shipment)` : 'Shipment'),
      'Shipment'
    );
  }
  function folderSegmentsFor(doc, source = data()) {
    const folder = normalizeFolderKey(doc && doc.folder, doc && doc.documentType);
    const order = findOrderForDoc(doc, source);
    if (!order) {
      if (doc && doc.relatedType === 'supplier') return ['Supplier Documents'];
      return ['Unlinked Documents', folderLabel(folder)];
    }
    const segments = [orderFolderName(order)];
    if (folder === 'purchase_order') segments.push('PO');
    else if (folder === 'shipping_documents') {
      segments.push('Shipping Documents');
      const shipment = findShipmentForDoc(doc, source);
      if (shipment) segments.push(shipmentFolderName(shipment, order));
    } else if (folder === 'payment_request') {
      segments.push('Payment');
    } else if (folder === 'grn') {
      segments.push('GRN');
    } else {
      segments.push(folderLabel(folder));
    }
    return segments;
  }
  function folderPathFor(doc, source = data(), separator = ' / ') {
    return folderSegmentsFor(doc, source).join(separator);
  }
  function relatedToOrder(order, doc, source = data()) {
    if (!order || !doc) return false;
    if (doc.relatedType === 'order') return doc.relatedId === order.id;
    if (doc.relatedType === 'shipment') {
      const shipment = (source.shipments || []).find(s => s.id === doc.relatedId);
      return !!shipment && shipment.orderId === order.orderId;
    }
    if (doc.relatedType === 'payment') {
      const payment = (source.payments || []).find(p => p.id === doc.relatedId);
      return !!payment && payment.orderId === order.orderId;
    }
    return false;
  }
  function documentsForOrder(order, source = data(), opts = {}) {
    const showArchived = !!opts.showArchived;
    return (source.documents || [])
      .filter(doc => (showArchived || !doc.archived) && relatedToOrder(order, doc, source))
      .sort((a, b) => (b.addedAt?.seconds || 0) - (a.addedAt?.seconds || 0));
  }
  function buildMetadata(payload, opts = {}) {
    const source = opts.data || data();
    const base = { ...(opts.existing || {}), ...(payload || {}) };
    const folder = normalizeFolderKey(base.folder, base.documentType);
    const enriched = { ...payload, folder };
    const docForPath = { ...base, folder };
    const segments = folderSegmentsFor(docForPath, source);
    enriched.folderLabel = folderLabel(folder);
    enriched.poFolderName = segments[0] || null;
    enriched.documentFolderPath = segments.join(' / ');
    enriched.sharePointFolderPath = segments.join('/');
    enriched.storageProvider = storageProviderFor({ ...docForPath, ...payload });
    return enriched;
  }

  window.PXDocuments = {
    folders, folderDef, folderLabel, defaultFolderForType, normalizeFolderKey,
    documentLinkOf, isPresent, storageProviderFor, cleanSegment,
    findOrderForDoc, findShipmentForDoc, findPaymentForDoc,
    orderFolderName, shipmentFolderName, folderSegmentsFor, folderPathFor,
    relatedToOrder, documentsForOrder, buildMetadata
  };
})();
