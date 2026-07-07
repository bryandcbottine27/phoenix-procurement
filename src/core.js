import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import { getAuth, signInAnonymously, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import {
  getFirestore, collection, doc, addDoc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy, limit, serverTimestamp, runTransaction
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

/* ============================================================
   APP CONFIG — the ONE place IT edits for deployment.
   ============================================================
   For production:
     1. Replace `firebase` below with YOUR Firebase project's config.
     2. Set `demoMode: false` and `authMode: 'password'` — this disables all no-login
        demo aids and requires each user to sign in with their own credential.
     3. Apply the Firestore security rules and (if used) Azure AD login per the
        Go-Live runbook (docs/GO_LIVE_RUNBOOK.md). The app code does not need to
        change for either auth path — only this block and the server config.
   When demoMode is true the app behaves as the no-login prototype/demo build. */
const APP_CONFIG = {
  demoMode: true,   // PRODUCTION: set to false
  authMode: 'demo', // 'demo' = anonymous test profile; 'password' = individual username/password
  loginEmailDomain: '', // optional: if set, "bbottine" becomes "bbottine@your-domain"
  bcStructure: true, // Business Central top-nav layout. Set false for the classic sidebar.
  bcCardPage: true, // Open order detail as a full-page BC card instead of a modal. Set false to revert to modal.
  firebase: {
    apiKey: "AIzaSyAg_Dndu81cRwKnw-0Qi86MXpzPk9CnoLM",
    authDomain: "phoenix-procurement2.firebaseapp.com",
    projectId: "phoenix-procurement2",
    storageBucket: "phoenix-procurement2.firebasestorage.app",
    messagingSenderId: "623891363073",
    appId: "1:623891363073:web:29292ec220aad92ecc1700"
  }
};
window.APP_CONFIG = APP_CONFIG;
function isDemoMode() { return !!(window.APP_CONFIG && window.APP_CONFIG.demoMode); }
window.__isDemoMode = isDemoMode;
function usesPasswordAuth() {
  return (window.APP_CONFIG && window.APP_CONFIG.authMode === 'password') || !isDemoMode();
}
function normaliseLoginEmail(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (value.includes('@')) return value;
  const domain = String((window.APP_CONFIG && window.APP_CONFIG.loginEmailDomain) || '').trim().replace(/^@+/, '');
  return domain ? `${value}@${domain}` : value;
}

/* ============================================================
   FIREBASE CONFIG
   ============================================================ */
const firebaseConfig = APP_CONFIG.firebase;

// Initialize Firebase
const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

/* ============================================================
   Write-failure safety net. Individual save paths show their own toast, but a
   global handler guarantees that a failed Firestore write is never fully silent:
   it surfaces a toast and stamps a "last sync failed" indicator officers can see.
   This matters on flaky connections (Mauritius / Seychelles).
   ============================================================ */
function flagWriteError(context, err) {
  try {
    const msg = (err && err.message) || 'Unknown error';
    if (window.PXUtils && window.PXUtils.toast) {
      window.PXUtils.toast(`Save may not have completed${context ? ' (' + context + ')' : ''}. Check your connection and try again.`, 'danger');
    }
    const el = document.getElementById('sync-status');
    if (el) {
      el.textContent = '⚠ Last save failed';
      el.className = 'sync-status sync-failed';
      el.title = `${context || 'write'}: ${msg}`;
    }
    console.error('Write error', context, err);
  } catch (_) { /* never throw from the error handler */ }
}
function flagWriteOk() {
  const el = document.getElementById('sync-status');
  if (el && el.classList.contains('sync-failed')) {
    el.textContent = '✓ Synced';
    el.className = 'sync-status sync-ok';
    el.title = '';
  }
}
window.__flagWriteError = flagWriteError;
window.__flagWriteOk = flagWriteOk;
window.addEventListener('unhandledrejection', e => {
  const r = e && e.reason;
  // Only surface things that look like write/permission/network failures; ignore
  // benign rejections (e.g. user-cancelled flows) and our own STALE_WRITE (handled inline).
  const msg = (r && (r.code || r.message || '')) + '';
  if (r && r.code === 'STALE_WRITE') return;
  if (/permission|network|unavailable|deadline|FIRESTORE|write|quota/i.test(msg)) {
    flagWriteError('background sync', r);
  }
});

/* ============================================================
   REFERENCE DATA (mirrors the LOGISTICS_DASHBOARD DATA sheet)
   These are the dropdown vocabularies your team already uses.
   ============================================================ */
const REF = {
  /* === DEMO RESET SAFEGUARD ===
     The permanent "Clear all data" purge is a DEMO-ONLY tool for resetting an
     isolated demo Firestore. It is hidden unless this flag is true AND the current
     officer is admin, and it requires a successful "Backup All" first.
     MUST be left false (or the purge code removed) before any shared pilot/production use. */
  demoResetEnabled: false,

  categories: [
    "RM - Ingredients", "Primary Packaging", "Secondary Packaging", "Finished Products",
    "Finished Products Alc.", "Spare parts", "Spare parts - FS", "Spare parts - GL",
    "Refrigeration - Item", "Refrigeration - GL", "Marketing", "Laboratory Consumables",
    "Laboratory Equipment", "Capex", "Consumables", "IT Spares", "IT Equipment",
    "Technical Services", "HR", "Finance"
  ],

  /* === Procurement Functions ===
     Each function owns a subset of categories. Every category belongs
     to exactly one function. */
  functions: {
    technical:   { label: "Procurement Technical", short: "Technical" },
    indirect:    { label: "Procurement Indirect",  short: "Indirect"  },
    supplychain: { label: "Supply Chain",          short: "Supply Chain" }
  },
  categoryToFunction: {
    "Spare parts":               "technical",
    "Spare parts - FS":          "technical",
    "Spare parts - GL":          "technical",
    "Capex":                     "technical",
    "Technical Services":        "technical",
    "Refrigeration - Item":      "technical",
    "Refrigeration - GL":        "technical",
    "Laboratory Consumables":    "technical",
    "Laboratory Equipment":      "technical",
    "Consumables":               "technical",
    "IT Spares":                 "technical",
    "IT Equipment":              "technical",
    "Marketing":                 "indirect",
    "HR":                        "indirect",
    "Finance":                   "indirect",
    "RM - Ingredients":          "supplychain",
    "Primary Packaging":         "supplychain",
    "Secondary Packaging":       "supplychain",
    "Finished Products":         "supplychain",
    "Finished Products Alc.":    "supplychain"
  },
  shippingTerms: ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU/DDU", "DDP", "DAT"],
  conveyance: ["Express Courier", "Air Freight", "Sea Freight - LCL", "Sea Freight - FCL"],
  packing: ["Carton", "Pallet", "Wooden Case", "Package", "TEU - 20FT", "FEU - 40FT", "TEU - 20FT Reefer", "FEU - 40FT Reefer", "Flat Rack - 20FT", "Flat Rack - 40FT", "Part of TEU - 20FT", "Part of FEU - 40FT"],
  orderFollowupStatuses: [
    "Order sent to supplier",
    "Awaiting supplier acknowledgement",
    "Supplier acknowledged",
    "Technical / commercial clarification",
    "Awaiting revised confirmation",
    "Order amendment pending",
    "Quantity / price variance under review",
    "Advance payment required",
    "Advance payment requested",
    "Advance payment completed",
    "Under production / preparation",
    "Awaiting supplier ready date",
    "Ready date confirmed",
    "Supplier delay / revised ready date",
    "Partially ready for collection / dispatch",
    "Fully ready for collection / dispatch",
    "Pending payment before collection / shipment",
    "Pending supplier shipping documents",
    "Collection / shipment requested",
    "Logistics request acknowledged",
    "Partially handed over to logistics",
    "Fully handed over to logistics",
    "Partially collected / dispatched",
    "Fully collected / dispatched",
    "Partially received / GRN pending",
    "Fully received / GRN pending",
    "Fully received / GRN completed",
    "Closure pending payment / document / issue",
    "Order closed",
    "Order on hold",
    "Order cancelled"
  ],
  shipmentFollowupStatuses: [
    "Shipment request received",
    "Collection to be arranged",
    "Supplier contacted for collection",
    "Ready confirmation pending",
    "Shipping documents requested",
    "Shipping documents received",
    "Forwarder / carrier quotation requested",
    "Booking in progress",
    "Booking confirmed",
    "Collection date requested",
    "Collection date confirmed",
    "Ready for pickup",
    "Collected from supplier",
    "Pending export clearance / origin documents",
    "Awaiting departure",
    "Departed origin",
    "In transit",
    "ETA revised / delayed",
    "Arrived at destination / port",
    "Documents sent to broker",
    "Clearance preparation started",
    "Under customs clearance",
    "Clearance query / issue logged",
    "Cleared by customs",
    "Released for delivery",
    "Delivery arranged",
    "Delivered to warehouse",
    "GRN pending",
    "GRN completed",
    "Shipment closed",
    "Shipment on hold",
    "Shipment cancelled"
  ],
  shipmentCoverageOptions: [
    "Full order",
    "Partial order",
    "Balance shipment",
    "Replacement shipment"
  ],
  partialShipmentReasons: [
    "Supplier partial readiness",
    "Split transport",
    "Short shipped",
    "Missing after GRN",
    "Backorder / balance shipment",
    "Replacement shipment",
    "Commercial decision",
    "Other"
  ],
  shipmentReceiptResults: [
    "Not received yet",
    "Fully received",
    "Partially received",
    "Short received",
    "Missing goods",
    "Damaged goods",
    "Over received"
  ],
  grnStatuses: [
    "pending",
    "partially received",
    "fully received",
    "cancelled"
  ],
  shipmentFollowupActions: [
    "No action",
    "Create next shipment",
    "Raise issue",
    "Close balance",
    "Await supplier confirmation",
    "Await GRN / store confirmation"
  ],
  // Legacy shared order/shipment vocabulary from before the lifecycle split.
  // Retained ONLY so old records that still carry these values remain readable and
  // render with a status badge. Do NOT use for new forms, filters, or mappings —
  // the canonical lists are orderFollowupStatuses / shipmentFollowupStatuses.
  // `statuses` (below) is an alias to the canonical order list for any caller that
  // reads REF.statuses expecting "the current list".
  legacyStatuses: [
    "Order sent", "Technical Clarifications", "Confirmation of Order received",
    "Under production", "Awaiting order ready date", "Ready to Ship",
    "Payment prior production", "Payment prior shipment", "Loading process",
    "In transit", "Under Clearance", "Cleared - Under Receipt",
    "Cleared and Received", "Cleared and Received - Installation in progress", "Order closed"
  ],
  paymentTerms: [
    "100% Advance payment", "50% Advance: 50% before Shipment", "50% Advance: 50% 30 days after Shipment",
    "50% Advance: 50% 60 days from invoice Date", "30% Advance: 50% before shipment: 10% after erection: 10% after commissioning",
    "50% Advance: 40% before Shipment; 10% before commissioning", "50% Advance: 50% from BL date",
    "30% Advance; 70% before shipment", "30% Advance; 70% 30 days after shipment", "14 days Net",
    "21 days from BL date", "30 days from Invoice date", "30 days from BL date", "30 days end of month",
    "40 days from Invoice", "45 days from Invoice Date", "45 days from BL", "45 days end of month",
    "60 days from Invoice Date", "60 days from BL date", "60 days end of month",
    "90 days from Invoice date", "90 days from BL Date", "7 days before arrival of shipment",
    "50% Advance; 50% 45 days BL date", "25% Advance; 75% before loading", "50% Advance; 50% Against BL",
    "60% Advance; 40% 30 days after commissioning", "92% Advance; 8% after delivery", "On receipt of documents"
  ],
  currencies: ["USD", "EUR", "GBP", "ZAR", "AUD", "CHF", "MUR", "SCR"],
  locations: [
    "PBL Main Store", "Brewery Laboratory", "Limo Store", "Limo Laboratory",
    "Still Nouvelle France", "Forest Side - Refrigeration", "Forest Side - Marketing",
    "Solitude", "Phoenix Wear", "Garage Store", "TCU Warehouse", "MGG Store",
    "Sonia Wear", "Tara", "Aquarelle", "Seychelles", "Madagascar"
  ],
  rfpStatuses: ["draft", "forthcoming", "submitted", "approved", "paid", "rejected"],
  milestoneStatuses: ["planned", "due-soon", "rfp-raised", "paid", "overdue"],

  /* Shipment lifecycle stages — separation of duties */
  /* Packaging / container units for shipment quantity (logistics).
     A shipment can carry multiple quantity lines, e.g. 2 Wooden Crate(s) + 1 Carton(s). */
  /* ============================================================
     ACTION PRIORITY THRESHOLDS (My Work — easy to tune)
     ============================================================
     All values in days. Change these to retune the Action Required queue. */
  /* ============================================================
     ERP FIELD-OWNERSHIP MAP  (Navision now → Business Central later)
     ============================================================
     This is the specification the future ERP/Data Warehouse sync service MUST honour.
     The app never talks to Navision/BC directly — the ERP data is extracted
     into a warehouse/staging layer, normalised to this app's field names, and
     written into Firestore by a controlled sync/API service.
     Read-only for v1 (we only READ from the ERP, never write back).

     Three ownership groups for an ORDER:
       erpLocked   = ERP is the boss. Auto-filled, read-only in this app,
                     safe for the sync to refresh on every run.
       erpFillOnce = ERP fills it as a starting value, BUT the user may
                     override. Once a user overrides (tracked in
                     order.userOverrides[]), the sync must NOT refill it.
       appOwned    = ERP never touches it. This app is the sole boss.
  ============================================================ */
  erpOwnership: {
    erpLocked: ['orderId', 'supplier', 'currency', 'amount', 'dateOfOrder', 'iprApprovedDate', 'iprNumber', 'description'],
    erpFillOnce: ['paymentTerms', 'category'],
    appOwned: ['status', 'notes', 'milestones', 'orderAcknowledgedDate', 'orderReadyDate',
               'requestedReceiptDate', 'dateRequestedByDept', 'forthcomingPaymentDate',
               'paymentDueDate', 'claimant', 'isClosed', 'function',
               'supplierPromisedDate', 'supplierRevisedPromisedDate', 'supplierPromiseRevisionCount',
               'supplierDelayReason', 'lastSupplierFollowupDate', 'nextSupplierFollowupDate',
               'followupMethod', 'followupFrequencyDays', 'supplierReplySummary',
               'orderCriticality', 'escalationOwner', 'escalationDate', 'escalationLevel']
    // NOTE: all shipment, payment_request, and comment data is app-owned by
    // definition (those collections have no ERP counterpart in this design).
  },

  /* ============================================================
     ERP SOURCES, SYNC STATUS, BADGES  (Navision now → BC later)
     ============================================================
     Phoenix is an OPERATIONAL CONTROL LAYER on top of the ERP, NOT a 2nd ERP.
       • ERP owns: vendor, PO, amount, currency, terms, receipt, invoice, payment.
       • Phoenix owns: follow-up, logistics, comments, exceptions, documents,
         dashboards, action queues.
  ============================================================ */
  erpSources: ['Manual', 'Navision', 'Business Central'],

  // ERP / Data Warehouse metadata fields every order can carry (filled by import or future sync)
  erpMetaFields: ['erpSource', 'erpCompany', 'erpVendorNo', 'erpOrderNo', 'erpOrderLineNo',
                  'erpItemNo', 'erpSystemId', 'erpLastSyncedAt', 'erpSyncStatus', 'erpSyncError',
                  'integrationLayer', 'warehouseSource', 'warehouseRecordId', 'warehouseBatchId',
                  'warehouseExtractedAt', 'warehouseLoadedAt', 'warehouseHash'],

  warehouseIntegration: {
    recommendedPath: 'ERP -> Data Warehouse/Staging -> Sync/API service -> Phoenix',
    directErpAccessAllowed: false,
    browserWarehouseAccessAllowed: false,
    currentFeed: 'manual Excel import'
  },

  // Visual badge styling per sync status / source
  erpBadges: {
    Manual:              { label: 'Manual',               cls: 'neutral', icon: '✎' },
    Navision:            { label: 'Synced · Navision',    cls: 'info',    icon: '⛓' },
    'Business Central':  { label: 'Synced · BC',          cls: 'info',    icon: '⛓' },
    pending:             { label: 'Sync pending',         cls: 'accent',  icon: '⟳' },
    error:              { label: 'Sync error',           cls: 'danger',  icon: '⚠' },
    stale:               { label: 'Stale data',           cls: 'warn',    icon: '◷' }
  },

  /* Status mapping layer — ERP accounting statuses ≠ Phoenix operational statuses.
     Kept separate on purpose; this maps ERP → a suggested Phoenix operational status.
     The plug-in can use this as a default; users can always override (Phoenix-owned). */
  erpStatusMap: {
    /* ERP PO status → Phoenix operational status (a SUGGESTED starting point only;
       officers own and advance the real status). Targets are valid
       orderFollowupStatuses values placed at the earliest honest lifecycle point —
       an ERP snapshot proves a PO was issued, not that the supplier has progressed it. */
    po: {
      'Pending Approval': 'Order amendment pending',   // not yet released to supplier
      'Open':        'Order sent to supplier',          // live PO issued (Navision)
      'Released':    'Order sent to supplier',          // PO released/issued (Business Central)
      'Closed':      'Order closed',                    // terminal
      'Cancelled':   'Order cancelled'                  // terminal
    },
    receipt: {   // ERP receipt status → Phoenix logistics status (suggested)
      'Not Received':     'Fully handed over to logistics',
      'Partially Received':'Partially received / GRN pending',
      'Fully Received':   'Fully received / GRN completed'
    },
    invoice: {   // ERP invoice/payment status → Phoenix payment status (suggested)
      'Not Invoiced':  'draft',
      'Invoiced':      'submitted',
      'Partially Paid':'submitted',
      'Paid':          'paid'
    }
  },

  actionThresholds: {
    dueSoonDays: 7,          // payment/milestone within this many days = "Due soon" (orange)
    upcomingDays: 30,        // within this many days = "Upcoming" (yellow)
    noAckDays: 7,            // order older than this with no supplier acknowledgement
    arrivedNoGrnGraceDays: 0,// ETA passed by this many days and still no GRN = action
    readyNoShipmentDays: 2,  // order ready more than this many working days ago but no shipment requested
    requestedNotAssignedDays: 0 // shipment requested this many days ago, still unassigned
  },
  // Fallback lead time (days from order date) used ONLY to estimate a milestone's
  // forecast date when no real anchor data exists yet. Flagged as an estimate.
  forecastDefaultLeadDays: 60,

  /* ---- Phoenix-owned operational reference data ---- */
  documentTypes: [
    'Purchase Order', 'Quotation', 'Supplier Confirmation', 'Proforma Invoice',
    'Commercial Invoice', 'Packing List', 'Bill of Lading (BL)', 'Air Waybill (AWB)',
    'Certificate of Analysis (COA)', 'Health Certificate', 'Phytosanitary Certificate',
    'Certificate of Origin', 'Insurance Certificate', 'Bill of Entry', 'GRN',
    'Payment Proof', 'Other'
  ],
  documentStatuses: ['missing', 'requested', 'received', 'approved', 'rejected'],

  // SharePoint upload is not active in the demo. These settings define the
  // intended target architecture so the app can generate stable folder paths now
  // and plug in Microsoft Graph later without changing operational screens.
  documentStorage: {
    mode: 'sharepoint-ready',
    currentProvider: 'manual-link-or-demo-upload',
    futureProvider: 'sharepoint-graph',
    sharePointSite: 'TBD',
    documentLibrary: 'Phoenix Procurement Documents'
  },

  /* Per-PO document folders. Each order has these logical folders; uploaded files are filed
     into one of them. PXDocuments turns these into SharePoint-ready paths:
     PO - Supplier / PO | Shipping Documents / Shipment | Payment | GRN.
     Default-assigned by document type when not chosen explicitly. */
  documentFolders: [
    { key: 'purchase_order',     label: 'PO',                 icon: '📄' },
    { key: 'shipping_documents', label: 'Shipping Documents',  icon: '🚢' },
    { key: 'payment_request',    label: 'Payment',             icon: '💰' },
    { key: 'grn',                label: 'GRN',                 icon: '✓' }
  ],
  // Suggested folder for a given document type (used as the default when adding)
  documentTypeFolder: {
    'Purchase Order': 'purchase_order', 'Quotation': 'purchase_order',
    'Supplier Confirmation': 'purchase_order', 'Proforma Invoice': 'purchase_order',
    'Certificate of Origin': 'purchase_order',
    'Commercial Invoice': 'shipping_documents', 'Packing List': 'shipping_documents',
    'Bill of Lading (BL)': 'shipping_documents', 'Air Waybill (AWB)': 'shipping_documents',
    'Certificate of Analysis (COA)': 'shipping_documents', 'Health Certificate': 'shipping_documents',
    'Phytosanitary Certificate': 'shipping_documents', 'Insurance Certificate': 'shipping_documents',
    'Bill of Entry': 'shipping_documents', 'GRN': 'grn',
    'Payment Proof': 'payment_request'
  },

  /* Expected (commonly-required) document templates by context.
     Shown as a checklist so users see which expected docs are still missing,
     even before any document record exists. Phoenix-owned. */
  /* Expected documents — configurable. `base` lists always apply for a context;
     `rules` add documents conditionally based on the record (order type, shipment
     mode, function, etc.). Resolved by PXUtils.expectedDocsFor(context, record).
     This avoids false "missing document" alerts (e.g. asking for a BL on an air
     shipment, or import docs on a local order). */
  expectedDocuments: {
    order:    ['Purchase Order', 'Quotation', 'Supplier Confirmation', 'Proforma Invoice'],
    shipment: ['Commercial Invoice', 'Packing List', 'Bill of Lading (BL)', 'Certificate of Analysis (COA)',
               'Health Certificate', 'Insurance Certificate', 'Bill of Entry', 'GRN'],
    payment:  ['Commercial Invoice', 'Payment Proof'],
    supplier: ['Other']
  },

  // Conditional expected-document rules (additive on top of the base lists above).
  // Each rule: { when:{...}, docs:[...] }. `when` keys are matched against the record.
  expectedDocumentRules: {
    order: [
      { when: { orderType: 'foreign' }, docs: ['Commercial Invoice', 'Certificate of Origin'] },
      { when: { orderType: 'local' },   docs: [] },
      { when: { function: 'technical' }, docs: ['Technical Datasheet'] }
    ],
    shipment: [
      { when: { mode: 'sea' }, docs: ['Bill of Lading (BL)'] },
      { when: { mode: 'air' }, docs: ['Air Waybill (AWB)'] },
      { when: { mode: 'road' }, docs: ['CMR / Road Consignment Note'] },
      { when: { foreign: true }, docs: ['Bill of Entry', 'Customs Declaration'] }
    ]
  },
  shipmentModes: ['sea', 'air', 'road', 'courier'],
  incoterms: ['EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DDP'],
  defaultExpiryAlertDays: 30,
  followupStatuses: ['open', 'done', 'cancelled'],
  issueTypes: ['delay', 'missing document', 'customs query', 'damage', 'shortage', 'wrong item', 'supplier issue', 'other'],
  issueStatuses: ['open', 'resolved'],
  issueCategories: ['supplier delay', 'supplier quality', 'documentation', 'customs / clearance',
    'transport / logistics', 'damage in transit', 'short / over delivery', 'wrong item',
    'price / invoice discrepancy', 'internal process', 'ERP / data', 'other'],
  issueSeverities: ['low', 'medium', 'high', 'critical'],
  issueImpactTypes: ['cost', 'time', 'quantity', 'compliance', 'quality'],
  issueResponsibleParties: ['supplier', 'freight forwarder', 'customs', 'internal', 'ERP / data'],
  issueResolutionCodes: ['resolved with supplier', 'resolved internally', 'credit / refund',
    'replaced', 'waived', 'no action needed', 'other'],
  escalationLevels: [{ v: 0, l: '0 — None' }, { v: 1, l: '1 — Supervisor' }, { v: 2, l: '2 — Manager' }, { v: 3, l: '3 — Head' }],

  /* Planned-vs-actual performance timeline (Feature 6). Ordered milestones; `src`
     tells PXTimeline where the ACTUAL comes from:
       order:<field>          → the order's own field
       ship:<field>:min|max   → across the order's shipments (earliest/latest)
       pay:<field>:min|max    → across the order's payment requests
       manual                 → stored in order.actualDates (no canonical field)
     An entry in order.actualDates[key] always overrides the derived value.
     Planned dates live in order.plannedDates[key]. */
  timelineMilestones: [
    { key: 'po_created',        label: 'PO created',              src: 'order:dateOfOrder' },
    { key: 'po_sent',           label: 'PO sent to supplier',     src: 'order:orderSentToSupplierDate' },
    { key: 'supplier_ack',      label: 'Supplier acknowledgement', src: 'order:orderAcknowledgedDate' },
    { key: 'goods_ready',       label: 'Goods ready',             src: 'order:orderReadyDate' },
    { key: 'booking',           label: 'Booking',                 src: 'ship:bookingDate:min' },
    { key: 'departure',         label: 'Departure / shipment',    src: 'manual' },
    { key: 'eta',               label: 'ETA',                     src: 'ship:eta:min' },
    { key: 'arrival',           label: 'Actual arrival',          src: 'manual' },
    { key: 'grn',               label: 'GRN / receipt',           src: 'ship:grnDate:max' },
    { key: 'invoice_received',  label: 'Invoice received',        src: 'ship:invoiceToAccountsDate:max' },
    { key: 'payment_requested', label: 'Payment requested',       src: 'pay:requestDate:min' },
    { key: 'payment_made',      label: 'Payment made',            src: 'pay:paidDate:max' }
  ],
  supplierRatings: ['preferred', 'normal', 'watchlist', 'blocked'],

  // App/prototype version stamp (shown in backup metadata)
  prototypeVersion: 'prototype-2026.06-stage1',

  /* ============================================================
     ENTITIES (centralised procurement — Phoenix + group companies)
     ============================================================
     Same officers/suppliers across all; entity tags orders/shipments/payments.
     erpSource is independent (e.g. Phoenix→Navision, Seychelles→Business Central). */
  entities: [
    { code: 'Phoenix',              short: 'PHX', accent: '#FD5C25', rfpPrefix: 'PHX' },
    { code: 'Seychelles Breweries', short: 'SEY', accent: '#1C6E8C', rfpPrefix: 'SEY' },
    { code: 'Edena',                short: 'EDN', accent: '#0F6E56', rfpPrefix: 'EDN' }
  ],
  defaultEntity: 'Phoenix',

  /* ============================================================
     ROLE PERMISSIONS MATRIX  (single source of truth for access)
     ============================================================
     Resources × actions a role may perform. 'admin' is full access.
     Legacy role 'officer' is treated as 'procurement'.
     Enforced in the UI now (hide/disable buttons + read-only forms);
     the SAME matrix will later drive Firestore security rules once the
     app moves from no-login to real authentication.
     Actions: view, create, edit, archive.
  ============================================================ */
  permissions: {
    // === Generated from the approved ACCESS GRID (do not hand-edit; regenerate from the grid) ===
    admin: '*',  // full access to everything
    procurement_senior_manager: {   // Senior Procurement Manager — oversight: full reports, view-only operations
      orders:         ['view'],
      shipments:      ['view'],
      exports:        ['view'],
      payments:       ['view','approve'],
      milestones:     ['view','create','edit','archive'],
      suppliers:      ['view','create','edit','archive'],
      documents:      ['view'],
      followups:      ['view','create','edit','archive'],
      issues:         ['view','create','edit','archive'],
      updateRequests: ['view','create','edit','archive'],
      officers:       ['view'],
      reports:        ['view'],
      erprecon:       ['view','create','edit','archive'],
      logisticsCost: []
    },
    sc_manager: {   // Supply Chain Manager
      orders:         ['view','create','edit','archive'],
      shipments:      ['view','create','edit','archive'],
      exports:        ['view'],
      payments:       ['view','approve'],
      milestones:     ['view','create','edit','archive'],
      suppliers:      ['view','create','edit','archive'],
      documents:      ['view'],
      followups:      ['view','create','edit','archive'],
      issues:         ['view','create','edit','archive'],
      updateRequests: ['view','create','edit','archive'],
      officers:       ['view'],
      reports:        ['view'],
      erprecon:       ['view','create','edit','archive'],
      logisticsCost: []
    },
    sc_officer: {   // Supply Chain Officer (Specialist)
      orders:         ['view','create','edit'],
      shipments:      ['view'],
      exports:        ['view'],
      payments:       ['view','create','edit'],
      milestones:     ['view','create','edit'],
      suppliers:      ['view','create','edit'],
      documents:      ['view','create','edit'],
      followups:      ['view','create','edit'],
      issues:         ['view','create','edit'],
      updateRequests: ['view','create','edit'],
      officers:       [],
      reports:        ['view'],
      erprecon:       [],
      logisticsCost: []
    },
    procurement_technical_manager: {   // Procurement Manager/Supervisor (Technical & Service)
      orders:         ['view','create','edit','archive'],
      shipments:      ['view','create','edit','archive'],
      exports:        ['view'],
      payments:       ['view','approve'],
      milestones:     ['view','create','edit','archive'],
      suppliers:      ['view','create','edit','archive'],
      documents:      ['view'],
      followups:      ['view','create','edit','archive'],
      issues:         ['view','create','edit','archive'],
      updateRequests: ['view','create','edit','archive'],
      officers:       ['view'],
      reports:        ['view'],
      erprecon:       ['view','create','edit','archive'],
      logisticsCost: []
    },
    procurement_technical_officer: {   // Procurement Officer (Technical & Service)
      orders:         ['view','create','edit'],
      shipments:      ['view'],
      exports:        ['view'],
      payments:       ['view','create','edit'],
      milestones:     ['view','create','edit'],
      suppliers:      ['view','create','edit'],
      documents:      ['view','create','edit'],
      followups:      ['view','create','edit'],
      issues:         ['view','create','edit'],
      updateRequests: ['view','create','edit'],
      officers:       [],
      reports:        ['view'],
      erprecon:       [],
      logisticsCost: []
    },
    procurement_indirect_manager: {   // Procurement Manager/Supervisor (Indirect)
      orders:         ['view','create','edit','archive'],
      shipments:      ['view','create','edit','archive'],
      exports:        ['view'],
      payments:       ['view','approve'],
      milestones:     ['view','create','edit','archive'],
      suppliers:      ['view','create','edit','archive'],
      documents:      ['view'],
      followups:      ['view','create','edit','archive'],
      issues:         ['view','create','edit','archive'],
      updateRequests: ['view','create','edit','archive'],
      officers:       ['view'],
      reports:        ['view'],
      erprecon:       ['view','create','edit','archive'],
      logisticsCost: []
    },
    procurement_indirect_officer: {   // Procurement Officer (Indirect)
      orders:         ['view','create','edit'],
      shipments:      ['view'],
      exports:        ['view'],
      payments:       ['view','create','edit'],
      milestones:     ['view','create','edit'],
      suppliers:      ['view','create','edit'],
      documents:      ['view','create','edit'],
      followups:      ['view','create','edit'],
      issues:         ['view','create','edit'],
      updateRequests: ['view','create','edit'],
      officers:       [],
      reports:        ['view'],
      erprecon:       [],
      logisticsCost: []
    },
    procurement_technical_supervisor: {   // Procurement Supervisor (Technical & Service) — officer baseline (extras added separately)
      orders:         ['view','create','edit'],
      shipments:      ['view'],
      exports:        ['view'],
      payments:       ['view','create','edit','approve'],
      milestones:     ['view','create','edit'],
      suppliers:      ['view','create','edit'],
      documents:      ['view','create','edit'],
      followups:      ['view','create','edit'],
      issues:         ['view','create','edit'],
      updateRequests: ['view','create','edit'],
      officers:       [],
      reports:        ['view'],
      erprecon:       [],
      logisticsCost: []
    },
    procurement_indirect_supervisor: {   // Procurement Supervisor (Indirect) — officer baseline (extras added separately)
      orders:         ['view','create','edit'],
      shipments:      ['view'],
      exports:        ['view'],
      payments:       ['view','create','edit','approve'],
      milestones:     ['view','create','edit'],
      suppliers:      ['view','create','edit'],
      documents:      ['view','create','edit'],
      followups:      ['view','create','edit'],
      issues:         ['view','create','edit'],
      updateRequests: ['view','create','edit'],
      officers:       [],
      reports:        ['view'],
      erprecon:       [],
      logisticsCost: []
    },
    sc_supervisor: {   // Supply Chain Supervisor (Specialist) — officer baseline (extras added separately)
      orders:         ['view','create','edit'],
      shipments:      ['view'],
      exports:        ['view'],
      payments:       ['view','create','edit','approve'],
      milestones:     ['view','create','edit'],
      suppliers:      ['view','create','edit'],
      documents:      ['view','create','edit'],
      followups:      ['view','create','edit'],
      issues:         ['view','create','edit'],
      updateRequests: ['view','create','edit'],
      officers:       [],
      reports:        ['view'],
      erprecon:       [],
      logisticsCost: []
    },

    logistics_manager: {   // Logistics Manager
      orders:         ['view'],
      shipments:      ['view','create','edit','archive'],
      exports:        ['view','create','edit','archive'],
      payments:       ['view','approve'],
      milestones:     ['view','create','edit'],
      suppliers:      ['view'],
      documents:      ['view','create','edit','archive'],
      followups:      ['view','create','edit','archive'],
      issues:         ['view','create','edit','archive'],
      updateRequests: ['view','create','edit','archive'],
      officers:       [],
      reports:        ['view'],
      erprecon:       ['view','create','edit'],
      logisticsCost: []
    },
    logistics_officer: {   // Logistics Officer
      orders:         ['view'],
      shipments:      ['view','create','edit','archive'],
      exports:        ['view','create','edit','archive'],
      payments:       ['view'],
      milestones:     ['view'],
      suppliers:      ['view'],
      documents:      ['view','create','edit'],
      followups:      ['view','create','edit'],
      issues:         ['view','create','edit'],
      updateRequests: ['view','create','edit'],
      officers:       [],
      reports:        ['view'],
      erprecon:       [],
      logisticsCost: []
    },
    demand_supervisor: {   // Demand Planning Supervisor
      orders:         ['view'],
      shipments:      ['view'],
      exports:        ['view'],
      payments:       [],
      milestones:     ['view'],
      suppliers:      ['view'],
      documents:      ['view'],
      followups:      ['view'],
      issues:         ['view'],
      updateRequests: ['view','create','edit'],
      officers:       [],
      reports:        ['view'],
      erprecon:       [],
      logisticsCost: []
    },
    demand_officer: {   // Demand Planning Officer
      orders:         ['view'],
      shipments:      ['view'],
      exports:        ['view'],
      payments:       [],
      milestones:     ['view'],
      suppliers:      ['view'],
      documents:      ['view'],
      followups:      ['view'],
      issues:         ['view'],
      updateRequests: ['view','create','edit'],
      officers:       [],
      reports:        ['view'],
      erprecon:       [],
      logisticsCost: []
    },
    finance: {   // Finance (was accounts)
      orders:         ['view'],
      shipments:      [],
      exports:        [],
      payments:       ['view','approve'],
      milestones:     ['view'],
      suppliers:      ['view'],
      documents:      ['view'],
      followups:      [],
      issues:         ['view'],
      updateRequests: ['view','create','edit'],
      officers:       [],
      reports:        ['view'],
      erprecon:       [],
      logisticsCost: []
    },
    stakeholder: {   // Internal Stakeholder (Claimant) — read-only + raise update requests
      orders:         ['view'],
      shipments:      ['view'],
      exports:        ['view'],
      payments:       ['view'],
      milestones:     [],
      suppliers:      [],
      documents:      ['view'],
      followups:      [],
      issues:         ['view'],
      updateRequests: ['view','create','edit'],
      officers:       [],
      reports:        [],
      erprecon:       [],
      logisticsCost: []
    },
  },

  // View access per role (from the approved grid). For each role: views that are
  // hidden entirely, and views that are read-only. Anything not listed = full open.
  // admin sees everything. Used by applyNavVisibility() and the navigate() guard.
  viewAccess: {
    procurement_senior_manager: { hidden: ['mywork'], viewOnly: ['clearance','closedorders','containers','documents','forecast','officers','orders-foreign-indirect','orders-foreign-supplychain','orders-foreign-technical','orders-local-indirect','orders-local-supplychain','orders-local-technical','partials','paymentexposure','payments','shipments','taxprovision'] },
    sc_manager: { hidden: ['mywork','orders-foreign-indirect','orders-foreign-technical','orders-local-indirect','orders-local-technical'], viewOnly: ['closedorders','documents','forecast','officers','paymentexposure','payments','taxprovision'] },
    sc_officer: { hidden: ['teamwork','dqcockpit','erpimportrules','erprecon','managementpack','mgmtcockpit','officers','orders-foreign-indirect','orders-foreign-technical','orders-local-indirect','orders-local-technical','paymentexposure','workingcalendars','workload'], viewOnly: ['exceptions','kpitrends','opcalendar','otifrisk','scorecards','taxprovision'] },
    procurement_technical_manager: { hidden: ['mywork','orders-foreign-indirect','orders-foreign-supplychain','orders-local-indirect','orders-local-supplychain'], viewOnly: ['closedorders','documents','forecast','officers','paymentexposure','payments','taxprovision'] },
    procurement_technical_officer: { hidden: ['teamwork','dqcockpit','erpimportrules','erprecon','managementpack','mgmtcockpit','officers','orders-foreign-indirect','orders-foreign-supplychain','orders-local-indirect','orders-local-supplychain','paymentexposure','workingcalendars','workload'], viewOnly: ['exceptions','kpitrends','opcalendar','otifrisk','scorecards','taxprovision'] },
    procurement_indirect_manager: { hidden: ['mywork','orders-foreign-supplychain','orders-foreign-technical','orders-local-supplychain','orders-local-technical'], viewOnly: ['closedorders','documents','forecast','officers','paymentexposure','payments','taxprovision'] },
    procurement_indirect_officer: { hidden: ['teamwork','dqcockpit','erpimportrules','erprecon','managementpack','mgmtcockpit','officers','orders-foreign-supplychain','orders-foreign-technical','orders-local-supplychain','orders-local-technical','paymentexposure','workingcalendars','workload'], viewOnly: ['exceptions','kpitrends','opcalendar','otifrisk','scorecards','taxprovision'] },
    procurement_technical_supervisor: { hidden: ['dqcockpit','erpimportrules','erprecon','managementpack','mgmtcockpit','officers','orders-foreign-indirect','orders-foreign-supplychain','orders-local-indirect','orders-local-supplychain','paymentexposure','workingcalendars','workload'], viewOnly: ['exceptions','kpitrends','opcalendar','otifrisk','scorecards','taxprovision'] },
    procurement_indirect_supervisor: { hidden: ['dqcockpit','erpimportrules','erprecon','managementpack','mgmtcockpit','officers','orders-foreign-supplychain','orders-foreign-technical','orders-local-supplychain','orders-local-technical','paymentexposure','workingcalendars','workload'], viewOnly: ['exceptions','kpitrends','opcalendar','otifrisk','scorecards','taxprovision'] },
    sc_supervisor: { hidden: ['dqcockpit','erpimportrules','erprecon','managementpack','mgmtcockpit','officers','orders-foreign-indirect','orders-foreign-technical','orders-local-indirect','orders-local-technical','paymentexposure','workingcalendars','workload'], viewOnly: ['exceptions','kpitrends','opcalendar','otifrisk','scorecards','taxprovision'] },
    logistics_manager: { hidden: ['erpimportrules'], viewOnly: ['closedorders', 'forecast', 'officers', 'orders-foreign-indirect', 'orders-foreign-supplychain', 'orders-foreign-technical', 'orders-local-indirect', 'orders-local-supplychain', 'orders-local-technical', 'paymentexposure', 'payments', 'suppliers'] },
    logistics_officer: { hidden: ['teamwork','dqcockpit','erpimportrules','erprecon','kpitrends','managementpack','mgmtcockpit','officers','paymentexposure','workingcalendars','workload'], viewOnly: ['closedorders', 'forecast', 'orders-foreign-indirect', 'orders-foreign-supplychain', 'orders-foreign-technical', 'orders-local-indirect', 'orders-local-supplychain', 'orders-local-technical', 'otifrisk', 'payments', 'scorecards', 'suppliers'] },
    demand_supervisor: { hidden: ['erpimportrules','erprecon','forecast','managementpack','mywork','officers','paymentexposure','payments','taxprovision','workingcalendars'], viewOnly: ['clearance','closedorders','containers','documents','dqcockpit','exceptions','kpitrends','mgmtcockpit','opcalendar','orders-foreign-indirect','orders-foreign-supplychain','orders-foreign-technical','orders-local-indirect','orders-local-supplychain','orders-local-technical','otifrisk','partials','scorecards','shipments','suppliers','workload'] },
    demand_officer: { hidden: ['teamwork','dqcockpit','erpimportrules','erprecon','forecast','kpitrends','managementpack','mgmtcockpit','mywork','officers','paymentexposure','payments','scorecards','taxprovision','workingcalendars','workload'], viewOnly: ['clearance','closedorders','containers','documents','orders-foreign-indirect','orders-foreign-supplychain','orders-foreign-technical','orders-local-indirect','orders-local-supplychain','orders-local-technical','otifrisk','partials','shipments','suppliers'] },
    finance: { hidden: ['teamwork','clearance','closedorders','containers','dashboard','documents','dqcockpit','erpimportrules','erprecon','exceptions','exports','kpitrends','managementpack','mgmtcockpit','mywork','officers','opcalendar','otifrisk','partials','reports','scorecards','shipments','suppliers','workingcalendars','workload'], viewOnly: ['orders-foreign-indirect','orders-foreign-supplychain','orders-foreign-technical','orders-local-indirect','orders-local-supplychain','orders-local-technical','paymentexposure','payments'] },
    stakeholder: { hidden: ['teamwork','clearance','closedorders','containers','dashboard','dqcockpit','erpimportrules','erprecon','exceptions','forecast','kpitrends','managementpack','mgmtcockpit','mywork','officers','opcalendar','otifrisk','partials','paymentexposure','payments','reports','scorecards','suppliers','taxprovision','workingcalendars','workload'], viewOnly: ['documents','orders-foreign-indirect','orders-foreign-supplychain','orders-foreign-technical','orders-local-indirect','orders-local-supplychain','orders-local-technical','shipments'] },
  },

  packagingUnits: [
    "Package(s)", "Carton(s)", "Wooden Crate(s)",
    "20FT", "40FT", "40HC",
    "20 Flat Rack(FR)", "40 Flat Rack(FR)",
    "20 Reefer(RF)", "40 Reefer(RF)",
    "Part Of 20FT", "Part Of 40FT"
  ],

  shipmentStages: {
    requested:   { label: "Requested",   short: "Requested",   badge: "accent" },
    assigned:    { label: "Assigned",    short: "Assigned",    badge: "info" },
    in_progress: { label: "In Progress", short: "In Progress", badge: "primary" },
    completed:   { label: "Completed",   short: "Completed",   badge: "success" }
  },

  /* Outbound EXPORTS (logistics-owned): reasons, modes, and the two lifecycles. */
  exportReasons: [
    { key: 'sample',            label: 'Sample',            trip: 'one_way' },
    { key: 'return_to_supplier', label: 'Return to supplier', trip: 'one_way' },
    { key: 'repair',            label: 'Repair',            trip: 'round_trip' },
    { key: 'refurbishment',     label: 'Refurbishment',     trip: 'round_trip' },
    { key: 'calibration',       label: 'Calibration',       trip: 'round_trip' },
    { key: 'scrap',             label: 'Scrap / disposal',  trip: 'one_way' },
    { key: 'other',             label: 'Other',             trip: 'one_way' }
  ],
  exportModes: ['AIR', 'SEA', 'COURIER'],
  // One-way and round-trip status vocabularies. Round-trip extends with the return leg.
  exportStatusesOneWay: ['Draft', 'Dispatched', 'In transit', 'Delivered', 'Closed', 'Cancelled'],
  exportStatusesRoundTrip: ['Draft', 'Dispatched', 'In transit', 'Delivered', 'Return in transit', 'Received back', 'Closed', 'Cancelled'],

  /* Anchor events available for milestone expected-date calculation */
  anchorEvents: {
    order_placement: "Date of Order",
    supplier_confirmation: "Order Acknowledged Date",
    order_ready: "Order Ready Date",
    before_shipment: "Order Ready Date (paid before shipping)",
    bl_date: "BL / AWB Date (from shipment)",
    eta: "ETA (from shipment)",
    invoice_date: "Invoice Date",
    end_of_month: "End of invoice month",
    grn_date: "GRN Date (from shipment)",
    erection: "Erection date (manual)",
    commissioning: "Commissioning date (manual)",
    delivery: "Delivery date (manual)"
  },

  /* Auto-generated milestone schedule per payment term.
     percent + label + anchor + offset (days from anchor; negative = before).
     All schedules sum to exactly 100%. */
  paymentSchedules: {
    "100% Advance payment": [
      { percent: 100, label: "Advance payment", anchor: "order_placement", offset: 0 }
    ],
    "50% Advance: 50% before Shipment": [
      { percent: 50, label: "Advance", anchor: "order_placement", offset: 0 },
      { percent: 50, label: "Before shipment", anchor: "before_shipment", offset: 0 }
    ],
    "50% Advance: 50% 30 days after Shipment": [
      { percent: 50, label: "Advance", anchor: "order_placement", offset: 0 },
      { percent: 50, label: "30 days after shipment", anchor: "bl_date", offset: 30 }
    ],
    "50% Advance: 50% 60 days from invoice Date": [
      { percent: 50, label: "Advance", anchor: "order_placement", offset: 0 },
      { percent: 50, label: "60 days from invoice", anchor: "invoice_date", offset: 60 }
    ],
    "30% Advance: 50% before shipment: 10% after erection: 10% after commissioning": [
      { percent: 30, label: "Advance", anchor: "order_placement", offset: 0 },
      { percent: 50, label: "Before shipment", anchor: "before_shipment", offset: 0 },
      { percent: 10, label: "After erection", anchor: "erection", offset: 0 },
      { percent: 10, label: "After commissioning", anchor: "commissioning", offset: 0 }
    ],
    "50% Advance: 40% before Shipment; 10% before commissioning": [
      { percent: 50, label: "Advance", anchor: "order_placement", offset: 0 },
      { percent: 40, label: "Before shipment", anchor: "before_shipment", offset: 0 },
      { percent: 10, label: "Before commissioning", anchor: "commissioning", offset: -1 }
    ],
    "50% Advance: 50% from BL date": [
      { percent: 50, label: "Advance", anchor: "order_placement", offset: 0 },
      { percent: 50, label: "On BL", anchor: "bl_date", offset: 0 }
    ],
    "30% Advance; 70% before shipment": [
      { percent: 30, label: "Advance", anchor: "order_placement", offset: 0 },
      { percent: 70, label: "Before shipment", anchor: "before_shipment", offset: 0 }
    ],
    "30% Advance; 70% 30 days after shipment": [
      { percent: 30, label: "Advance", anchor: "order_placement", offset: 0 },
      { percent: 70, label: "30 days after shipment", anchor: "bl_date", offset: 30 }
    ],
    "14 days Net": [
      { percent: 100, label: "14 days net from invoice", anchor: "invoice_date", offset: 14 }
    ],
    "21 days from BL date": [
      { percent: 100, label: "21 days from BL", anchor: "bl_date", offset: 21 }
    ],
    "30 days from Invoice date": [
      { percent: 100, label: "30 days from invoice", anchor: "invoice_date", offset: 30 }
    ],
    "30 days from BL date": [
      { percent: 100, label: "30 days from BL", anchor: "bl_date", offset: 30 }
    ],
    "30 days end of month": [
      { percent: 100, label: "30 days end of month", anchor: "end_of_month", offset: 30 }
    ],
    "40 days from Invoice": [
      { percent: 100, label: "40 days from invoice", anchor: "invoice_date", offset: 40 }
    ],
    "45 days from Invoice Date": [
      { percent: 100, label: "45 days from invoice", anchor: "invoice_date", offset: 45 }
    ],
    "45 days from BL": [
      { percent: 100, label: "45 days from BL", anchor: "bl_date", offset: 45 }
    ],
    "45 days end of month": [
      { percent: 100, label: "45 days end of month", anchor: "end_of_month", offset: 45 }
    ],
    "60 days from Invoice Date": [
      { percent: 100, label: "60 days from invoice", anchor: "invoice_date", offset: 60 }
    ],
    "60 days from BL date": [
      { percent: 100, label: "60 days from BL", anchor: "bl_date", offset: 60 }
    ],
    "60 days end of month": [
      { percent: 100, label: "60 days end of month", anchor: "end_of_month", offset: 60 }
    ],
    "90 days from Invoice date": [
      { percent: 100, label: "90 days from invoice", anchor: "invoice_date", offset: 90 }
    ],
    "90 days from BL Date": [
      { percent: 100, label: "90 days from BL", anchor: "bl_date", offset: 90 }
    ],
    "7 days before arrival of shipment": [
      { percent: 100, label: "7 days before arrival", anchor: "eta", offset: -7 }
    ],
    "50% Advance; 50% 45 days BL date": [
      { percent: 50, label: "Advance", anchor: "order_placement", offset: 0 },
      { percent: 50, label: "45 days from BL", anchor: "bl_date", offset: 45 }
    ],
    "25% Advance; 75% before loading": [
      { percent: 25, label: "Advance", anchor: "order_placement", offset: 0 },
      { percent: 75, label: "Before loading", anchor: "before_shipment", offset: 0 }
    ],
    "50% Advance; 50% Against BL": [
      { percent: 50, label: "Advance", anchor: "order_placement", offset: 0 },
      { percent: 50, label: "Against BL", anchor: "bl_date", offset: 0 }
    ],
    "60% Advance; 40% 30 days after commissioning": [
      { percent: 60, label: "Advance", anchor: "order_placement", offset: 0 },
      { percent: 40, label: "30 days after commissioning", anchor: "commissioning", offset: 30 }
    ],
    "92% Advance; 8% after delivery": [
      { percent: 92, label: "Advance", anchor: "order_placement", offset: 0 },
      { percent: 8, label: "After delivery", anchor: "grn_date", offset: 0 }
    ],
    "On receipt of documents": [
      { percent: 100, label: "On receipt of documents", anchor: "invoice_date", offset: 0 }
    ]
  }
};

// Canonical alias: REF.statuses now points at the active order lifecycle list.
// Any legacy caller reading REF.statuses gets the current vocabulary; old records
// carrying pre-split values are still matched via REF.legacyStatuses where needed.
REF.statuses = REF.orderFollowupStatuses;

/* status → badge color */
function statusBadgeClass(status) {
  if (!status) return "neutral";
  const s = status.toLowerCase();
  if (s.includes("cancel")) return "danger";
  if (s.includes("hold") || s.includes("delay") || s.includes("query") || s.includes("issue")) return "warn";
  if (s.includes("closed") || s.includes("received") && !s.includes("under")) return "success";
  if (s.includes("grn completed") || s.includes("delivered")) return "success";
  if (s.includes("transit") || s.includes("clearance") || s.includes("broker") || s.includes("customs")) return "info";
  if (s.includes("under receipt") || s.includes("under prod") || s.includes("production") || s.includes("preparation")) return "accent";
  if (s.includes("ready") || s.includes("loading") || s.includes("booking") || s.includes("collected") || s.includes("departed")) return "primary";
  if (s.includes("clarif") || s.includes("awaiting") || s.includes("pending")) return "warn";
  if (s === "paid") return "success";
  if (s === "approved") return "info";
  if (s === "submitted") return "primary";
  if (s === "forthcoming") return "accent";
  if (s === "draft") return "neutral";
  if (s === "rejected") return "danger";
  return "neutral";
}

function refListValues(list) {
  return (list || [])
    .map(item => typeof item === "string" ? item : (item && (item.label || item.key)))
    .filter(Boolean);
}

function statusOptionsHtml(list, currentValue) {
  const values = refListValues(list);
  const current = currentValue == null ? "" : String(currentValue);
  const isLegacy = current && !values.includes(current);
  const options = isLegacy ? [current].concat(values) : values;
  return options.map(value => {
    const label = isLegacy && value === current ? `${value} (legacy)` : value;
    return `<option value="${escapeHtml(value)}" ${current === value ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
}

function orderStatusOptionsHtml(currentValue) {
  return statusOptionsHtml(REF.orderFollowupStatuses || REF.statuses, currentValue);
}

/* Resolve an ERP PO status to a Phoenix operational status (a suggested starting
   point — officers advance the real status). Uses REF.erpStatusMap.po; anything
   unrecognised falls back to the earliest honest active state, "Order sent to
   supplier", because an ERP snapshot only proves the PO was issued. Always returns
   a value that exists in orderFollowupStatuses. */
function mapErpPoStatus(erpPoStatus) {
  const fallback = 'Order sent to supplier';
  if (!erpPoStatus) return fallback;
  const map = (REF.erpStatusMap && REF.erpStatusMap.po) || {};
  if (map[erpPoStatus]) return map[erpPoStatus];
  // case-insensitive retry
  const key = Object.keys(map).find(k => k.toLowerCase() === String(erpPoStatus).toLowerCase());
  return key ? map[key] : fallback;
}
window.mapErpPoStatus = mapErpPoStatus;

function shipmentStatusOptionsHtml(currentValue) {
  return statusOptionsHtml(REF.shipmentFollowupStatuses || REF.statuses, currentValue);
}

function nextShipmentSequence(orderId, shipments = state.data.shipments) {
  if (!orderId) return 1;
  // Base the next number purely on the HIGHEST existing sequence, parsed from the
  // shipment IDs themselves via shipmentSequence() (handles both "(S#)" and legacy
  // single-letter suffixes). We deliberately do NOT floor on related.length: a raw
  // count desyncs from the real max when a shipment is archived/restored or an ID is
  // hand-edited, which could skip or duplicate a number. Archived shipments are
  // excluded so a restored one keeps its original sequence instead of forcing a gap.
  const related = (shipments || []).filter(sh => sh && sh.orderId === orderId && !sh.archived);
  const maxSeq = related.reduce((max, sh) => Math.max(max, shipmentSequence(sh) || 0), 0);
  return maxSeq + 1;
}

function makeShipmentSequenceId(orderId, shipments = state.data.shipments) {
  return orderId ? `${orderId} (S${nextShipmentSequence(orderId, shipments)})` : "";
}

function shipmentSequence(shipment) {
  const id = String(shipment && shipment.shipmentId || "");
  const orderId = String(shipment && shipment.orderId || "");
  const seqMatch = id.match(/\(S(\d+)\)\s*$/i);
  if (seqMatch) return Number(seqMatch[1]) || null;
  if (orderId && id.toUpperCase().startsWith(orderId.toUpperCase())) {
    const suffix = id.slice(orderId.length).trim();
    const letterMatch = suffix.match(/^([A-Z])$/i);
    if (letterMatch) return letterMatch[1].toUpperCase().charCodeAt(0) - 64;
  }
  return null;
}

function shipmentBelongsToOrder(shipment, orderOrId) {
  if (!shipment) return false;
  const orderId = String((orderOrId && typeof orderOrId === "object") ? orderOrId.orderId : orderOrId || "").trim();
  if (!orderId) return false;
  const linkedOrderId = String(shipment.orderId || "").trim();
  if (linkedOrderId === orderId) return true;
  const shipmentId = String(shipment.shipmentId || "").trim();
  if (!shipmentId || shipmentId.toUpperCase().slice(0, orderId.length) !== orderId.toUpperCase()) return false;
  const suffix = shipmentId.slice(orderId.length).trim();
  return !suffix || /^\(S\d+\)$/i.test(suffix) || /^S\d+$/i.test(suffix) || /^[A-Z]$/i.test(suffix);
}

function recordTime(value) {
  if (!value) return null;
  const date = value.toDate ? value.toDate() : new Date(value);
  return date && !isNaN(date) ? date.getTime() : null;
}

function hasLaterShipmentForOrder(shipment, shipments = state.data.shipments) {
  if (!shipment || !shipment.orderId) return false;
  const currentSeq = shipmentSequence(shipment);
  const currentTime = recordTime(shipment.requestedAt) || recordTime(shipment.createdAt) || recordTime(shipment.updatedAt);
  return (shipments || []).some(other => {
    if (!other || other.archived || other.id === shipment.id || other.orderId !== shipment.orderId) return false;
    const otherSeq = shipmentSequence(other);
    if (currentSeq != null && otherSeq != null) return otherSeq > currentSeq;
    const otherTime = recordTime(other.requestedAt) || recordTime(other.createdAt) || recordTime(other.updatedAt);
    return currentTime != null && otherTime != null && otherTime > currentTime;
  });
}

function shipmentFollowupActionOpen(shipment, data = state.data) {
  const action = shipment && shipment.followupAction || "";
  if (!action || action === "No action") return false;
  if (shipment.followupActionStatus === "processed" || shipment.followupActionProcessedAt) return false;
  if (shipment.stage === "completed" || shipment.completed) return false;

  if (action === "Create next shipment") {
    return !hasLaterShipmentForOrder(shipment, data.shipments || []);
  }
  if (action === "Raise issue") {
    const order = shipment.orderId ? (data.orders || []).find(o => o.orderId === shipment.orderId) : null;
    const hasIssue = (data.issues || []).some(issue => !issue.archived && (
      (issue.relatedType === "shipment" && issue.relatedId === shipment.id) ||
      (order && issue.relatedType === "order" && issue.relatedId === order.id)
    ));
    return !hasIssue;
  }
  if (action === "Await GRN / store confirmation") {
    const order = shipment.orderId ? (data.orders || []).find(o => o.orderId === shipment.orderId) : null;
    const keys = [shipment.id, shipment.shipmentId].filter(Boolean).map(String);
    const linkedGrn = order && Array.isArray(order.receipts) && order.receipts.some(receipt => {
      const status = String(receipt?.status || '').toLowerCase();
      return status !== 'pending' && status !== 'cancelled'
        && keys.includes(String(receipt.shipmentId || ''))
        && !!(receipt.grnDate || receipt.actualReceiptDate);
    });
    return !(shipment.grnDate || linkedGrn);
  }
  return true;
}

/* ============================================================
   APP STATE
   ============================================================ */
const state = {
  user: null,
  officer: null,
  importRuleConfigId: null,
  calendarConfigId: null,
  view: 'dashboard',
  data: {
    orders: [],
    shipments: [],
    payments: [],
    suppliers: [],
    officers: [],
    importRules: [],
    businessCalendars: [],
    importRuns: [],
    documents: [],
    followups: [],
    issues: [],
    updateRequests: [],
    contactLog: [],
    kpiSnapshot: [],
    exports: []
  },
  unsubs: [],
  filters: {}
};
window.__state = state;  // for debugging in console

/* ============================================================
   UTILITIES
   ============================================================ */
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

function fmtDate(d) {
  if (!d) return '';
  if (d.toDate) d = d.toDate();
  if (typeof d === 'string') d = new Date(d);
  if (!(d instanceof Date) || isNaN(d)) return '';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateISO(d) {
  if (!d) return '';
  if (d.toDate) d = d.toDate();
  if (typeof d === 'string') d = new Date(d);
  if (!(d instanceof Date) || isNaN(d)) return '';
  return d.toISOString().slice(0, 10);
}
function parseDate(s) { if (!s) return null; const d = new Date(s); return isNaN(d) ? null : d; }
function fmtMoney(n, c='') {
  if (n === null || n === undefined || n === '') return '';
  const v = Number(n);
  if (isNaN(v)) return '';
  return (c ? c + ' ' : '') + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function daysBetween(a, b) {
  if (!a || !b) return null;
  if (a.toDate) a = a.toDate(); if (b.toDate) b = b.toDate();
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function debounce(fn, ms=200) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
const searchInputTimers = {};
function clearSearchInputTimers(keys) {
  const list = keys ? (Array.isArray(keys) ? keys : [keys]) : Object.keys(searchInputTimers);
  list.forEach(k => {
    if (searchInputTimers[k]) clearTimeout(searchInputTimers[k]);
    searchInputTimers[k] = null;
  });
}
function bindSearchInput(input, opts = {}) {
  const el = typeof input === 'string' ? $(input) : input;
  if (!el || typeof opts.setValue !== 'function' || typeof opts.render !== 'function') return null;
  const key = opts.key || (typeof input === 'string' ? input : (el.id ? '#' + el.id : Math.random().toString(36).slice(2)));
  const delay = opts.delay == null ? 180 : opts.delay;
  const refocus = opts.refocus !== false;
  clearSearchInputTimers(key);

  const schedule = (waitMs) => {
    const value = el.value || '';
    const selStart = typeof el.selectionStart === 'number' ? el.selectionStart : null;
    const selEnd = typeof el.selectionEnd === 'number' ? el.selectionEnd : selStart;
    const wasActive = typeof document === 'undefined' ? true : document.activeElement === el;
    opts.setValue(value);
    if (searchInputTimers[key]) clearTimeout(searchInputTimers[key]);
    searchInputTimers[key] = setTimeout(() => {
      searchInputTimers[key] = null;
      opts.render();
      if (!refocus || !wasActive) return;
      const next = typeof input === 'string' ? $(input) : (el.id ? $('#' + el.id) : null);
      if (!next) return;
      next.focus();
      try {
        const start = selStart == null ? next.value.length : Math.min(selStart, next.value.length);
        const end = selEnd == null ? start : Math.min(selEnd, next.value.length);
        next.setSelectionRange(start, end);
      } catch (_) {}
    }, waitMs);
  };

  el.addEventListener('input', () => schedule(delay));
  el.addEventListener('search', () => schedule(0));
  el.addEventListener('change', () => schedule(0));
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      schedule(0);
    }
  });
  return { cancel: () => clearSearchInputTimers(key), flush: () => schedule(0) };
}
function toast(msg, kind='') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; setTimeout(() => el.remove(), 300); }, 3500);
}
function showLoader(target) { target.innerHTML = `<div class="loader-full"><div class="spinner"></div> Loading…</div>`; }

/* ============================================================
   AUTH
   - Demo mode: anonymous sign-in + local name/code profile for prototype testing.
   - Password mode: each user signs in with their own username/password. Access comes
     from the officer profile linked to that authenticated user, not from a shared login.
   ============================================================ */

// Load saved profile (if any) from this browser
function loadSavedProfile() {
  try {
    const raw = localStorage.getItem('phoenix_profile');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveProfile(p) {
  localStorage.setItem('phoenix_profile', JSON.stringify(p));
}
function clearSavedProfile() {
  localStorage.removeItem('phoenix_profile');
}

function configureLoginScreen() {
  const password = usesPasswordAuth();
  const intro = $('#login-intro');
  const pwdFields = $('#password-login-fields');
  const demoFields = $('#demo-profile-fields');
  const foot = $('#login-footnote-text');
  const btn = $('#setup-btn');
  const title = document.querySelector('#login-screen .login-brand h1');
  if (title) title.textContent = password ? 'Sign in' : 'Welcome';
  if (intro) {
    intro.innerHTML = password
      ? 'Sign in with the username and password provided by IT.'
      : "First time on this browser? Tell us who you are.<br>You'll only see this once.";
  }
  if (pwdFields) pwdFields.classList.toggle('hidden', !password);
  if (demoFields) demoFields.classList.toggle('hidden', password);
  if (foot) {
    foot.innerHTML = password
      ? 'Each user must use their own account. Questions? Contact <strong>Bryan Bottine</strong>.'
      : 'Your choice is saved on this device. Questions? Contact <strong>Bryan Bottine</strong>.';
  }
  if (btn) btn.textContent = password ? 'Sign in' : 'Continue';
}

function showLoginScreen(message) {
  configureLoginScreen();
  $('#login-screen').classList.remove('hidden');
  $('#app').classList.remove('visible');
  const err = $('#setup-error');
  if (err) {
    err.textContent = message || '';
    err.classList.toggle('show', !!message);
  }
  const btn = $('#setup-btn');
  if (btn) { btn.disabled = false; btn.textContent = usesPasswordAuth() ? 'Sign in' : 'Continue'; }
}

function setLoginBusy(busy) {
  const btn = $('#setup-btn');
  if (!btn) return;
  btn.disabled = !!busy;
  btn.innerHTML = busy
    ? '<span class="spinner"></span> Signing in…'
    : (usesPasswordAuth() ? 'Sign in' : 'Continue');
}

/* Per-tab demo identity (no-login testing aid).
   Reading ?role=logistics&as=LM&name=Logi from the URL pins THIS TAB to that role and
   officer, stored in sessionStorage (isolated per tab). This lets several tabs of the
   same browser run as different users at the same time. Once captured, the params are
   stripped from the address bar so a manual refresh keeps the tab identity but hides
   the query string. localStorage profile/role still cover tabs that set nothing. */
function captureTabIdentityFromUrl() {
  try {
    const p = new URLSearchParams(location.search);
    const role = p.get('role');
    const as = p.get('as');
    const name = p.get('name');
    let touched = false;
    if (role) { sessionStorage.setItem('phoenix_tab_role', role); window.__tabRole = role; touched = true; }
    if (as)   { sessionStorage.setItem('phoenix_tab_code', as);   touched = true; }
    if (name) { sessionStorage.setItem('phoenix_tab_name', name); touched = true; }
    if (touched) {
      const url = location.origin + location.pathname + location.hash;
      history.replaceState(null, '', url);
    } else {
      // Restore any role pinned earlier this tab (survives in-tab refresh).
      const saved = sessionStorage.getItem('phoenix_tab_role');
      if (saved) window.__tabRole = saved;
    }
  } catch (e) {}
}
// The per-tab officer identity, if this tab was opened with ?as= / ?name=.
function tabOfficerOverride() {
  try {
    const code = sessionStorage.getItem('phoenix_tab_code');
    const name = sessionStorage.getItem('phoenix_tab_name');
    if (code || name) return { code: code || null, fullName: name || code || null };
  } catch (e) {}
  return null;
}

// Setup form: shown only when no profile is saved
$('#setup-form').addEventListener('submit', async e => {
  e.preventDefault();
  $('#setup-error').classList.remove('show');
  setLoginBusy(true);
  try {
    if (usesPasswordAuth()) {
      const email = normaliseLoginEmail($('#login-email') && $('#login-email').value);
      const password = ($('#login-password') && $('#login-password').value) || '';
      if (!email || !password) {
        throw new Error('Enter your username/email and password.');
      }
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await continueAfterAuth(cred.user);
    } else {
      const name = $('#setup-name').value.trim();
      const code = $('#setup-code').value.trim().toUpperCase();
      if (!name || !code) throw new Error('Enter your name and code.');
      if (code.length < 2 || code.length > 3) {
        throw new Error('Code should be 2 or 3 letters.');
      }
      saveProfile({ name, code });
      if (!auth.currentUser) {
        await signInAnonymously(auth);
      } else {
        await continueAfterAuth(auth.currentUser);
      }
    }
  } catch (err) {
    console.error(err);
    let msg = (usesPasswordAuth() ? 'Sign-in failed: ' : 'Setup failed: ') + err.message;
    if (err.code === 'auth/admin-restricted-operation' || err.code === 'auth/operation-not-allowed') {
      msg = usesPasswordAuth()
        ? 'Password sign-in is not enabled in Firebase. Ask IT to enable Email/Password or SSO.'
        : 'Anonymous sign-in is not enabled in Firebase. See Deployment Guide §3.2.';
    } else if (err.code === 'auth/invalid-api-key' || err.code === 'auth/configuration-not-found') {
      msg = 'Firebase is not configured. Edit firebaseConfig in the HTML file.';
    } else if (err.code === 'auth/network-request-failed') {
      msg = 'Network error. Check your connection.';
    } else if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') {
      msg = 'Invalid username or password.';
    }
    $('#setup-error').textContent = msg;
    $('#setup-error').classList.add('show');
    setLoginBusy(false);
  }
});

// Capture any per-tab demo identity from the URL (?role=/?as=/?name=) before auth resolves.
// Demo-only: in production this is disabled so URL params cannot spoof identity/role.
if (isDemoMode()) captureTabIdentityFromUrl();

// Reusable post-auth continuation. Called from BOTH onAuthStateChanged (when auth fires)
// AND the setup form submit handler (when auth.currentUser already exists, so onAuthStateChanged
// won't fire again). This is what fixes the first-time setup hang on "Setting up…".
let __continuingAuth = false;
async function loadPasswordOfficerProfile(user) {
  const uidRef = doc(db, 'officers', user.uid);
  const byUid = await getDoc(uidRef);
  if (byUid.exists()) return { id: byUid.id, ...byUid.data() };

  const byAuthUid = await getDocs(query(collection(db, 'officers'), where('authUid', '==', user.uid), limit(1)));
  if (!byAuthUid.empty) {
    const d = byAuthUid.docs[0];
    return { id: d.id, ...d.data() };
  }

  if (user.email) {
    const byEmail = await getDocs(query(collection(db, 'officers'), where('email', '==', user.email), limit(1)));
    if (!byEmail.empty) {
      const d = byEmail.docs[0];
      return { id: d.id, ...d.data() };
    }
  }

  throw new Error('Your login is valid, but no Phoenix officer profile is linked to this account. Ask an administrator to add your officer record with your Auth UID or email address.');
}

async function continueAfterAuth(user) {
  if (!user) return;
  if (__continuingAuth) return;   // guard against double-entry (both callers firing)
  __continuingAuth = true;
  try {
    state.user = user;
    try {
      if (usesPasswordAuth()) {
        state.officer = await loadPasswordOfficerProfile(user);
        if (state.officer.active === false) {
          throw new Error('Your Phoenix officer profile is inactive. Contact an administrator.');
        }
      } else {
        const saved = loadSavedProfile();
        if (!saved) {
          showLoginScreen();
          return;
        }

        // ────────────────────────────────────────────────────────────────────────
        // DEMO PROFILE / BOOTSTRAP EXCEPTION — NOT a business-record write path.
        // This direct setDoc/updateDoc path exists only for the no-login demo profile.
        // Password/production users must already have an officer profile linked to
        // their own authenticated account; the app does not create one automatically.
        // All BUSINESS records (orders, shipments, payment_requests, suppliers,
        // documents, followups, issues) must still go through PXStore — never here.
        // ────────────────────────────────────────────────────────────────────────
        const ref = doc(db, 'officers', user.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          state.officer = { id: snap.id, ...snap.data() };
          if (state.officer.fullName !== saved.name || state.officer.code !== saved.code) {
            await updateDoc(ref, { fullName: saved.name, code: saved.code, updatedAt: serverTimestamp() });
            state.officer.fullName = saved.name;
            state.officer.code = saved.code;
          }
        } else {
          const officerData = {
            fullName: saved.name,
            code: saved.code,
            role: 'admin',
            active: true,
            anonymous: true,
            createdAt: serverTimestamp()
          };
          await setDoc(ref, officerData);
          state.officer = { id: user.uid, ...officerData };
        }
      }
    } catch (err) {
      console.error('Officer load failed', err);
      const msg = (usesPasswordAuth() ? 'Profile access failed: ' : 'Profile setup failed: ') + (err.message || 'unknown Firebase error');
      toast(msg, 'danger');
      showLoginScreen(msg);
      if (usesPasswordAuth()) {
        try { await signOut(auth); } catch (_) {}
      }
      return;
    }

    $('#login-screen').classList.add('hidden');
    $('#app').classList.add('visible');
    // Per-tab identity override (no-login DEMO aid only): if this tab was opened with
    // ?as=/?name=, present as that officer in THIS tab only. In-memory overlay on a
    // shallow copy — never written to the shared Firestore officer record. Disabled in
    // production so identity comes only from the authenticated/stored profile.
    const tabOff = isDemoMode() ? tabOfficerOverride() : null;
    if (tabOff) {
      state.officer = Object.assign({}, state.officer, {
        code: tabOff.code || state.officer.code,
        fullName: tabOff.fullName || state.officer.fullName
      });
    }
    $('#user-name').textContent = state.officer.fullName;
    $('#user-avatar').textContent = (state.officer.code || '?').slice(0, 2).toUpperCase();
    // Role label reflects any demo-role override (no-login testing aid).
    updateUserChip();
    updateBrandDepartment();
    applyNavVisibility();
    // Show the global "+ New Order" button only to procurement/admin
    const qno = $('#quick-new-order');
    if (qno) {
      qno.style.display = canEditOrders() ? '' : 'none';
    }
    subscribeAll();
    applyEntityAccent();
    applyDensity();
    // Auto-capture last month's KPIs once per entity, on first use in a new month.
    // Deferred so it never blocks load; failures are swallowed inside the engine.
    setTimeout(() => {
      try {
        if (window.PXKpiSnapshot && window.REF && Array.isArray(REF.entities)) {
          REF.entities.forEach(e => window.PXKpiSnapshot.autoCaptureIfDue(e.code));
        }
      } catch (_) {}
    }, 4000);
    renderEntitySwitcher();
    applyNavVisibility();
    navigate(location.hash.slice(1) || 'dashboard');
  } finally {
    __continuingAuth = false;
  }
}

onAuthStateChanged(auth, async user => {
  if (user) {
    await continueAfterAuth(user);
  } else {
    // Not signed in. Password mode waits for the user's own credential; demo mode
    // starts an anonymous prototype session.
    state.user = null; state.officer = null;
    state.unsubs.forEach(u => u && u()); state.unsubs = [];
    if (usesPasswordAuth()) {
      showLoginScreen();
      return;
    }
    try {
      await signInAnonymously(auth);
      // onAuthStateChanged will fire again with a user
    } catch (err) {
      console.error(err);
      let msg = 'Could not start session: ' + err.message;
      if (err.code === 'auth/admin-restricted-operation' || err.code === 'auth/operation-not-allowed') {
        msg = 'Anonymous sign-in is not enabled in Firebase. See Deployment Guide §3.2.';
      } else if (err.code === 'auth/invalid-api-key' || err.code === 'auth/configuration-not-found') {
        msg = 'Firebase is not configured. Edit firebaseConfig in the HTML file.';
      }
      $('#login-screen').classList.remove('hidden');
      $('#setup-error').textContent = msg;
      $('#setup-error').classList.add('show');
    }
  }
});

$('#user-chip').addEventListener('click', async () => {
  // DEMO: the chip opens the ROLE SWITCHER (the testing tool for changing role/permissions).
  if (isDemoMode() && typeof window.__openRoleSwitcher === 'function') {
    window.__openRoleSwitcher();
    return;
  }
  if (confirm('Sign out / switch user?')) {
    clearSavedProfile();
    await signOut(auth);
    if (!usesPasswordAuth()) location.reload();
  }
});

/* ============================================================
   ROUTING / NAVIGATION
   ============================================================ */
$$('.nav-item').forEach(item => {
  item.addEventListener('click', () => navigate(item.dataset.view));
});
window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));

/* ---- Entity switcher (multi-entity) ---- */
function renderEntitySwitcher() {
  const tabs = $('#entity-tabs');
  if (!tabs) return;
  const active = currentEntity();
  tabs.innerHTML = REF.entities.map(e => {
    const isActive = e.code === active;
    return `<div class="entity-tab ${isActive?'active':''}" data-entity="${e.code}" style="${isActive?`background:${e.accent};`:''}">
      <span class="e-dot" style="background:${e.accent}"></span>
      <span>${e.code}</span>
    </div>`;
  }).join('');
  tabs.querySelectorAll('.entity-tab').forEach(t => {
    t.addEventListener('click', () => {
      const nextEntity = t.dataset.entity;
      if (!nextEntity || nextEntity === currentEntity()) return;
      const viewToRefresh = state.view || location.hash.slice(1) || 'dashboard';
      if (typeof clearSearchInputTimers === 'function') clearSearchInputTimers();
      setCurrentEntity(nextEntity);
      applyEntityAccent();
      renderEntitySwitcher();
      updateCounts();
      // Re-scope the current view to the new entity through navigation, then
      // force one direct render on the next tick. The second pass is intentional:
      // it protects long split lists (e.g. Foreign/Technical) from showing a stale
      // previous-entity table if the hash route was already on the same view.
      if (typeof navigate === 'function') navigate(viewToRefresh);
      else renderView(viewToRefresh);
      setTimeout(() => {
        updateCounts();
        renderView(state.view || viewToRefresh);
      }, 0);
    });
  });
}
function applyEntityAccent() {
  const meta = entityMeta(currentEntity());
  document.documentElement.style.setProperty('--entity-accent', meta.accent);
}
window.renderEntitySwitcher = renderEntitySwitcher;
window.applyEntityAccent = applyEntityAccent;

/* Row density — 'comfortable' (default) or 'compact', persisted per browser.
   Comfortable gives roomier rows (BC-style default); Compact tightens them so long
   lists show more per screen. */
function getDensity() {
  try { return localStorage.getItem('phoenix_density') || 'comfortable'; } catch (_) { return 'comfortable'; }
}
function applyDensity() {
  document.body.classList.toggle('density-compact', getDensity() === 'compact');
}
function toggleDensity() {
  const next = getDensity() === 'compact' ? 'comfortable' : 'compact';
  try { localStorage.setItem('phoenix_density', next); } catch (_) {}
  applyDensity();
  return next;
}
window.__getDensity = getDensity;
window.__applyDensity = applyDensity;
window.__toggleDensity = toggleDensity;

/* Hide privileged-only nav items (and any section that becomes empty) for non-privileged users.
   Idempotent — safe to call after login and on role changes. */
// Resolve the view-access level for the current role and a view id:
// 'full' (open + edit per action perms), 'view' (read-only), or 'none' (hidden).
// admin always 'full'. Anything not listed for a role defaults to 'full'.
function viewLevel(view) {
  const role = currentRole();
  if (role === 'admin') return 'full';
  const va = (REF.viewAccess && REF.viewAccess[role]) || null;
  if (!va) return isDemoMode() ? 'full' : 'none';   // unknown role: permissive in demo, closed in prod
  if (Array.isArray(va.hidden) && va.hidden.includes(view)) return 'none';
  if (Array.isArray(va.viewOnly) && va.viewOnly.includes(view)) return 'view';
  return 'full';
}
window.__viewLevel = viewLevel;
// Human title for a view id (used by the BC card page's Back label). Reuses the same
// breadcrumb wording navigate() applies.
window.__viewTitle = function (view) {
  const map = {
    'dashboard': 'Dashboard', 'mywork': 'My Work', 'teamwork': 'Team Work',
    'orders-foreign-technical': 'Foreign Orders — Technical',
    'orders-foreign-indirect': 'Foreign Orders — Indirect',
    'orders-foreign-supplychain': 'Foreign Orders — Supply Chain',
    'orders-local-technical': 'Local Orders — Technical',
    'orders-local-indirect': 'Local Orders — Indirect',
    'orders-local-supplychain': 'Local Orders — Supply Chain',
    'shipments': 'Shipments', 'exports': 'Exports', 'partials': 'Partial Shipments',
    'containers': 'Containers', 'clearance': 'Clearance',
    'payments': 'Payments', 'forecast': 'Payment Forecast',
    'paymentexposure': 'Payment Exposure', 'taxprovision': 'Tax Provision',
    'closedorders': 'Closed Orders', 'documents': 'Documents',
    'mgmtcockpit': 'Management Cockpit', 'managementpack': 'Management Pack',
    'exceptions': 'Exceptions', 'dqcockpit': 'Data Quality', 'otifrisk': 'OTIF Risk',
    'workload': 'Workload', 'opcalendar': 'Operations Calendar', 'scorecards': 'Scorecards',
    'kpitrends': 'KPI Trends', 'reports': 'Reports', 'suppliers': 'Suppliers',
    'erprecon': 'ERP Reconciliation'
  };
  return map[view] || 'Back';
};

function applyNavVisibility() {
  document.querySelectorAll('.nav-item[data-view]').forEach(item => {
    const v = item.getAttribute('data-view');
    item.style.display = (viewLevel(v) === 'none') ? 'none' : '';
  });
  // Group labels (e.g. "Shipments") have no data-view; hide a label when every
  // sub-item that follows it (until the next label / normal item) is hidden.
  document.querySelectorAll('.nav-group-label').forEach(label => {
    let n = label.nextElementSibling, anyVisible = false, hasSub = false;
    while (n && n.classList.contains('nav-item') && n.classList.contains('nav-sub')) {
      hasSub = true;
      if (n.style.display !== 'none') anyVisible = true;
      n = n.nextElementSibling;
    }
    label.style.display = (hasSub && !anyVisible) ? 'none' : '';
  });
  document.querySelectorAll('.nav-control-group').forEach(label => {
    let n = label.nextElementSibling, anyVisible = false, hasItems = false;
    while (n && !n.classList.contains('nav-control-group') && !n.classList.contains('nav-section-title')) {
      if (n.classList.contains('nav-item')) {
        hasItems = true;
        if (n.style.display !== 'none') anyVisible = true;
      }
      n = n.nextElementSibling;
    }
    label.style.display = (hasItems && !anyVisible) ? 'none' : '';
  });
  document.querySelectorAll('.nav-section').forEach(sec => {
    const items = sec.querySelectorAll('.nav-item');
    if (!items.length) return;
    const allHidden = [...items].every(i => i.style.display === 'none');
    sec.style.display = allHidden ? 'none' : '';
  });
  // BC top-menu groups: the nav-items were moved into .bc-nav-menu dropdowns. Hide any
  // group whose menu has no visible nav-item, so view-only users never see an empty menu
  // or a group button that leads nowhere. Runs wherever applyNavVisibility runs (role
  // switch, entity switch, refresh, re-render).
  document.querySelectorAll('.bc-nav-group').forEach(group => {
    const menu = group.querySelector('.bc-nav-menu');
    if (!menu) return;
    const items = menu.querySelectorAll('.nav-item[data-view]');
    if (!items.length) return;
    const anyVisible = [...items].some(i => viewLevel(i.getAttribute('data-view')) !== 'none');
    group.style.display = anyVisible ? '' : 'none';
  });
}
window.__applyNavVisibility = applyNavVisibility;

/* ============================================================
   DEMO ROLE SWITCHER (no-login testing aid)
   ============================================================
   Lets a single tester experience the app as each role without real login. Sets a
   per-browser demo override that currentRole() honours; the real stored officer
   record is never changed. Clearing it returns to the profile's own role (admin). */
const DEMO_ROLES = [
  { code: '',                          label: 'Superuser (admin)',            desc: 'Full access — your normal testing view' },
  { code: 'procurement_senior_manager', label: 'Senior Procurement Manager',  desc: 'Oversight: full Reports & Controls, view-only operations' },
  { code: 'sc_manager',                label: 'Supply Chain Manager', desc: 'Supply Chain stream — full; sees only Supply Chain orders' },
  { code: 'sc_supervisor',             label: 'Supply Chain Supervisor', desc: 'Supply Chain stream — officer tasks + approve/reassign/team view' },
  { code: 'sc_officer',                label: 'Supply Chain Officer (Specialist)', desc: 'Supply Chain stream — day-to-day; only Supply Chain orders' },
  { code: 'procurement_technical_manager', label: 'Procurement Manager (Technical & Service)', desc: 'Technical & Service stream — full; only Technical orders' },
  { code: 'procurement_technical_supervisor', label: 'Procurement Supervisor (Technical & Service)', desc: 'Technical stream — officer tasks + approve/reassign/team view' },
  { code: 'procurement_technical_officer', label: 'Procurement Officer (Technical & Service)', desc: 'Technical & Service stream — day-to-day; only Technical orders' },
  { code: 'procurement_indirect_manager',  label: 'Procurement Manager (Indirect)', desc: 'Indirect stream — full; only Indirect orders' },
  { code: 'procurement_indirect_supervisor', label: 'Procurement Supervisor (Indirect)', desc: 'Indirect stream — officer tasks + approve/reassign/team view' },
  { code: 'procurement_indirect_officer',  label: 'Procurement Officer (Indirect)', desc: 'Indirect stream — day-to-day; only Indirect orders' },
  { code: 'logistics_manager',         label: 'Logistics Manager',            desc: 'Full logistics + management views' },
  { code: 'logistics_officer',         label: 'Logistics Officer',            desc: 'Shipments & logistics operations' },
  { code: 'demand_supervisor',         label: 'Demand Planning Supervisor',   desc: 'Planning analytics; view operations' },
  { code: 'demand_officer',            label: 'Demand Planning Officer',      desc: 'Planning; view operations' },
  { code: 'finance',                   label: 'Finance',                      desc: 'Payments-focused; view orders' },
  { code: 'stakeholder',               label: 'Internal Stakeholder (Claimant)', desc: 'Read-only; can raise update requests' }
];
function demoRoleLabel(code) {
  const r = DEMO_ROLES.find(x => x.code === (code || ''));
  return r ? r.label : (code || 'Superuser (admin)');
}

/* Map the active role to a department/area label shown as the first line of the brand
   block (BC Role-Center style). Falls back to "Phoenix Procurement". */
const ROLE_DEPARTMENT = {
  admin:                      'Administration',
  procurement_senior_manager: 'Procurement — Management',
  sc_manager:                 'Supply Chain',
  sc_supervisor:              'Supply Chain',
  sc_officer:                 'Supply Chain',
  procurement_technical_manager: 'Technical & Service',
  procurement_technical_supervisor: 'Technical & Service',
  procurement_technical_officer: 'Technical & Service',
  procurement_indirect_manager:  'Indirect',
  procurement_indirect_supervisor: 'Indirect',
  procurement_indirect_officer:  'Indirect',
  logistics_manager:          'Logistics',
  logistics_officer:          'Logistics',
  demand_supervisor:          'Demand Planning',
  demand_officer:             'Demand Planning',
  finance:                    'Finance',
  stakeholder:                'Procurement Portal'
};
function departmentLabel() {
  try {
    const r = (typeof currentRole === 'function') ? currentRole() : null;
    return (r && ROLE_DEPARTMENT[r]) || 'Phoenix Procurement';
  } catch (e) { return 'Phoenix Procurement'; }
}
function updateBrandDepartment() {
  const nameEl = document.querySelector('.app-header .brand .name');
  if (!nameEl) return;
  // First text node is the department line; the <span> (company) stays.
  const dept = departmentLabel();
  const span = nameEl.querySelector('span');
  nameEl.childNodes[0] && (nameEl.childNodes[0].nodeValue = dept);
  if (!nameEl.childNodes[0] && span) nameEl.insertBefore(document.createTextNode(dept), span);
}
window.updateBrandDepartment = updateBrandDepartment;
window.departmentLabel = departmentLabel;
function setDemoRole(code) {
  try {
    if (code) { window.__demoRole = code; localStorage.setItem('phoenix_demo_role', code); }
    else { window.__demoRole = null; localStorage.removeItem('phoenix_demo_role'); }
  } catch (e) {}
  updateUserChip();
  updateBrandDepartment();
  applyNavVisibility();
  // Role-gated header button follows the active role too.
  const qno = document.getElementById('quick-new-order');
  if (qno) qno.style.display = canEditOrders() ? '' : 'none';
  // Re-scope the current view to the new role. If the new role isn't allowed to see
  // the current view (e.g. a Senior Manager landing on "My Work", which is hidden for
  // them), navigate() redirects to a permitted view instead of re-rendering a forbidden
  // one. Otherwise just re-render so role-gated buttons/sections refresh.
  if (state.view && viewLevel(state.view) === 'none' && typeof navigate === 'function') {
    navigate(state.view); // guard inside navigate() bounces to the first permitted view
  } else if (typeof renderView === 'function' && state.view) {
    renderView(state.view);
  }
  if (window.updateCounts) window.updateCounts();
  const lbl = demoRoleLabel(code);
  if (window.PXUtils) window.PXUtils.toast(code ? `Now viewing as: ${lbl}` : 'Back to Superuser (admin) view', 'success');
  closeModal && closeModal();
}
window.__setDemoRole = setDemoRole;

// Reflect the active (possibly demo-overridden) role in the header chip.
function updateUserChip() {
  const roleEl = document.getElementById('user-role');
  const active = currentRole();
  const chip = document.getElementById('user-chip');
  const caret = document.querySelector('#user-chip .chip-caret');
  if (!isDemoMode()) {
    // Production: chip shows the real role, no switcher affordance.
    if (roleEl) { roleEl.textContent = demoRoleLabel(active); roleEl.classList.remove('demo-role'); }
    if (chip) { chip.classList.remove('demo-active'); chip.style.cursor = 'default'; chip.title = ''; }
    if (caret) caret.style.display = 'none';
    return;
  }
  const tabPinned = (window.__tabRole || (function(){ try { return sessionStorage.getItem('phoenix_tab_role'); } catch(e){ return null; } })());
  const demo = (window.__demoRole || (function(){ try { return localStorage.getItem('phoenix_demo_role'); } catch(e){ return null; } })());
  if (roleEl) {
    roleEl.textContent = demoRoleLabel(tabPinned || demo || active) + (tabPinned ? ' · this tab' : '');
    roleEl.classList.toggle('demo-role', !!(tabPinned || demo));
  }
  if (chip) chip.classList.toggle('demo-active', !!(tabPinned || demo));
}
window.updateUserChip = updateUserChip;
window.__updateUserChip = updateUserChip;

// Open the role-switcher menu (from the header chip). DEMO ONLY.
window.__openRoleSwitcher = function () {
  if (!isDemoMode()) return;  // production: no self-service role switching
  const active = (window.__demoRole || (function(){ try { return localStorage.getItem('phoenix_demo_role'); } catch(e){ return ''; } })()) || '';
  const rows = DEMO_ROLES.map(r => `
    <button class="role-switch-item ${r.code === active ? 'active' : ''}" onclick="window.__setDemoRole('${r.code}')">
      <div class="rs-main">
        <span class="rs-label">${r.label}</span>
        ${r.code === active ? '<span class="rs-current">current</span>' : ''}
      </div>
      <div class="rs-desc">${r.desc}</div>
      ${r.code ? `<span class="rs-newtab" onclick="event.stopPropagation(); window.__openRoleInNewTab('${r.code}')" title="Open this role in a separate tab (independent of this one)">↗ new tab</span>` : ''}
    </button>`).join('');
  openModal(`
    <div class="modal-head">
      <div><h2>View as role</h2><div class="sub">Demo aid — preview what each role sees. Your real profile is unchanged.</div></div>
      <button class="btn btn-ghost btn-icon" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="info-banner text-sm"><strong>This tab:</strong> tap a role to switch the current view. <strong>Separate tab:</strong> use "↗ new tab" to open a role in its own tab — different tabs can run as different roles at the same time in this browser. Choose <strong>Superuser (admin)</strong> to return to full access.</div>
      <div class="role-switch-list">${rows}</div>
    </div>
  `);
};

// Open a new tab pinned to a role (and an optional matching demo officer code/name),
// using URL params the new tab captures into its own per-tab sessionStorage.
window.__openRoleInNewTab = function (roleCode) {
  const labelByRole = { procurement_senior_manager: ['SPM', 'Snr Proc Mgr'], procurement_manager: ['PMGR', 'Proc Mgr'], procurement_supervisor: ['PSUP', 'Proc Supv'], procurement_officer: ['POFF', 'Proc Officer'], logistics_manager: ['LMGR', 'Logi Mgr'], logistics_officer: ['LOFF', 'Logi Officer'], demand_supervisor: ['DPS', 'Demand Supv'], demand_officer: ['DPO', 'Demand Officer'], finance: ['FIN', 'Finance'], stakeholder: ['STK', 'Stakeholder'] };
  const pair = labelByRole[roleCode] || ['', ''];
  const url = location.origin + location.pathname + '?role=' + encodeURIComponent(roleCode) +
    (pair[0] ? '&as=' + encodeURIComponent(pair[0]) + '&name=' + encodeURIComponent(pair[1]) : '');
  window.open(url, '_blank');
};

function navigate(view) {
  view = view || 'dashboard';
  if (view === 'orderlookup') view = 'dashboard';
  // Restricted views (Data Quality and selected System Settings tools) are privileged-only. Non-privileged
  // users who reach them via an old hash/bookmark are redirected to the dashboard.
  if (viewLevel(view) === 'none') {
    toast('You do not have access to that section.', 'warn');
    view = (viewLevel('dashboard') === 'none') ? 'mywork' : 'dashboard';
    // final fallback: first visible nav item
    if (viewLevel(view) === 'none') {
      const firstVisible = [...document.querySelectorAll('.nav-item[data-view]')]
        .map(i => i.getAttribute('data-view')).find(v => viewLevel(v) !== 'none');
      if (firstVisible) view = firstVisible;
    }
  }
  state.view = view;
  location.hash = view;
  $$('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  const breadcrumb = {
    'dashboard': 'Dashboard',
    'mywork': 'My Work',
    'teamwork': 'Team Work',
    'orders-foreign-technical': 'Technical',
    'orders-foreign-indirect': 'Indirect',
    'orders-foreign-supplychain': 'Supply Chain',
    'orders-local-technical': 'Technical',
    'orders-local-indirect': 'Indirect',
    'orders-local-supplychain': 'Supply Chain',
    'shipments': 'Import / Inbound',
    'containers': 'Container Tracker',
    'partials': 'Partial Shipment Control',
    'clearance': 'Clearance Readiness',
    'exports': 'Exports / Outbound',
    'payments': 'Payment Requests',
    'forecast': 'Forthcoming Payments',
    'paymentexposure': 'Payment Exposure',
    'taxprovision': 'Tax Provision Forecast — TEPS',
    'documents': 'Documents',
    'closedorders': 'Closed Orders',
    'suppliers': 'Suppliers',
    'officers': 'Officers & Roles',
    'erpimportrules': 'ERP Import Rules',
    'workingcalendars': 'Working Calendars',
    'reports': 'Reports & Export',
    'mgmtcockpit': 'Management Cockpit',
    'otifrisk': 'OTIF Risk Forecast',
    'workload': 'Officer Workload',
    'opcalendar': 'Operational Calendar',
    'managementpack': 'Management Pack',
    'dqcockpit': 'Data Quality Cockpit',
    'scorecards': 'Supplier Scorecards',
    'exceptions': 'Exceptions',
    'kpitrends': 'KPI Trends',
    'erprecon': 'ERP Reconciliation'
  };
  // Sidebar section each view sits under (drives the breadcrumb hierarchy + headings).
  const navSection = {
    'dashboard': 'Workbench', 'mywork': 'Workbench', 'teamwork': 'Workbench',
    'orders-foreign-technical': 'Foreign Orders', 'orders-foreign-indirect': 'Foreign Orders', 'orders-foreign-supplychain': 'Foreign Orders',
    'orders-local-technical': 'Local Orders', 'orders-local-indirect': 'Local Orders', 'orders-local-supplychain': 'Local Orders',
    'shipments': 'Logistics Operations',
    'containers': 'Logistics Operations', 'partials': 'Logistics Operations', 'clearance': 'Logistics Operations', 'exports': 'Logistics Operations',
    'payments': 'Finance Control', 'forecast': 'Finance Control', 'paymentexposure': 'Finance Control', 'taxprovision': 'Finance Control',
    'closedorders': 'Records & Archives', 'documents': 'Records & Archives',
    'suppliers': 'Reports & Controls',
    'officers': 'System Settings', 'erprecon': 'System Settings', 'erpimportrules': 'System Settings', 'workingcalendars': 'System Settings',
    'reports': 'Reports & Controls', 'mgmtcockpit': 'Reports & Controls', 'otifrisk': 'Reports & Controls',
    'workload': 'Reports & Controls', 'opcalendar': 'Reports & Controls', 'managementpack': 'Reports & Controls',
    'dqcockpit': 'Reports & Controls', 'scorecards': 'Reports & Controls', 'exceptions': 'Reports & Controls', 'kpitrends': 'Reports & Controls'
  };
  window.__navSection = navSection;
  const sec = navSection[view];
  const label = breadcrumb[view] || view;
  $('#breadcrumb').innerHTML = sec ? `<span class="crumb-section">${sec}</span><span class="crumb-sep">›</span><span class="current">${label}</span>` : `<span class="current">${label}</span>`;
  // close print view if open
  $('#print-view').classList.remove('show');
  // render view
  renderView(view);
}
window.navigate = navigate;

const CONTROL_SUMMARY_VIEWS = ['mgmtcockpit', 'otifrisk', 'workload', 'partials', 'clearance', 'paymentexposure', 'opcalendar', 'managementpack'];
function isControlSummaryView(view) { return CONTROL_SUMMARY_VIEWS.includes(view); }

/* ============================================================
   REAL-TIME DATA SUBSCRIPTIONS
   ============================================================ */
function subscribeAll() {
  state.unsubs.forEach(u => u && u());
  state.unsubs = [];

  state.unsubs.push(onSnapshot(query(collection(db, 'orders'), orderBy('dateOfOrder', 'desc')),
    snap => {
      state.data.orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (window.__flagWriteOk) window.__flagWriteOk();
      updateCounts();
      if (state.view === 'dashboard' || state.view === 'mywork' || state.view.startsWith('orders-') || state.view === 'reports' || state.view === 'documents' || state.view === 'closedorders' || state.view === 'dqcockpit' || isControlSummaryView(state.view)) renderView(state.view);
    },
    err => console.error('orders sub error', err)));

  state.unsubs.push(onSnapshot(query(collection(db, 'shipments'), orderBy('createdAt', 'desc')),
    snap => {
      state.data.shipments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateCounts();
      if (['dashboard','mywork','shipments','reports','dqcockpit'].includes(state.view) || isControlSummaryView(state.view)) renderView(state.view);
    },
    err => console.error('shipments sub error', err)));

  state.unsubs.push(onSnapshot(query(collection(db, 'payment_requests'), orderBy('createdAt', 'desc')),
    snap => {
      state.data.payments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateCounts();
      if (['dashboard','mywork','payments','reports','dqcockpit'].includes(state.view) || isControlSummaryView(state.view)) renderView(state.view);
    },
    err => console.error('payments sub error', err)));

  state.unsubs.push(onSnapshot(query(collection(db, 'suppliers'), orderBy('name')),
    snap => {
      state.data.suppliers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateCounts();
      if (state.view === 'suppliers') renderView('suppliers');
      if (state.view === 'dqcockpit') renderView('dqcockpit');
      if (isControlSummaryView(state.view)) renderView(state.view);
    },
    err => console.error('suppliers sub error', err)));

  state.unsubs.push(onSnapshot(query(collection(db, 'officers'), orderBy('fullName')),
    snap => {
      state.data.officers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (state.view === 'officers') renderView('officers');
      if (isControlSummaryView(state.view)) renderView(state.view);
    },
    err => console.error('officers sub error', err)));

  state.unsubs.push(onSnapshot(query(collection(db, 'system_config'), where('configKey', '==', 'erp_import_rules')),
    snap => {
      const configs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const config = configs[0] || null;
      state.importRuleConfigId = config ? config.id : null;
      state.data.importRules = config && Array.isArray(config.rules) ? config.rules : [];
      if (state.view === 'erpimportrules') renderView('erpimportrules');
    },
    err => console.error('ERP import rules configuration sub error', err)));

  state.unsubs.push(onSnapshot(query(collection(db, 'system_config'), where('configKey', '==', 'business_calendars')),
    snap => {
      const configs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const config = configs[0] || null;
      state.calendarConfigId = config ? config.id : null;
      state.data.businessCalendars = config && Array.isArray(config.calendars) ? config.calendars : [];
      updateCounts();
      if (['workingcalendars', 'dqcockpit', 'mywork'].includes(state.view) || isControlSummaryView(state.view)) renderView(state.view);
    },
    err => console.error('Working calendar configuration sub error', err)));

  state.unsubs.push(onSnapshot(query(collection(db, 'status_log'), orderBy('at', 'desc'), limit(100)),
    snap => {
      state.data.importRuns = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(entry => entry.entryType === 'erp_import_run');
      const importPreviewOpen = state.view === 'erprecon' && $('#erp-import-panel')?.childElementCount;
      if (state.view === 'erprecon' && !importPreviewOpen) renderView('erprecon');
    },
    err => console.error('ERP import history sub error', err)));

  // ---- Phoenix-owned operational collections (documents, follow-ups, issues) ----
  state.unsubs.push(onSnapshot(collection(db, 'documents'),
    snap => {
      state.data.documents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateCounts();
      if (['mywork','reports','documents','dqcockpit'].includes(state.view) || isControlSummaryView(state.view)) renderView(state.view);
      if (window.__refreshDetailSections) window.__refreshDetailSections();
    },
    err => console.error('documents sub error', err)));

  state.unsubs.push(onSnapshot(collection(db, 'followups'),
    snap => {
      state.data.followups = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateCounts();
      if (['mywork','reports','dqcockpit'].includes(state.view) || isControlSummaryView(state.view)) renderView(state.view);
      if (window.__refreshDetailSections) window.__refreshDetailSections();
    },
    err => console.error('followups sub error', err)));

  state.unsubs.push(onSnapshot(collection(db, 'issues'),
    snap => {
      state.data.issues = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateCounts();
      if (['mywork','shipments','reports','dqcockpit'].includes(state.view) || isControlSummaryView(state.view)) renderView(state.view);
      if (window.__refreshDetailSections) window.__refreshDetailSections();
    },
    err => console.error('issues sub error', err)));

  state.unsubs.push(onSnapshot(collection(db, 'updateRequests'),
    snap => {
      state.data.updateRequests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateCounts();
      if (state.view === 'mywork' || state.view === 'shipments' || (state.view && state.view.startsWith('orders-')) || isControlSummaryView(state.view)) renderView(state.view);
      if (window.__refreshDetailSections) window.__refreshDetailSections();
    },
    err => { state.data.updateRequests = state.data.updateRequests || []; console.info('[demo] updateRequests unavailable (empty or restricted) — continuing.'); }));

  state.unsubs.push(onSnapshot(collection(db, 'contactLog'),
    snap => {
      state.data.contactLog = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateCounts();
      if (state.view === 'mywork' || (state.view && state.view.startsWith('orders-')) || isControlSummaryView(state.view)) renderView(state.view);
      if (window.__refreshDetailSections) window.__refreshDetailSections();
    },
    err => { state.data.contactLog = state.data.contactLog || []; console.info('[demo] contactLog unavailable (empty or restricted) — continuing.'); }));

  state.unsubs.push(onSnapshot(collection(db, 'kpiSnapshot'),
    snap => {
      state.data.kpiSnapshot = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (state.view === 'kpitrends') renderView(state.view);
    },
    err => { state.data.kpiSnapshot = state.data.kpiSnapshot || []; console.info('[demo] kpiSnapshot unavailable (empty or restricted) — continuing.'); }));

  state.unsubs.push(onSnapshot(collection(db, 'exports'),
    snap => {
      state.data.exports = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (typeof updateCounts === 'function') updateCounts();
      if (state.view === 'exports') renderView(state.view);
    },
    err => { state.data.exports = state.data.exports || []; console.info('[demo] exports unavailable (empty or restricted) — continuing.'); }));
}

/* ============================================================
   PXView + PXCards — card-first interface engine (UI refinement)
   ============================================================
   PXView: per-list Cards/Table view mode, persisted in localStorage (default cards).
   PXCards: a consistent, scan-friendly card + card-grid renderer used by every list
   that offers a card view. Cards are never nested; one record per card. */
window.PXView = {
  mode(key) { try { return localStorage.getItem('phoenix_view_' + key) || 'cards'; } catch (_) { return 'cards'; } },
  set(key, m) { try { localStorage.setItem('phoenix_view_' + key, m); } catch (_) {} },
  toggle(key) {
    const m = this.mode(key);
    return `<div class="view-toggle" data-viewtoggle="${key}" role="group" aria-label="View mode">
      <button class="vt-btn ${m === 'cards' ? 'active' : ''}" data-vmode="cards" title="Card view" aria-pressed="${m === 'cards'}">▦ Cards</button>
      <button class="vt-btn ${m === 'table' ? 'active' : ''}" data-vmode="table" title="Table view" aria-pressed="${m === 'table'}">☰ Table</button>
    </div>`;
  },
  // Bind toggle clicks within `root` (defaults to document) to re-render.
  bind(key, rerender, root) {
    (root || document).querySelectorAll(`[data-viewtoggle="${key}"] [data-vmode]`).forEach(b =>
      b.addEventListener('click', () => { window.PXView.set(key, b.dataset.vmode); rerender(); }));
  }
};

window.PXCards = {
  // spec: { ref, entity, entityAccent, title, supplier, statusBadge:{text,cls},
  //         severity:{text,cls}, badges:[{text,cls}], dates:[{label,value,overdue}],
  //         amount(formatted string), owner, note, onclick(string), actionLabel }
  card(spec) {
    const esc = window.PXUtils.escapeHtml;
    const badges = [];
    if (spec.statusBadge) badges.push(`<span class="badge ${spec.statusBadge.cls || 'neutral'}">${esc(spec.statusBadge.text)}</span>`);
    if (spec.severity) badges.push(`<span class="badge ${spec.severity.cls || 'neutral'}">${esc(spec.severity.text)}</span>`);
    (spec.badges || []).forEach(b => badges.push(`<span class="badge ${b.cls || 'neutral'}">${esc(b.text)}</span>`));
    const dates = (spec.dates || []).filter(d => d.value).map(d => `<span class="px-card-date${d.overdue ? ' overdue' : ''}">${esc(d.label)}: ${esc(d.value)}</span>`).join('');
    const oc = spec.onclick ? `onclick="${spec.onclick}"` : '';
    const actions = (spec.actions || []).map(a =>
      `<button class="btn btn-sm ${a.cls || ''}" onclick="event.stopPropagation(); ${a.onclick || ''}">${esc(a.label || 'Action')}</button>`
    ).join('');
    return `<div class="px-card"${spec.onclick ? ' tabindex="0" role="button"' : ''} ${oc}>
      <div class="px-card-top">
        <span class="px-card-ref mono">${esc(spec.ref || '')}</span>
        ${spec.entity ? `<span class="px-card-ent"${spec.entityAccent ? ` style="background:${spec.entityAccent};color:#fff;border-color:${spec.entityAccent}"` : ''}>${esc(spec.entity)}</span>` : ''}
      </div>
      ${spec.title ? `<div class="px-card-title">${esc(spec.title)}</div>` : ''}
      ${spec.supplier ? `<div class="px-card-supplier">${esc(spec.supplier)}</div>` : ''}
      ${badges.length ? `<div class="px-card-badges">${badges.join('')}</div>` : ''}
      ${dates ? `<div class="px-card-dates">${dates}</div>` : ''}
      ${spec.note ? `<div class="px-card-note">${esc(spec.note)}</div>` : ''}
      <div class="px-card-foot">
        <div class="px-card-meta">${spec.amount != null ? `<span class="px-card-amount">${esc(spec.amount)}</span>` : ''}${spec.owner ? `<span class="px-card-owner">👤 ${esc(spec.owner)}</span>` : ''}</div>
        ${actions}
        ${spec.onclick ? `<button class="btn btn-sm" onclick="event.stopPropagation(); ${spec.onclick}">${esc(spec.actionLabel || 'Open')}</button>` : ''}
      </div>
    </div>`;
  },
  grid(cardsHtml, emptyMsg) { return cardsHtml ? `<div class="px-card-grid">${cardsHtml}</div>` : `<div class="empty-state" style="padding:32px"><div class="ic">▦</div><h3>${window.PXUtils.escapeHtml(emptyMsg || 'Nothing to show')}</h3></div>`; }
};

function updateCounts() {
  const ent = currentEntity();
  // entity of a shipment/payment follows its linked order (own entity field as fallback)
  const orderEntityByOrderId = oid => { const o = state.data.orders.find(x => x.orderId === oid); return o ? recordEntity(o) : null; };
  const shipEntity = s => s.entity || orderEntityByOrderId(s.orderId) || 'Phoenix';
  const payEntity  = p => p.entity || orderEntityByOrderId(p.orderId) || 'Phoenix';

  // Compute counts per function for both foreign and local — SCOPED TO CURRENT ENTITY
  const fnCounts = { foreign: { technical: 0, indirect: 0, supplychain: 0 },
                     local:   { technical: 0, indirect: 0, supplychain: 0 } };
  state.data.orders.forEach(o => {
    if (o.archived || o.isClosed) return;
    if (recordEntity(o) !== ent) return;
    const fn = orderFunction(o);
    if (fn && fnCounts[o.orderType]) {
      fnCounts[o.orderType][fn] = (fnCounts[o.orderType][fn] || 0) + 1;
    }
  });
  ['technical','indirect','supplychain'].forEach(fn => {
    const fEl = $('#count-foreign-'+fn); if (fEl) fEl.textContent = fnCounts.foreign[fn];
    const lEl = $('#count-local-'+fn);   if (lEl) lEl.textContent = fnCounts.local[fn];
  });
  const activeShip = state.data.shipments.filter(s => !s.archived && !(s.completed || s.stage === 'completed') && shipEntity(s) === ent).length;
  const openPay = state.data.payments.filter(p => !p.archived && !['paid', 'rejected'].includes(p.status) && payEntity(p) === ent).length;
  const shipEl = $('#count-shipments'); if (shipEl) shipEl.textContent = activeShip;
  // Exports: badge shows overdue returns (attention) when any, else blank.
  const expEl = $('#count-exports');
  if (expEl) { const n = (window.__exportsOverdueCount ? window.__exportsOverdueCount() : 0); expEl.textContent = n || ''; expEl.style.display = n ? '' : 'none'; }
  const payEl = $('#count-payments'); if (payEl) payEl.textContent = openPay;
  const activeSuppliers = state.data.suppliers.filter(s => !s.archived && s.active !== false && recordEntity(s) === ent).length;
  const supEl = $('#count-suppliers'); if (supEl) supEl.textContent = activeSuppliers;
  const closedCount = state.data.orders.filter(o => !o.archived && o.isClosed && recordEntity(o) === ent).length;
  const closedEl = $('#count-closedorders'); if (closedEl) closedEl.textContent = closedCount;
  // Documents badge: number of PO folders (current entity) that hold at least one stored file.
  const entOrderIds = new Set(state.data.orders.filter(o => !o.archived && recordEntity(o) === ent).map(o => o.id));
  const entShipIds = new Set(state.data.shipments.filter(s => !s.archived && recordEntity(s) === ent).map(s => s.id));
  const entPayIds = new Set(state.data.payments.filter(p => !p.archived && recordEntity(p) === ent).map(p => p.id));
  const activeDocs = (state.data.documents || []).filter(d => !d.archived &&
    ((d.relatedType === 'order' && entOrderIds.has(d.relatedId)) ||
     (d.relatedType === 'shipment' && entShipIds.has(d.relatedId)) ||
     (d.relatedType === 'payment' && entPayIds.has(d.relatedId)))).length;
  const docEl = $('#count-documents'); if (docEl) docEl.textContent = activeDocs;

  // My Work badge — PER-ENTITY, computed by the SAME function the My Work page uses
  // (window.__myWorkCount), so the badge can never disagree with the page. It counts
  // the actionable items (overdue + due-soon + upcoming) for the active sidebar entity.
  if (window.__myWorkCount) {
    const mwEl = $('#count-mywork'); if (mwEl) mwEl.textContent = window.__myWorkCount();
    const twEl = $('#count-teamwork'); if (twEl && window.__teamWorkCount) { const n = window.__teamWorkCount(); twEl.textContent = n; twEl.style.display = n ? '' : 'none'; }
  }
  if (window.__forecastCount) {
    const fcEl = $('#count-forecast'); if (fcEl) fcEl.textContent = window.__forecastCount();
  }
  if (window.__taxProvisionCount) {
    const tpEl = $('#count-taxprovision'); if (tpEl) tpEl.textContent = window.__taxProvisionCount();
  }
  if (window.__demurrageAtRiskCount) {
    const ctEl = $('#count-containers');
    if (ctEl) ctEl.textContent = window.__demurrageAtRiskCount()
      || state.data.shipments.filter(s => !s.archived && !s.completed && s.portArrivalDate && (s.entity || 'Phoenix') === ent).length;
  }
  if (window.__dqCriticalCount) {
    const dqEl = $('#count-dqcockpit'); if (dqEl) dqEl.textContent = window.__dqCriticalCount();
  }
  if (window.__exceptionsCount) {
    const exEl = $('#count-exceptions'); if (exEl) { const n = window.__exceptionsCount(); exEl.textContent = n; exEl.style.display = n ? '' : 'none'; }
  }
  if (window.__mgmtCockpitCount) {
    const el = $('#count-mgmtcockpit'); if (el) { const n = window.__mgmtCockpitCount(); el.textContent = n; el.style.display = n ? '' : 'none'; }
  }
  if (window.__otifRiskCount) {
    const el = $('#count-otifrisk'); if (el) { const n = window.__otifRiskCount(); el.textContent = n; el.style.display = n ? '' : 'none'; }
  }
  if (window.__clearanceRiskCount) {
    const el = $('#count-clearance'); if (el) { const n = window.__clearanceRiskCount(); el.textContent = n; el.style.display = n ? '' : 'none'; }
  }
  if (window.__paymentExposureCount) {
    const el = $('#count-paymentexposure'); if (el) { const n = window.__paymentExposureCount(); el.textContent = n; el.style.display = n ? '' : 'none'; }
  }
}
window.updateCounts = updateCounts;

/* placeholder for view rendering — implemented in subsequent script blocks */
window.renderView = function(view) {
  // Ensure the correct section is the visible one before rendering into it. This
  // guards against any re-render path (entity switch, data subscription) leaving a
  // different section active, which could show stale/empty content.
  const targetEl = view ? document.getElementById('view-' + view) : null;
  if (view) {
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  }
  if (targetEl && view && view.startsWith('orders-')) {
    const renderedEntity = targetEl.dataset.renderEntity || '';
    const activeEntity = currentEntity();
    if (renderedEntity && renderedEntity !== activeEntity) {
      targetEl.innerHTML = '<div class="empty-state" style="padding:32px"><h3>Refreshing entity view...</h3></div>';
    }
  }
  if (window.__renderers && window.__renderers[view]) {
    try {
      window.__renderers[view]();
    } catch (error) {
      console.error('Render failed for view', view, error);
      if (targetEl) {
        targetEl.innerHTML = '<div class="empty-state" style="padding:32px"><h3>Could not render this view</h3><p>Please refresh the page. The old entity list was cleared to avoid showing incorrect data.</p></div>';
      }
      if (typeof toast === 'function') toast('Could not render the current view. Please refresh the page.', 'danger');
    }
  }
  // After any view renders, make its data tables resizable (widths persist per table).
  if (window.__installColumnResizers) setTimeout(() => window.__installColumnResizers(), 0);
};
window.__renderers = {};
window.__state = state;
window.__db = db;
window.__auth = auth;
window.REF = REF;
// Firestore primitives exposed so the separate firestoreStore.js module can use them.
window.__fs = { collection, doc, addDoc, updateDoc, deleteDoc, getDoc, getDocs, serverTimestamp, runTransaction };

// Export utility funcs for further script blocks
window.PXUtils = {
  $, $$, fmtDate, fmtDateISO, parseDate, fmtMoney, daysBetween, escapeHtml,
  debounce, bindSearchInput, clearSearchInputTimers, toast, showLoader, statusBadgeClass,
  statusOptionsHtml, orderStatusOptionsHtml, shipmentStatusOptionsHtml,
  mapErpPoStatus,
  nextShipmentSequence, makeShipmentSequenceId,
  shipmentSequence, shipmentBelongsToOrder, hasLaterShipmentForOrder, shipmentFollowupActionOpen,
  collection, doc, addDoc, setDoc, getDoc, updateDoc, deleteDoc, query, where, orderBy,
  limit, serverTimestamp, runTransaction, getDocs,
  // milestone helpers added below
  allocateMilestoneAmounts, milestoneAmountsLookPercentDerived,
  generateMilestonesFromTerm, computeMilestoneDate, milestoneStatus,
  // function helpers
  orderFunction, functionForCategory, orderNeedsShipment,
  // permission helpers
  canEditOrders, canEditShipments, canManageShipments, canReassignOrders,
  can, currentRole, isPrivileged,
  currentEntity, setCurrentEntity, entityMeta, recordEntity,
  // generic column manager
  cmGetColumns, cmRenderTable, cmOpenManager, cmExportCSV,
  // shipment quantity formatter
  fmtQuantityLines,
  // duplicate + data-quality helpers
  checkOrderDuplicates, checkRfpDuplicates, checkShipmentDuplicates,
  // Data quality & record health are added to PXUtils by src/dataQuality.js
  normalizeStr, stringSimilarity,
  // timeline
  buildOrderTimeline,
  // ERP field ownership
  isErpOrder, fieldEditable, erpFieldClass, erpSourceOf, erpBadgeFor, renderErpBadge,
  // PO lines (additive)
  orderLineSum, orderHasLines, stripUndefined,
  // Supplier performance moved to suppliers.service.js (re-attached to PXUtils there)
  // Expected-document resolver (configurable rules)
  expectedDocsFor
};

/* ============================================================
   PO LINE-LEVEL HELPERS (additive — order.amount stays the master)
   ============================================================
   ERP purchase orders usually have multiple lines. Phoenix stores them as an
   optional `lines[]` array on an order, populated by the future ERP plug-in.
   When present they are DISPLAYED; they do not override the single order amount. */
function orderHasLines(o) {
  return o && Array.isArray(o.lines) && o.lines.length > 0;
}
// Resolve the expected documents for a record in a given context, applying the
// conditional rules (shipment mode, order type, foreign/local, function...).
// Returns a de-duplicated array of document type names.
function expectedDocsFor(context, record) {
  const base = (REF.expectedDocuments && REF.expectedDocuments[context]) || [];
  const out = base.slice();
  const rules = (REF.expectedDocumentRules && REF.expectedDocumentRules[context]) || [];
  const ctx = Object.assign({}, record || {});
  if (context === 'shipment') {
    if (ctx.mode == null && ctx.shipmentMode) ctx.mode = ctx.shipmentMode;
    if (ctx.foreign == null && record) {
      const ord = (window.__state.data.orders || []).find(o => o.orderId === record.orderId);
      ctx.foreign = ord ? (ord.orderType === 'foreign') : undefined;
    }
  }
  rules.forEach(rule => {
    const when = rule.when || {};
    const matches = Object.keys(when).every(k => {
      if (k === 'function' && context === 'order') return orderFunction(record) === when[k];
      return ctx[k] === when[k];
    });
    if (matches) (rule.docs || []).forEach(d => { if (!out.includes(d)) out.push(d); });
  });
  return out;
}
// Firestore rejects `undefined`. Recursively convert any undefined value to null
// so updateDoc/addDoc/setDoc never throw "Unsupported field value: undefined".
function stripUndefined(obj) {
  if (Array.isArray(obj)) return obj.map(stripUndefined);
  if (obj && typeof obj === 'object' && !(obj.toDate) && !(obj instanceof Date)) {
    const out = {};
    for (const k in obj) out[k] = (obj[k] === undefined ? null : stripUndefined(obj[k]));
    return out;
  }
  return obj === undefined ? null : obj;
}
// Sum of line amounts (lineAmount, or quantity*unitCost as fallback)
function orderLineSum(o) {
  if (!orderHasLines(o)) return null;
  return o.lines.reduce((s, l) => {
    const amt = (l.lineAmount != null) ? Number(l.lineAmount)
              : (l.quantity != null && l.unitCost != null) ? Number(l.quantity) * Number(l.unitCost)
              : 0;
    return s + (isNaN(amt) ? 0 : amt);
  }, 0);
}


/* ============================================================
   ERP FIELD-OWNERSHIP HELPERS
   ============================================================ */
// Resolve the ERP source of a record, with backward-compat for the
// earlier prototype scheme (source: 'manual'|'erp').
function erpSourceOf(o) {
  if (!o) return 'Manual';
  if (o.erpSource) return o.erpSource;            // new scheme
  if (o.source === 'erp') return 'Navision';      // legacy → assume Navision
  return 'Manual';
}
// Is this record sourced from an ERP (not manual)?
function isErpOrder(o) {
  const s = erpSourceOf(o);
  return s === 'Navision' || s === 'Business Central';
}
// Can the current app user edit this field on this order?
//  - manual records: everything editable (as today)
//  - erp records: erpLocked fields are read-only; erpFillOnce + appOwned editable
function fieldEditable(o, fieldKey) {
  // Delegate to the centralised ownership module when available (single source of truth);
  // fall back to the inline rule if it hasn't loaded yet (load-order safety).
  if (window.PXOwnership) return window.PXOwnership.isEditable(o, fieldKey);
  if (!isErpOrder(o)) return true;
  if (REF.erpOwnership.erpLocked.includes(fieldKey)) return false;
  return true;
}
function erpFieldClass(o, fieldKey) {
  return (!fieldEditable(o, fieldKey)) ? 'erp-locked' : '';
}
// Decide which badge a record should show (source + sync status + staleness)
function erpBadgeFor(o) {
  const src = erpSourceOf(o);
  if (src === 'Manual') return REF.erpBadges.Manual;
  const st = o.erpSyncStatus;
  if (st === 'error') return REF.erpBadges.error;
  if (st === 'pending') return REF.erpBadges.pending;
  // staleness: synced more than 2 days ago
  if (o.erpLastSyncedAt) {
    const d = o.erpLastSyncedAt.toDate ? o.erpLastSyncedAt.toDate() : new Date(o.erpLastSyncedAt);
    if (!isNaN(d) && (Date.now() - d.getTime()) > 2 * 86400000) return REF.erpBadges.stale;
  }
  return REF.erpBadges[src] || REF.erpBadges.Manual;
}
// Render a badge HTML snippet
function renderErpBadge(o, small) {
  const b = erpBadgeFor(o);
  const sz = small ? 'font-size:8px;padding:0 4px' : 'font-size:10px;padding:1px 7px';
  return `<span class="erp-badge erp-badge-${b.cls}" style="${sz}" title="${b.label}">${b.icon} ${small ? '' : b.label}</span>`;
}

/* ============================================================
   buildOrderTimeline — derive a chronological event list for an order
   from existing order / shipment / payment / milestone data.
   Pure read; writes nothing. Returns [{ date, label, detail, kind }]
   kind: 'done' (has a real past/known date) | 'pending' (expected, no date)
============================================================ */
function buildOrderTimeline(o, allShipments, allPayments) {
  const events = [];
  const D = v => v?.toDate ? v.toDate() : (v ? new Date(v) : null);
  const push = (date, label, detail, kind) => events.push({ date: date || null, label, detail: detail || '', kind: kind || (date ? 'done' : 'pending') });

  // Order lifecycle
  push(D(o.dateOfOrder), 'Order created', o.orderId, 'done');
  if (o.iprApprovedDate) push(D(o.iprApprovedDate), 'IPR HOD approved', o.iprNumber || '', 'done');
  if (o.orderAcknowledgedDate) push(D(o.orderAcknowledgedDate), 'Order acknowledged by supplier', '', 'done');
  if (o.orderType === 'foreign' && o.orderReadyDate) push(D(o.orderReadyDate), 'Order ready at supplier', '', 'done');

  // Shipments
  const ships = allShipments.filter(s => s.orderId === o.orderId);
  ships.forEach(s => {
    const tag = s.shipmentId || o.orderId;
    if (s.requestedAt) push(D(s.requestedAt), 'Shipment requested', tag, 'done');
    if (s.logisticOfficer && (s.stage === 'assigned' || s.stage === 'in_progress' || s.stage === 'completed')) {
      // no explicit assign date stored; attach to requestedAt-ish or leave undated
      push(null, 'Shipment assigned', `${tag} → ${s.logisticOfficer}`, 'done');
    }
    if (s.etd) push(D(s.etd), 'ETD (departure)', tag, 'done');
    if (s.eta) push(D(s.eta), 'ETA (arrival)', tag, D(s.eta) && D(s.eta) > new Date() ? 'pending' : 'done');
    if (s.clearanceDate) push(D(s.clearanceDate), 'Customs cleared', tag, 'done');
    if (s.deliveryDate) push(D(s.deliveryDate), 'Delivered to site / warehouse', tag, 'done');
    if (s.grnDate) push(D(s.grnDate), 'Goods received (GRN)', `${tag}${s.grnNumber ? ' · ' + s.grnNumber : ''}`, 'done');
  });

  (Array.isArray(o.receipts) ? o.receipts : []).forEach(r => {
    const status = String(r.status || '').toLowerCase();
    if (status === 'pending' || status === 'cancelled') return;
    const d = D(r.actualReceiptDate) || D(r.grnDate);
    if (d) push(d, 'Goods received (GRN)', `${r.shipmentId ? 'Shipment ' + r.shipmentId + ' · ' : ''}${r.grnRef || r.grnNumber || ''}`, 'done');
  });

  // Payments / milestones
  const pays = allPayments.filter(p => p.orderId === o.orderId);
  pays.forEach(p => {
    if (p.requestDate) push(D(p.requestDate), 'RFP raised', p.rfpRef || '', 'done');
    if (p.status === 'paid') {
      const paidDate = D(p.iblValueDate) || D(p.requestDate);
      push(paidDate, 'Payment made', `${p.rfpRef || ''}${p.amount ? ' · ' + (p.currency||'') + ' ' + p.amount : ''}`, 'done');
    }
  });

  // Closure
  if (o.isClosed) push(D(o.updatedAt) || null, 'Order closed', '', 'done');

  // Sort: dated events chronologically; undated ('pending'/no-date) go to the end
  events.sort((a, b) => {
    if (a.date && b.date) return a.date - b.date;
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    return 0;
  });
  return events;
}

/* ============================================================
   DUPLICATE DETECTION + DATA QUALITY HELPERS
   ============================================================ */
function normalizeStr(s) {
  return (s || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
}
// Simple similarity: ratio of shared bigrams (Dice coefficient). 0..1
function stringSimilarity(a, b) {
  a = normalizeStr(a); b = normalizeStr(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const bigrams = s => { const m = new Map(); for (let i=0;i<s.length-1;i++){const g=s.slice(i,i+2);m.set(g,(m.get(g)||0)+1);} return m; };
  const ma = bigrams(a), mb = bigrams(b);
  let overlap = 0;
  ma.forEach((cnt, g) => { if (mb.has(g)) overlap += Math.min(cnt, mb.get(g)); });
  return (2 * overlap) / ((a.length-1) + (b.length-1));
}

// Returns an array of warning strings (empty = no duplicates suspected)
function checkOrderDuplicates(data, allOrders, isEdit, currentId) {
  const warnings = [];
  const others = allOrders.filter(o => o.id !== currentId);
  // Same order number
  if (data.orderId) {
    const exact = others.find(o => normalizeStr(o.orderId) === normalizeStr(data.orderId));
    if (exact) warnings.push(`Order number "${data.orderId}" already exists (supplier: ${exact.supplier || '—'}).`);
  }
  // Similar supplier + same amount within recent — possible re-entry
  if (data.supplier && data.amount) {
    const sim = others.find(o => o.supplier && stringSimilarity(o.supplier, data.supplier) > 0.85 && Number(o.amount) === Number(data.amount) && o.currency === data.currency && !o.isClosed);
    if (sim) warnings.push(`An open order with a very similar supplier ("${sim.supplier}") and the same amount (${data.currency} ${data.amount}) already exists: ${sim.orderId}. Possible duplicate?`);
  }
  return warnings;
}

function checkRfpDuplicates(data, allPayments, isEdit, currentId) {
  const warnings = [];
  const others = allPayments.filter(p => p.id !== currentId);
  // Same invoice number for same supplier
  if (data.invoiceNumber && data.supplier) {
    const dup = others.find(p => p.invoiceNumber && normalizeStr(p.invoiceNumber) === normalizeStr(data.invoiceNumber) && stringSimilarity(p.supplier, data.supplier) > 0.8);
    if (dup) warnings.push(`Invoice "${data.invoiceNumber}" was already used on RFP ${dup.rfpRef || dup.id} for a similar supplier. Possible duplicate payment?`);
  }
  // RFP already raised for the same milestone
  if (data.milestoneId) {
    const dup = others.find(p => p.milestoneId === data.milestoneId && !['rejected'].includes(p.status));
    if (dup) warnings.push(`An RFP (${dup.rfpRef || dup.id}) is already linked to this milestone. Raising another may double-pay it.`);
  }
  // Multiple active RFPs for the same order without milestones
  if (data.orderId && !data.milestoneId) {
    const sameOrder = others.filter(p => p.orderId === data.orderId && !['paid','rejected'].includes(p.status));
    if (sameOrder.length) warnings.push(`${sameOrder.length} other active RFP(s) already exist for order ${data.orderId}. Confirm this isn't a duplicate.`);
  }
  return warnings;
}

function checkShipmentDuplicates(data, allShipments, isEdit, currentId) {
  const warnings = [];
  const others = allShipments.filter(s => s.id !== currentId);
  if (data.shipmentId) {
    const exact = others.find(s => normalizeStr(s.shipmentId) === normalizeStr(data.shipmentId));
    if (exact) warnings.push(`Shipment ID "${data.shipmentId}" is already in use (order: ${exact.orderId || '—'}).`);
  }
  return warnings;
}

// Data-quality & record-health helpers (orderDataQuality, shipmentDataQuality,
// rfpDataQuality, orderHealth) were extracted to src/dataQuality.js. They are
// exposed on window.PXUtils by that module.

/* Format a shipment's quantity lines array into a readable string.
   Lines shape: [{ qty: 2, unit: 'Wooden Crate(s)' }, { qty: 1, unit: 'Carton(s)' }]
   Falls back to legacy string `quantity` if present. */
function fmtQuantityLines(shipment) {
  const lines = shipment && Array.isArray(shipment.quantityLines) ? shipment.quantityLines : null;
  if (lines && lines.length) {
    return lines.filter(l => l && (l.qty || l.unit))
      .map(l => `${l.qty != null ? l.qty : ''} ${l.unit || ''}`.trim())
      .join(' + ');
  }
  // legacy single free-text quantity (older shipments, or migrated)
  if (shipment && shipment.quantity) return String(shipment.quantity);
  return '';
}

/* ============================================================
   GENERIC COLUMN MANAGER — reusable across all list tables
   ============================================================
   A "column def" is: { key, label, num?, defaultVisible?, render(row, ctx) }
   Each table is identified by a storageKey (e.g. 'shipments', 'suppliers').
   Per-user prefs (order + visibility) saved to localStorage.
============================================================ */
function cmLoadPrefs(storageKey) {
  try { const raw = localStorage.getItem('phoenix_cols_' + storageKey); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
function cmSavePrefs(storageKey, prefs) {
  localStorage.setItem('phoenix_cols_' + storageKey, JSON.stringify(prefs));
}
// Returns columns in the user's saved order, with saved visibility applied.
function cmGetColumns(storageKey, defs) {
  // Clone defs so we don't mutate the originals
  const base = defs.map(d => ({ ...d, visible: d.defaultVisible !== false }));
  const prefs = cmLoadPrefs(storageKey);
  if (!prefs) return base;
  const ordered = [];
  (prefs.order || []).forEach(key => {
    const col = base.find(c => c.key === key);
    if (col) {
      if (prefs.visible && prefs.visible[key] !== undefined) col.visible = prefs.visible[key];
      ordered.push(col);
    }
  });
  base.forEach(col => { if (!ordered.find(c => c.key === col.key)) ordered.push(col); });
  return ordered;
}
// Render a full table (thead + tbody) given visible columns, rows, and a row-click handler name.
function cmRenderTable(storageKey, defs, rows, ctx, opts = {}) {
  const cols = cmGetColumns(storageKey, defs).filter(c => c.visible);
  const onRowClick = opts.onRowClick || null; // function name string taking row id
  const idField = opts.idField || 'id';
  const emptyHtml = opts.emptyHtml || `<tr><td colspan="${cols.length}" class="empty-state"><div class="ic">∅</div><h3>Nothing to show</h3></td></tr>`;
  // Persisted per-list column widths
  let widths = {};
  try { widths = JSON.parse(localStorage.getItem('phoenix_colw_' + storageKey) || '{}'); } catch (_) { widths = {}; }
  const thWidth = c => widths[c.key] ? ` style="width:${widths[c.key]}px"` : '';
  return `
    <div class="table-wrap"><div class="table-scroll">
      <table class="data resizable" data-colw="${escapeHtml(storageKey)}">
        <thead><tr>${cols.map(c => `<th class="${c.num?'num ':''}col-${escapeHtml(c.key)}" data-colkey="${escapeHtml(c.key)}"${thWidth(c)}>${escapeHtml(c.label)}<span class="col-resize" data-resize="${escapeHtml(c.key)}"></span></th>`).join('')}</tr></thead>
        <tbody>
          ${rows.length === 0 ? emptyHtml : rows.map(r => `
            <tr ${onRowClick ? `onclick="${onRowClick}('${r[idField]}')"` : ''}>
              ${cols.map(c => `<td${c.num?' class="num"':''}>${c.render(r, ctx)}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div></div>
  `;
}

/* Drag-to-resize for any table.resizable. Widths persist per list in localStorage
   ('phoenix_colw_<storageKey>'). Delegated + idempotent — safe to call after every render. */
function initColumnResize() {
  if (window.__colResizeWired) return;
  window.__colResizeWired = true;
  let active = null; // { th, key, startX, startW, table, storageKey }
  document.addEventListener('mousedown', e => {
    const handle = e.target.closest && e.target.closest('.col-resize');
    if (!handle) return;
    e.preventDefault(); e.stopPropagation();
    const th = handle.closest('th');
    const table = handle.closest('table.resizable');
    if (!th || !table) return;
    active = { th, key: handle.getAttribute('data-resize'), startX: e.pageX, startW: th.offsetWidth,
               table, storageKey: table.getAttribute('data-colw') };
    document.body.classList.add('col-resizing');
  });
  document.addEventListener('mousemove', e => {
    if (!active) return;
    const w = Math.max(60, active.startW + (e.pageX - active.startX));
    active.th.style.width = w + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (!active) return;
    const w = parseInt(active.th.style.width, 10);
    if (w && active.storageKey) {
      let widths = {};
      try { widths = JSON.parse(localStorage.getItem('phoenix_colw_' + active.storageKey) || '{}'); } catch (_) {}
      widths[active.key] = w;
      try { localStorage.setItem('phoenix_colw_' + active.storageKey, JSON.stringify(widths)); } catch (_) {}
    }
    document.body.classList.remove('col-resizing');
    active = null;
  });
}
initColumnResize();
window.__initColumnResize = initColumnResize;
/* Position a column-manager panel anchored to its button but clamped to the viewport,
   so it never overflows the window frame (flips up / shifts left / caps height + scrolls). */
function positionColMgrPanel(panel, anchor) {
  if (!panel || !anchor) return;
  const gap = 6, margin = 12;
  const a = anchor.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const pw = panel.offsetWidth || 280;
  panel.classList.add('cm-fixed');

  // Horizontal: right-align to the button, but keep fully on-screen.
  let left = a.right - pw;
  if (left < margin) left = margin;
  if (left + pw > vw - margin) left = vw - margin - pw;

  // Vertical: prefer below the button; if not enough room, flip above; clamp height.
  const spaceBelow = vh - a.bottom - gap - margin;
  const spaceAbove = a.top - gap - margin;
  let top, maxH;
  if (spaceBelow >= 220 || spaceBelow >= spaceAbove) {
    top = a.bottom + gap;
    maxH = spaceBelow;
  } else {
    // Flip above: cap height to the room above, and sit the panel just above the button.
    maxH = spaceAbove;
    const h = Math.min(panel.scrollHeight, maxH);
    top = a.top - gap - h;
  }
  panel.style.left = left + 'px';
  panel.style.top = Math.max(margin, top) + 'px';
  panel.style.maxHeight = Math.max(160, maxH) + 'px';
}
window.__positionColMgrPanel = positionColMgrPanel;

// Open the drag/drop column manager panel anchored to a button. reRender() re-renders the view.
function cmOpenManager(storageKey, defs, anchor, reRender) {
  document.querySelectorAll('.col-mgr-panel').forEach(p => p.remove());
  const columns = cmGetColumns(storageKey, defs);
  const panel = document.createElement('div');
  panel.className = 'col-mgr-panel';
  panel.innerHTML = `
    <div class="head">Drag to reorder · tick to show</div>
    ${columns.map(c => `
      <div class="col-mgr-item" draggable="true" data-key="${c.key}">
        <span class="grip">⋮⋮</span>
        <input type="checkbox" id="cmcol-${storageKey}-${c.key}" ${c.visible?'checked':''} />
        <label for="cmcol-${storageKey}-${c.key}">${escapeHtml(c.label)}</label>
      </div>`).join('')}
    <div class="col-mgr-foot">
      <button data-act="reset">Reset to defaults</button>
      <button data-act="close">Done</button>
    </div>`;
  anchor.parentElement.appendChild(panel);
  window.__positionColMgrPanel(panel, anchor);

  function currentPrefs() {
    const items = panel.querySelectorAll('.col-mgr-item');
    const order = Array.from(items).map(i => i.dataset.key);
    const visible = {};
    items.forEach(i => { visible[i.dataset.key] = i.querySelector('input').checked; });
    return { order, visible };
  }

  let dragged = null;
  panel.querySelectorAll('.col-mgr-item').forEach(item => {
    item.addEventListener('dragstart', () => { dragged = item; item.classList.add('dragging'); });
    item.addEventListener('dragend', () => { item.classList.remove('dragging'); panel.querySelectorAll('.col-mgr-item').forEach(i => i.classList.remove('drag-over')); });
    item.addEventListener('dragover', e => { e.preventDefault(); if (dragged !== item) item.classList.add('drag-over'); });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', e => {
      e.preventDefault();
      if (dragged !== item) {
        const all = Array.from(panel.querySelectorAll('.col-mgr-item'));
        if (all.indexOf(dragged) < all.indexOf(item)) item.after(dragged); else item.before(dragged);
      }
      item.classList.remove('drag-over');
      setTimeout(() => cmSavePrefs(storageKey, currentPrefs()), 30);
    });
  });
  panel.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => { cmSavePrefs(storageKey, currentPrefs()); reRender(); });
  });
  panel.querySelector('[data-act="close"]').addEventListener('click', () => { cmSavePrefs(storageKey, currentPrefs()); panel.remove(); reRender(); });
  panel.querySelector('[data-act="reset"]').addEventListener('click', () => { localStorage.removeItem('phoenix_cols_' + storageKey); panel.remove(); reRender(); });
  setTimeout(() => {
    document.addEventListener('click', function dismiss(ev) {
      if (!panel.contains(ev.target) && ev.target !== anchor) {
        cmSavePrefs(storageKey, currentPrefs()); panel.remove(); reRender();
        document.removeEventListener('click', dismiss);
      }
    });
  }, 100);
}
// Generic CSV export from column defs (uses raw values, not rendered HTML)
// Export a dataset to a real .xlsx workbook (formatted Excel, not CSV).
// Kept the name cmExportCSV for compatibility; it now produces .xlsx. Two call
// signatures are supported:
//   cmExportCSV(storageKey, defs, rows, filenameBase, ctx)  — column-def driven
//   cmExportCSV(rowsArray, filename)                         — plain objects
function cmExportCSV(a, b, c, d, e) {
  let headers, matrix, filenameBase;
  if (Array.isArray(a)) {
    // simple signature: (rows[], filename)
    const rows = a; filenameBase = b || 'export';
    headers = Object.keys(rows[0] || { Empty: '' });
    matrix = rows.map(r => headers.map(h => r[h]));
  } else {
    // column-def signature: (storageKey, defs, rows, filenameBase, ctx)
    const storageKey = a, defs = b, rows = c; filenameBase = d || 'export'; const ctx = e;
    const cols = cmGetColumns(storageKey, defs).filter(col => col.visible);
    headers = cols.map(col => col.label);
    matrix = rows.map(r => cols.map(col => col.csv ? col.csv(r, ctx) : (col.raw ? col.raw(r) : r[col.key])));
  }
  // Normalise cell values to strings/numbers for Excel.
  const norm = v => {
    if (v === null || v === undefined) return '';
    if (v && v.toDate) return fmtDate(v);
    if (Array.isArray(v)) return v.join('; ');
    return v;
  };
  matrix = matrix.map(row => row.map(norm));
  const fname = `phoenix_${filenameBase}_${new Date().toISOString().slice(0,10)}.xlsx`;
  const blob = buildXlsxBlob(headers, matrix, filenameBase);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = fname; link.click();
  URL.revokeObjectURL(url);
}

// Build a minimal, valid .xlsx (Office Open XML) Blob with a header row + data.
// Pure JS, no library, so the single-file build stays dependency-free.
function buildXlsxBlob(headers, matrix, sheetName) {
  const xmlEsc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const colLetter = n => { let s=''; n++; while(n>0){ const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=(n-m-1)/26|0; } return s; };
  const isNum = v => v !== '' && v !== null && v !== undefined && !isNaN(v) && typeof v !== 'boolean' && String(v).trim() !== '' && /^-?\d+(\.\d+)?$/.test(String(v).trim());
  const cell = (r, ci, v) => {
    const ref = colLetter(ci) + r;
    if (isNum(v)) return `<c r="${ref}"><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  };
  const rowsXml = [];
  rowsXml.push(`<row r="1">${headers.map((h,i)=>`<c r="${colLetter(i)}1" t="inlineStr" s="1"><is><t xml:space="preserve">${xmlEsc(h)}</t></is></c>`).join('')}</row>`);
  matrix.forEach((row, ri) => {
    rowsXml.push(`<row r="${ri+2}">${row.map((v,ci)=>cell(ri+2, ci, v)).join('')}</row>`);
  });
  const lastCol = colLetter(Math.max(0, headers.length-1));
  const dim = `A1:${lastCol}${matrix.length+1}`;
  const safeName = String(sheetName||'Sheet1').replace(/[\\\/\?\*\[\]:]/g,' ').slice(0,31) || 'Sheet1';

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${dim}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${rowsXml.join('')}</sheetData></worksheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEsc(safeName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F3864"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

  const files = {
    '[Content_Types].xml': contentTypes,
    '_rels/.rels': rootRels,
    'xl/workbook.xml': workbookXml,
    'xl/_rels/workbook.xml.rels': wbRels,
    'xl/styles.xml': stylesXml,
    'xl/worksheets/sheet1.xml': sheetXml
  };
  return zipSync(files);
}

// Minimal ZIP writer (store, no compression) → Blob. Includes CRC32 so the archive
// is valid and Excel/LibreOffice open it without repair.
function zipSync(files) {
  const enc = new TextEncoder();
  const crcTable = (function(){ const t=[]; for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=c&1?0xEDB88320^(c>>>1):c>>>1; t[n]=c>>>0; } return t; })();
  const crc32 = bytes => { let c=0xFFFFFFFF; for(let i=0;i<bytes.length;i++) c=crcTable[(c^bytes[i])&0xFF]^(c>>>8); return (c^0xFFFFFFFF)>>>0; };
  const chunks = []; const central = []; let offset = 0;
  const u16 = n => [n&0xFF,(n>>8)&0xFF];
  const u32 = n => [n&0xFF,(n>>8)&0xFF,(n>>16)&0xFF,(n>>24)&0xFF];
  for (const name of Object.keys(files)) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(files[name]);
    const crc = crc32(data);
    const local = [].concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0));
    chunks.push(new Uint8Array(local), nameBytes, data);
    const localLen = 30 + nameBytes.length + data.length;
    central.push({ name: nameBytes, crc, size: data.length, offset });
    offset += localLen;
  }
  const centralChunks = []; let centralSize = 0;
  for (const c of central) {
    const hdr = [].concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(c.crc), u32(c.size), u32(c.size), u16(c.name.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(c.offset));
    centralChunks.push(new Uint8Array(hdr), c.name);
    centralSize += 46 + c.name.length;
  }
  const end = [].concat(u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length),
    u32(centralSize), u32(offset), u16(0));
  const parts = [...chunks, ...centralChunks, new Uint8Array(end)];
  return new Blob(parts, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/* ============================================================
   PERMISSION HELPERS — central role logic
   ============================================================
   Role model:
     admin → full access to everything.
     The 10 organisational roles are defined in REF.permissions and REF.viewAccess:
     procurement_senior_manager, procurement_manager, procurement_supervisor,
     procurement_officer, logistics_manager, logistics_officer, demand_supervisor,
     demand_officer, finance, stakeholder.
     Legacy role names are normalized in normalizeRole().
============================================================ */
/* ============================================================
   PERMISSION ENGINE — single source of truth = REF.permissions
   ============================================================
   can(resource, action) checks the current officer's role.
   No role set (fresh no-login session) defaults to admin so the
   prototype is never accidentally locked out. */
function currentRole() {
  // Role resolution order (most specific first):
  //   1. Per-TAB demo role (sessionStorage / URL ?role=) — DEMO ONLY.
  //   2. Per-BROWSER demo role (localStorage) — DEMO ONLY.
  //   3. The stored/authenticated officer's own role.
  // In production (demoMode=false) the demo overrides are ignored entirely, so a user
  // cannot reassign their own role — access comes only from their officer record
  // (set by an admin, or from the authenticated identity when login is wired).
  if (isDemoMode()) {
    try {
      const tabDemo = window.__tabRole || sessionStorage.getItem('phoenix_tab_role');
      if (tabDemo) return normalizeRole(tabDemo);
    } catch (e) {}
    try {
      const demo = window.__demoRole || localStorage.getItem('phoenix_demo_role');
      if (demo) return normalizeRole(demo);
    } catch (e) {}
  }
  const assignedRole = window.__state.officer?.role;
  if (!assignedRole) {
    // Demo stays easy to test; production fails closed when a profile has no role.
    return isDemoMode() ? 'admin' : 'no_access';
  }
  return normalizeRole(assignedRole);
}
window.__currentRole = currentRole;
// Map legacy/base role values onto the final 10-role set so existing officer records
// keep working after the role-set change (accounts->finance, bare procurement->manager,
// bare logistics->manager, officer->procurement officer).
function normalizeRole(r) {
  if (!r) return 'stakeholder';
  const alias = {
    officer: 'procurement_technical_officer',
    procurement: 'procurement_technical_manager',
    // Legacy generic procurement roles → default to the Technical & Service stream.
    // (Existing users should be reassigned to their correct stream in Officers & Roles.)
    procurement_manager: 'procurement_technical_manager',
    procurement_supervisor: 'procurement_technical_manager',
    procurement_officer: 'procurement_technical_officer',
    logistics: 'logistics_manager',
    logistics_supervisor: 'logistics_officer',
    accounts: 'finance'
  };
  return alias[r] || r;
}
/* Privileged tier = SuperUsers / Managers / Supervisors. Restricted views
   (Data Quality and selected System Settings tools) are hidden in the sidebar
   and blocked from direct hash access for non-privileged roles. */
const PRIVILEGED_ROLES = ['admin'];
const RESTRICTED_VIEWS = ['dqcockpit', 'erpimportrules', 'workingcalendars'];
function isPrivileged() {
  const r = currentRole();
  // Privileged = admin, or any manager/supervisor variant (procurement_manager,
  // logistics_supervisor, etc.). The earlier check matched the bare strings
  // 'manager'/'supervisor', which no real role equals — so every manager/supervisor
  // was wrongly treated as unprivileged and locked out of management views.
  if (PRIVILEGED_ROLES.includes(r)) return true;
  return /(^|_)(manager|supervisor)$/.test(r);
}
function isRestrictedView(view) { return RESTRICTED_VIEWS.includes(view); }
window.__isPrivileged = isPrivileged;
window.__isRestrictedView = isRestrictedView;
function can(resource, action) {
  const role = currentRole();
  const matrix = (window.REF && window.REF.permissions) || {};
  const perms = matrix[role];
  if (perms === '*' || role === 'admin') return true;       // admin = full access
  // Default posture differs by environment: the prototype/demo is permissive so a
  // half-defined role never blocks a demo; production FAILS CLOSED so an unknown role
  // or an unlisted resource is denied rather than silently granted.
  const fallback = isDemoMode();
  if (!perms) return fallback;                               // unknown role
  const allowed = perms[resource];
  if (allowed === undefined) return fallback;                // resource not in matrix
  return Array.isArray(allowed) && allowed.includes(action);
}
function canEditOrders() {
  return can('orders', 'edit') || can('orders', 'create');
}
/* Reassigning the purchasing officer on orders (single or bulk) is a supervisor/manager
   oversight action — not something a regular officer does. */
function canReassignOrders() {
  return isPrivileged();  // admin + any *_manager / *_supervisor (incl. senior manager)
}
window.__canReassignOrders = canReassignOrders;
function canEditShipments() {
  return can('shipments', 'edit') || can('shipments', 'create');
}
function canManageShipments() {
  // assigning officers / setting stage — same permission as editing shipments
  return can('shipments', 'edit');
}

/* ============================================================
   ENTITY HELPERS (multi-entity: Phoenix + group companies)
   ============================================================
   currentEntity() = the active company context (sidebar switcher),
   persisted in localStorage. entityMeta() returns its config. */
function currentEntity() {
  const e = window.__state.entity || localStorage.getItem('phoenix_entity') || (window.REF?.defaultEntity) || 'Phoenix';
  return e;
}
function setCurrentEntity(code) {
  window.__state.entity = code;
  try { localStorage.setItem('phoenix_entity', code); } catch(e){}
}
function entityMeta(code) {
  const list = (window.REF && window.REF.entities) || [];
  return list.find(e => e.code === code) || list[0] || { code: code, short: code, accent: '#FD5C25', rfpPrefix: 'PHX' };
}
// An order/shipment/payment's entity, defaulting to Phoenix for legacy records.
function recordEntity(r) {
  return (r && r.entity) || 'Phoenix';
}
/* The IPR number is called "PQ No." at Seychelles Breweries and "IPR No." elsewhere.
   Pass an entity (or a record) to get the right label; falls back to the active entity. */
function iprLabel(entityOrRecord, opts) {
  let entity = entityOrRecord;
  if (entityOrRecord && typeof entityOrRecord === 'object') entity = recordEntity(entityOrRecord);
  if (!entity) { try { entity = currentEntity(); } catch (_) {} }
  const isSey = entity === 'Seychelles Breweries';
  const short = opts && opts.short;   // 'IPR' vs 'IPR No.'
  if (isSey) return short ? 'PQ' : 'PQ No.';
  return short ? 'IPR' : 'IPR No.';
}
window.__iprLabel = iprLabel;

/* ============================================================
   FUNCTION HELPERS (Procurement function for an order)
   ============================================================ */
function functionForCategory(cat) {
  if (!cat) return null;
  return REF.categoryToFunction[cat] || null;
}
function orderFunction(o) {
  // Explicit field wins, otherwise derive from category
  if (o.function) return o.function;
  return functionForCategory(o.category);
}

/* Stream-scoped roles: a role locked to one procurement stream sees only that
   stream's orders (in both foreign and local). Returns the function key the role is
   locked to, or null if the role sees all streams. */
const ROLE_STREAM = {
  sc_manager: 'supplychain',
  sc_supervisor: 'supplychain',
  sc_officer: 'supplychain',
  procurement_technical_manager: 'technical',
  procurement_technical_supervisor: 'technical',
  procurement_technical_officer: 'technical',
  procurement_indirect_manager: 'indirect',
  procurement_indirect_supervisor: 'indirect',
  procurement_indirect_officer: 'indirect'
};
function roleStream(role) {
  const r = role || currentRole();
  return ROLE_STREAM[r] || null;
}
/* True if the current role may see this order given stream scoping. Non-stream roles
   (admin, senior manager, finance, logistics, demand, stakeholder) see everything. */
function orderInStreamScope(o) {
  const s = roleStream();
  if (!s) return true;              // no stream lock → sees all
  return orderFunction(o) === s;    // stream-locked → only matching function
}
window.__roleStream = roleStream;
window.__orderFunction = orderFunction;
window.__orderInStreamScope = orderInStreamScope;

/* Whether an order requires shipment by default.
   Foreign tangible orders normally need shipment follow-up. Local tangible orders
   normally receive directly by GRN, but may still have an exceptional shipment
   record if logistics creates one; those optional shipments use the same shipment
   engine and controls as foreign shipments. */
function orderNeedsShipment(o) {
  if (!o) return false;
  if (o.noShipment) return false;
  if (o.orderType && o.orderType !== 'foreign') return false;
  return true;
}

/* ============================================================
   MILESTONE HELPERS
   ============================================================
   These convert a payment term string + the order/shipment context
   into an array of milestone objects with expected dates filled in.
============================================================ */
function roundMoneyAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function allocateMilestoneAmounts(orderAmount, milestones) {
  const amount = Number(orderAmount);
  const items = Array.isArray(milestones) ? milestones : [];
  if (!Number.isFinite(amount) || !items.length) return items.map(() => null);
  const totalPct = items.reduce((sum, item) => sum + (Number(item?.percent) || 0), 0);
  const rebalanceFinal = Math.abs(totalPct - 100) <= 0.01;
  const totalCents = Math.round((amount + Number.EPSILON) * 100);
  let allocatedCents = 0;
  return items.map((item, idx) => {
    const percent = Number(item?.percent) || 0;
    let cents;
    if (rebalanceFinal && idx === items.length - 1) {
      cents = totalCents - allocatedCents;
    } else {
      cents = Math.round(totalCents * percent / 100);
      allocatedCents += cents;
    }
    return cents / 100;
  });
}

function milestoneAmountsLookPercentDerived(orderAmount, milestones) {
  const amount = Number(orderAmount);
  const items = Array.isArray(milestones) ? milestones : [];
  if (!Number.isFinite(amount) || !items.length) return false;
  const totalPct = items.reduce((sum, item) => sum + (Number(item?.percent) || 0), 0);
  if (Math.abs(totalPct - 100) > 0.01) return false;
  return items.every(item => {
    if (item?.amount == null || item.amount === '') return true;
    const expected = roundMoneyAmount(amount * (Number(item?.percent) || 0) / 100);
    return expected != null && Math.abs(Number(item.amount) - expected) <= 0.011;
  });
}

function generateMilestonesFromTerm(termString, orderAmount) {
  if (!termString) return [];
  const schedule = REF.paymentSchedules[termString];
  if (!schedule) return []; // custom/unknown term — user builds manually
  const amounts = allocateMilestoneAmounts(orderAmount, schedule);
  return schedule.map((stage, idx) => ({
    id: 'm' + (idx + 1) + '_' + Math.random().toString(36).slice(2, 7),
    seq: idx + 1,
    label: stage.label,
    percent: stage.percent,
    amount: amounts[idx],
    anchor: stage.anchor,
    offset: stage.offset,
    expectedDate: null,   // computed dynamically when order/shipment dates change
    rfpRef: null,
    paidDate: null,
    notes: ''
  }));
}

/* For a milestone + an order + linked shipments, return the
   computed expected date (null if anchor data not yet available). */
function computeMilestoneDate(milestone, order, ships) {
  if (!milestone || !milestone.anchor) return null;
  const offset = milestone.offset || 0;
  let anchorDate = null;
  switch (milestone.anchor) {
    case 'order_placement': anchorDate = order.dateOfOrder; break;
    case 'supplier_confirmation': anchorDate = order.orderAcknowledgedDate; break;
    case 'order_ready':
    case 'before_shipment': anchorDate = order.orderReadyDate; break;
    case 'invoice_date': anchorDate = milestone.linkedInvoiceDate || null; break;
    case 'end_of_month':
      if (milestone.linkedInvoiceDate) {
        const d = milestone.linkedInvoiceDate?.toDate ? milestone.linkedInvoiceDate.toDate() : new Date(milestone.linkedInvoiceDate);
        // End of invoice month + offset days
        const eom = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        const due = new Date(eom); due.setDate(eom.getDate() + offset);
        return due;
      }
      return null;
    case 'bl_date':
    case 'eta': {
      // Earliest matching shipment date
      const matchingShips = ships.filter(s => shipmentBelongsToOrder(s, order));
      if (matchingShips.length === 0) return null;
      const field = milestone.anchor === 'bl_date' ? 'blDate' : 'eta';
      const dates = matchingShips.map(s => s[field]).filter(Boolean).map(d => d.toDate ? d.toDate() : new Date(d));
      if (dates.length === 0) return null;
      anchorDate = new Date(Math.min(...dates.map(d => d.getTime())));
      break;
    }
    case 'grn_date': {
      const dates = [];
      const matchingShips = (ships || []).filter(s => shipmentBelongsToOrder(s, order));
      matchingShips.forEach(s => {
        const receiptDate = window.PXReceiptControl
          ? window.PXReceiptControl.shipmentReceiptDate(order, s)
          : (s.deliveryDate || s.grnDate);
        if (receiptDate) dates.push(receiptDate);
      });
      (Array.isArray(order.receipts) ? order.receipts : []).forEach(r => {
        const status = String(r?.status || '').toLowerCase();
        if (status === 'pending' || status === 'cancelled') return;
        if (!r.shipmentId && (r.actualReceiptDate || r.grnDate)) dates.push(r.actualReceiptDate || r.grnDate);
      });
      const parsed = dates.map(d => d?.toDate ? d.toDate() : new Date(d)).filter(d => d && !isNaN(d));
      if (parsed.length === 0) return null;
      anchorDate = new Date(Math.min(...parsed.map(d => d.getTime())));
      break;
    }
    case 'erection': anchorDate = order.erectionDate; break;
    case 'commissioning': anchorDate = order.commissioningDate; break;
    case 'delivery': anchorDate = order.deliveryDate; break;
    default: anchorDate = null;
  }
  if (!anchorDate) return null;
  const d = anchorDate.toDate ? anchorDate.toDate() : new Date(anchorDate);
  if (isNaN(d)) return null;
  const due = new Date(d); due.setDate(d.getDate() + offset);
  return due;
}

/* Derive milestone status from the data we have. */
function milestoneStatus(milestone, expectedDate) {
  if (milestone.paidDate) return 'paid';
  if (milestone.rfpRef) return 'rfp-raised';
  if (!expectedDate) return 'planned';
  const today = new Date(); today.setHours(0,0,0,0);
  const due = new Date(expectedDate); due.setHours(0,0,0,0);
  const days = Math.round((due - today) / 86400000);
  if (days < 0) return 'overdue';
  if (days <= 14) return 'due-soon';
  return 'planned';
}

// Quick new order button
$('#quick-new-order').addEventListener('click', () => {
  if (!window.openOrderForm) return;
  // Derive type and function from current view if it's an order list
  if (state.view && state.view.startsWith('orders-')) {
    const parts = state.view.split('-');  // orders-foreign-technical
    const type = parts[1];
    const fn = parts.slice(2).join('-');
    window.openOrderForm(null, type, fn);
  } else {
    // Default to foreign + no function preselect
    window.openOrderForm(null, 'foreign', null);
  }
});

// Refresh
$('#refresh-dashboard').addEventListener('click', () => renderView('dashboard'));

// Modal close on backdrop click
$('#modal-backdrop').addEventListener('click', e => {
  if (e.target.id === 'modal-backdrop') closeModal();
});
window.openModal = function(html, wide=false) {
  const m = $('#modal');
  m.classList.toggle('wide', wide);
  const bd = $('#modal-backdrop');
  m.innerHTML = html;
  bd.classList.add('show');
};
window.closeModal = function() {
  $('#modal-backdrop').classList.remove('show');
  $('#modal').innerHTML = '';
};

// Print view back
$('#print-back').addEventListener('click', () => {
  $('#print-view').classList.remove('show');
});
