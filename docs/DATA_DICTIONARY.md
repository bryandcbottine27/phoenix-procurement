# Phoenix Procurement — Data Dictionary

> Generated from src/schema.js — DO NOT EDIT BY HAND.
> Run `python build.py` (or `python tools/gen_data_dictionary.py --write`) to
> regenerate. The build also runs `--check`, which fails if this file drifts
> from the schema.


## `orders`

| Field | Meaning | Type | Owner | Editable | Required | UI |
|---|---|---|---|---|---|---|
| `orderId` | Order number (FPO/LPO); = ERP doc no. for ERP orders | string | ERP | erp-seed | yes | list, detail, form, reports |
| `entity` | Owning company: Phoenix / Seychelles Breweries / Edena | string | Phoenix | true | yes | form, badge, all lists/dashboard/reports |
| `orderType` | foreign (FPO) or local (LPO). For Business Central imports, blank local-currency code or the entity local currency code itself imports as local: SCR for Seychelles Breweries, EUR for Edena. | string | Phoenix | true | yes | form, split views, ERP import |
| `supplier` | Supplier name | string | ERP | erp-seed | yes | list, detail, form |
| `supplierId` | Stable Phoenix supplier-master document id; preserves supplier linkage if the display name changes | string | Phoenix | false | no | detail, import/reconciliation |
| `supplierMatchMethod` | How the supplier master was linked: vendorNo / name / alias / unmatched / manual | string | Phoenix | false | no | detail, import/reconciliation |
| `supplierOverrideReason` | Authorised reason for using a blocked supplier | string | Phoenix | false | no | order audit |
| `supplierOverrideBy` | Officer code that authorised a blocked-supplier override | string | Phoenix | false | no | order audit |
| `supplierOverrideAt` | Timestamp of blocked-supplier override | date | Phoenix | false | no | order audit |
| `currency` | Order currency | string | ERP | erp-seed | yes | list, detail, form |
| `amount` | Order total (master value) | number | ERP | erp-seed | yes | list, detail, form |
| `dateOfOrder` | Order/PO date | date | ERP | erp-seed | no | detail, form, dashboard |
| `description` | Order description | string | ERP | erp-seed | no | list, detail, form |
| `category` | Procurement category (drives function) | string | ERP | erp-seed | no | form, filters |
| `function` | technical / indirect / supplychain (derived from category) | string | Phoenix | true | no | split views, filters |
| `noShipment` | No shipment required by default (service, works, licence, subscription, etc.). Local tangible orders normally receive directly by order-level GRNs; an exceptional local shipment may still be created when logistics is involved. Foreign tangible orders normally require shipment follow-up. | bool | Phoenix | true | no | form, detail, hides shipment request for service/works; receipt/OTIF uses actual GRN/shipment evidence |
| `stagedPayment` | Local order paid in stages (enables milestones) | bool | Phoenix | true | no | local order form, milestones |
| `paymentTerms` | Payment terms (drives milestone schedule) | string | ERP | erp-seed | no | form, milestones |
| `incoterm` | Foreign-order Incoterm, e.g. EXW / FOB / CIF; Phoenix-managed until supplied by ERP | string | Phoenix | true | no | foreign order form, detail, Data Quality |
| `plannedShipmentMode` | Planned foreign-order transport mode before a shipment is created | string | Phoenix | true | no | foreign order form, Data Quality |
| `plannedFreightForwarder` | Planned freight forwarder before a shipment is created | string | Phoenix | true | no | foreign order form, Data Quality |
| `shipmentPlanNotes` | Foreign-order shipment plan / booking notes | string | Phoenix | true | no | foreign order form, detail |
| `status` | Phoenix operational status | string | Phoenix | true | no | list, detail, dashboard, My Work |
| `milestones` | Milestone payment schedule (array of {label,percent,amount,...}) | array | Phoenix | true | no | detail, payments, forecast |
| `notes` | Free-text notes | string | Phoenix | true | no | detail, form |
| `orderAcknowledgedDate` | Date supplier acknowledged | date | Phoenix | true | no | form, timeline |
| `orderReadyDate` | Date goods ready | date | Phoenix | true | no | form, timeline |
| `orderSentToSupplierDate` | Date PO sent to supplier | date | Phoenix | true | no | form, detail — all functions |
| `supplierPromisedDate` | Supplier original promised delivery / readiness commitment date | date | Phoenix | true | no | order form, detail, My Work, dashboard |
| `supplierRevisedPromisedDate` | Latest revised supplier commitment date when the original promise changes | date | Phoenix | true | no | order form, detail, My Work, dashboard |
| `supplierPromiseRevisionCount` | Number of times the supplier commitment date has been revised | number | Phoenix | true | no | order form, risk score, supplier performance |
| `supplierDelayReason` | Supplier-stated delay reason or blocker for the current commitment | string | Phoenix | true | no | order form, detail, risk score |
| `lastSupplierFollowupDate` | Date the purchasing officer last chased or received a meaningful supplier update | date | Phoenix | true | no | order form, My Work, ageing |
| `nextSupplierFollowupDate` | Next planned supplier chase / expediting action date | date | Phoenix | true | no | order form, My Work, dashboard |
| `followupMethod` | Preferred / last follow-up channel: email, phone, Teams, supplier portal, meeting, other | string | Phoenix | true | no | order form, detail |
| `followupFrequencyDays` | Expected chase cadence in working days for this order | number | Phoenix | true | no | order form, risk score |
| `supplierReplySummary` | Short summary of the supplier reply / latest commitment | string | Phoenix | true | no | order form, detail |
| `orderCriticality` | Business criticality: low / normal / high / critical; influences follow-up risk score | string | Phoenix | true | no | order form, detail, dashboard |
| `escalationOwner` | Officer or manager currently owning escalation for this order | string | Phoenix | true | no | order form, detail, My Work |
| `escalationDate` | Date this order was escalated for management follow-up | date | Phoenix | true | no | order form, detail, reports |
| `escalationLevel` | Escalation level for supplier/order follow-up | number | Phoenix | true | no | order form, detail, reports |
| `plannedDates` | Planned/commitment date per timeline milestone {milestoneKey: date} — Phoenix-set now, prepared to be ERP/supplier-sourced | object | Phoenix | true | no | Timeline tab (Order Detail), timeline editor |
| `actualDates` | Supplementary/override actual date per timeline milestone {milestoneKey: date} for milestones with no canonical field (e.g. departure, arrival) | object | Phoenix | true | no | Timeline tab (Order Detail), timeline editor |
| `quantity` | Legacy header quantity for historical orders; new Supply Chain quantities are held per item in supplyChainItems[] | number | Phoenix | true | no | legacy detail, list, shipment summary |
| `supplyChainItems` | Supply Chain-only item rows: array of {id, detailedDescription, quantity} | array | Phoenix | true | no | Supply Chain order form, detail |
| `paymentApprovedBy` | [Deprecated — approval now lives on the RFP] legacy value kept for old records | string | Phoenix | true | no | legacy |
| `requestedReceiptDate` | Requested receipt date | date | Phoenix | true | no | form, forecast anchor, order lists |
| `iprNumber` | Created From IPR No. (ERP) | string | ERP | erp-seed | no | detail, order lists |
| `iprApprovedDate` | IPR HOD approval date (ERP) | date | ERP | erp-seed | no | detail, list |
| `claimant` | Requested By / claimant (ERP) | string | ERP | erp-seed | no | detail, order lists |
| `isClosed` | Order closed flag | bool | Phoenix | true | no | lists, dashboard |
| `closedAt` | Date the order was closed | date | Phoenix | false | no | closed orders list |
| `amendments` | Inc.5a: array of {id,field,label,oldValue,newValue,reason,amendedBy,amendedAt} — logged on save when a tracked PO field changes | array | Phoenix | true | no | order detail amendment history |
| `claims` | Inc.5c: array of {id,type,amount,currency,status,raisedDate,resolvedDate,raisedBy,assignedTo,note} — supplier claims (quality/quantity/damage/late) | array | Phoenix | true | no | order detail claims tab |
| `lines` | ERP PO lines master (read-only). Array of {lineId, lineNo, itemNumber, description, orderedQty (alias quantity), uom, unitCost, lineAmount, cancelledQty, expectedDeliveryDate} | array | ERP | false | no | detail PO-lines tab |
| `receipts` | Phoenix GRN control events. Array of {receiptId, lineId optional, shipmentId optional, grnRef/grnNumber, grnDate, actualReceiptDate optional, receivedQty optional, status pending/partially received/fully received/cancelled, notes, recordedBy, recordedAt}. Order-level GRNs handle local orders and services/works; shipment-linked GRNs handle foreign shipments and exceptional local shipments. Delivery is not a separate layer. | array | Phoenix | true | no | Order Detail GRNs tab, Shipment Detail GRNs section, PO-lines tab |
| `lineTracking` | Phoenix per-line operational controls. Array of {lineId, closed, closureReason, exceptionApproved, notes, updatedBy, updatedAt} | array | Phoenix | true | no | detail PO-lines tab |
| `erpSource` | Manual / Navision / Business Central | string | ERP | false | no | badge |
| `erpCompany` | ERP company/database name, e.g. PHOENIX-NAV / SEYBREW-BC (source system instance) | string | ERP | false | no | detail, reconciliation |
| `erpEntityId` | ERP entity/company code — stable integration key, independent of PO number | string | ERP | false | no | reconciliation |
| `erpDocumentId` | ERP internal document id/GUID — stable key that survives renumbering (preferred match key) | string | ERP | false | no | reconciliation |
| `erpDocumentNo` | ERP document number as shown in the ERP (may differ from Phoenix orderId) | string | ERP | false | no | detail, reconciliation |
| `erpSyncStatus` | synced / pending / error | string | ERP | false | no | badge |
| `erpLastSyncedAt` | Last ERP sync time | date | ERP | false | no | badge tooltip |
| `lastRefreshChanges` | Key fields (Amount/Currency/Requested Receipt Date) changed by the most recent warehouse refresh, as {field,label,old,new}. Cleared each import — shows only the latest refresh. For officer review; warehouse value still applies. | array | Phoenix | false | no | ERP Reconciliation, order badge |
| `lastRefreshAt` | Timestamp of the most recent warehouse refresh that touched this order. | date | Phoenix | false | no | ERP Reconciliation |
| `integrationLayer` | Integration layer that last supplied ERP data: manual / excel-import / data-warehouse / api-sync | string | ERP | false | no | badge, reconciliation |
| `warehouseSource` | Data Warehouse/staging source view, table, or manual feed name that supplied the latest ERP values | string | ERP | false | no | reconciliation, audit |
| `warehouseRecordId` | Stable warehouse/staging row identifier, if supplied by the integration layer | string | ERP | false | no | reconciliation, audit |
| `warehouseBatchId` | Warehouse load batch or manual import run id used for the latest refresh | string | ERP | false | no | reconciliation, import history |
| `warehouseExtractedAt` | Timestamp when the ERP source data was extracted into the warehouse/staging layer | date | ERP | false | no | reconciliation |
| `warehouseLoadedAt` | Timestamp when Phoenix received or loaded the warehouse/staging record | date | ERP | false | no | reconciliation |
| `warehouseHash` | Optional warehouse row/version hash used to detect changed ERP records without comparing every field | string | ERP | false | no | reconciliation, future sync |
| `erpVendorNo` | ERP Buy-from Vendor No. | string | ERP | false | no | detail, ERP reconciliation |
| `erpVendorName` | ERP Buy-from Vendor Name (compared to supplier in reconciliation) | string | ERP | false | no | reconciliation (supplier mismatch) |
| `erpAmount` | ERP PO master amount (sum of line amounts on import) | number | ERP | false | no | reconciliation (amount mismatch) |
| `erpCurrency` | ERP currency code after local-currency interpretation for Business Central imports: blank becomes SCR for Seychelles Breweries or EUR for Edena | string | ERP | false | no | reconciliation (currency mismatch) |
| `erpPoStatus` | ERP PO lifecycle status (Open/Closed/Cancelled) — NEVER written into Phoenix status | string | ERP | false | no | reconciliation, badge |
| `erpHodId` | ERP HOD ID (drives Phoenix function classification on import) | string | ERP | false | no | import classification |
| `erpPurchasingMgrId` | ERP Purchasing Manager ID (drives function classification on import) | string | ERP | false | no | import classification |
| `erpCreatedFromIpr` | ERP Created From IPR No. | string | ERP | false | no | detail |
| `erpCreatedBy` | ERP Created By (Seychelles/Edena BC fallback when Purchaser Code is blank) | string | ERP | false | no | import classification |
| `erpPurchaserCode` | Business Central Purchaser Code (primary Seychelles/Edena function classifier) | string | ERP | false | no | import classification, detail, reconciliation |
| `erpShipmentMethod` | ERP Shipment Method Code, e.g. CIF (Seychelles BC) | string | ERP | false | no | detail |
| `amountInclVat` | PO amount including VAT (Seychelles/Edena BC; net amount is in Amount) | number | ERP | false | no | detail |
| `paymentDueDate` | PO Due Date (payment due). From Business Central "Due Date" for Seychelles/Edena. | date | ERP | false | no | detail |
| `locationCode` | Business Central Location Code (Seychelles/Edena) | string | ERP | false | no | detail |
| `departmentCode` | Business Central Department Code (Seychelles/Edena) | string | ERP | false | no | detail |
| `logisticStatus` | Business Central Logistic Status (Seychelles/Edena) | string | ERP | false | no | detail |
| `amountReceivedNotInvoiced` | Amount Received Not Invoiced (LCY) — value received but not yet invoiced (Seychelles/Edena BC; GRN/receipt tracking) | number | ERP | false | no | detail |
| `createdAt` | Created timestamp | date | Phoenix | false | no | audit |
| `createdBy` | Creator officer code | string | Phoenix | false | no | audit |
| `updatedAt` | Updated timestamp | date | Phoenix | false | no | audit |
| `updatedBy` | Updater officer code | string | Phoenix | false | no | audit |

## `shipments`

| Field | Meaning | Type | Owner | Editable | Required | UI |
|---|---|---|---|---|---|---|
| `shipmentId` | orderId + shipment sequence (e.g. FPO12345 (S1), FPO12345 (S2)) | string | Phoenix | true | yes | list, detail, form |
| `orderId` | Linked order number | string | Phoenix | true | yes | list, detail |
| `entity` | Owning company (inherited from order) | string | Phoenix | false | no | scopes lists |
| `supplier` | Supplier (from order) | string | Phoenix | true | no | list, detail |
| `stage` | requested / assigned / in_progress / completed | string | Phoenix | true | no | list, My Work |
| `status` | Shipping status | string | Phoenix | true | no | list, detail |
| `shipmentCoverage` | Control scope only: full order / partial order / balance shipment / replacement shipment | string | Phoenix | true | no | shipment form, detail, list |
| `partialShipmentReason` | Reason for partial, split, balance or replacement shipment without reproducing ERP PO lines | string | Phoenix | true | no | shipment form, detail |
| `movementSummary` | Short free-text summary of what is moving; ERP remains the item-line source of truth | string | Phoenix | true | no | shipment form, detail, search |
| `sameMovement` | Yes/no control flag: multiple lots remain under same vessel/flight/logistics movement | string | Phoenix | true | no | shipment form, detail |
| `transportSplit` | Yes/no control flag: shipment is split by different transport mode/route and normally needs separate shipment records | string | Phoenix | true | no | shipment form, detail |
| `expectedCompleteAfterShipment` | Yes/no control flag: order is expected to be complete after this shipment | string | Phoenix | true | no | shipment form, detail |
| `receiptResult` | Control result after warehouse/store receipt: fully received / partially received / short / missing / damaged | string | Phoenix | true | no | shipment form, detail, list |
| `followupAction` | Control action required from shipment exception: create next shipment / raise issue / close balance / await confirmation | string | Phoenix | true | no | shipment form, detail, list, My Work |
| `followupActionStatus` | Processed-state marker for a shipment follow-up action; processed actions no longer appear in My Work | string | Phoenix | false | no | shipment detail, My Work |
| `followupActionProcessedAt` | Timestamp when the shipment follow-up action was processed | date | Phoenix | false | no | audit, My Work |
| `followupActionProcessedBy` | Officer code that processed the shipment follow-up action | string | Phoenix | false | no | audit, My Work |
| `followupActionProcessedByShipmentId` | Shipment reference that processed a Create next shipment action | string | Phoenix | false | no | audit, My Work |
| `logisticOfficer` | Assigned logistics officer | string | Phoenix | true | no | detail, My Work |
| `eta` | Estimated arrival | date | Phoenix | true | no | detail, My Work |
| `actualDepartureDate` | Actual departure date / time recorded by logistics | date | Phoenix | true | no | shipment form, Data Quality |
| `actualArrivalDate` | Actual arrival date at destination / port; use portArrivalDate for sea-container tracker | date | Phoenix | true | no | shipment form, Data Quality |
| `etaChangeHistory` | Automatic ETA-change audit array: {previousEta,newEta,changedAt,changedBy} | array | Phoenix | false | no | shipment detail, Data Quality |
| `etd` | Estimated departure date | date | Phoenix | true | no | detail, journey |
| `requiredDocs` | Document-readiness checklist: array of {key,label,status(awaited/received/na),receivedDate,from,note} | array | Phoenix | true | no | shipment detail document readiness |
| `grnNumber` | Legacy/latest GRN number summary copied from linked order receipts[] for list/report compatibility; detailed GRN rows live on orders.receipts[] | string | Phoenix | true | no | detail, list summary |
| `grnDate` | Legacy/latest GRN date summary copied from linked order receipts[] for list/report compatibility. For timing, deliveryDate is preferred and GRN date is fallback. | date | Phoenix | true | no | detail, performance summary |
| `vesselFlight` | Vessel / flight reference | string | Phoenix | true | no | detail |
| `bookingDate` | Logistic / booking date (supply chain) | date | Phoenix | true | no | detail, form — foreign only |
| `shippingDocsDate` | Shipping docs receipt/validation V/S FPO date (supply chain) | date | Phoenix | true | no | detail, form — foreign only |
| `invoiceToAccountsDate` | Invoice sent to Accounts for costing date (supply chain) | date | Phoenix | true | no | detail, form — foreign only |
| `coaPostedDate` | COA posted date (supply chain) | date | Phoenix | true | no | detail, form — foreign only |
| `clearanceStatus` | Clearance status — free text (supply chain) | string | Phoenix | true | no | detail, form — foreign only |
| `clearanceOwner` | Officer accountable for customs / clearance follow-up | string | Phoenix | true | no | shipment form, Data Quality |
| `clearanceStartDate` | Date customs / clearance processing started | date | Phoenix | true | no | shipment form, Data Quality |
| `customsReleaseDate` | Date customs / broker released the cargo | date | Phoenix | true | no | shipment form, Data Quality |
| `deliveryDate` | Date cargo was delivered to site / warehouse | date | Phoenix | true | no | shipment form, Data Quality |
| `containerCount` | Number of containers (supply chain) | number | Phoenix | true | no | detail, form — foreign only |
| `portArrivalDate` | Inc.3: date vessel/container arrived at port of discharge | date | Phoenix | true | no | container tracker |
| `demurrageFreeDays` | Inc.3: free days before demurrage starts (from port arrival) | number | Phoenix | true | no | container tracker |
| `containerPickupDate` | Inc.3: date container picked up from port (demurrage stops, detention starts) | date | Phoenix | true | no | container tracker |
| `detentionFreeDays` | Inc.3: free days for detention before charges start (from pickup) | number | Phoenix | true | no | container tracker |
| `containerReturnDate` | Inc.3: date empty container returned to shipping line (detention stops) | date | Phoenix | true | no | container tracker |
| `demurrageRatePerDay` | Inc.3: demurrage charge per container per day (for cost projection) | number | Phoenix | true | no | container tracker |
| `detentionRatePerDay` | Inc.3: detention charge per container per day (for cost projection) | number | Phoenix | true | no | container tracker |
| `trackerCurrency` | Inc.3: currency for demurrage/detention rates | string | Phoenix | true | no | container tracker |
| `completed` | Completed flag | bool | Phoenix | true | no | list |
| `requestedBy` | Officer who requested | string | Phoenix | false | no | My Work |
| `mode` | Transport mode (SEA / AIR) | string | Phoenix | true | no | detail, TEPS |
| `invoiceValue` | TEPS: goods invoice value (foreign currency) | number | Phoenix | true | no | TEPS forecast |
| `invoiceCurrency` | TEPS: invoice currency | string | Phoenix | true | no | TEPS forecast |
| `exchangeRate` | TEPS: exchange rate to MUR | number | Phoenix | true | no | TEPS forecast |
| `tepsFreight` | TEPS: freight cost in MUR | number | Phoenix | true | no | TEPS forecast |
| `insuranceRate` | TEPS: insurance rate % (default 0.2) | number | Phoenix | true | no | TEPS forecast |
| `vatRate` | TEPS: VAT rate % (default 15) | number | Phoenix | true | no | TEPS forecast |
| `isAlcohol` | TEPS: alcoholic beverage (excise applies) | bool | Phoenix | true | no | TEPS forecast |
| `exciseDuties` | TEPS: Excise & Duties, manual from MRA (alcohol only) | number | Phoenix | true | no | TEPS forecast |
| `cfrValue` | TEPS computed: CFR = freight + invoice×rate | number | Phoenix | false | no | TEPS forecast |
| `tepsInsurance` | TEPS computed: insurance = CFR × rate% | number | Phoenix | false | no | TEPS forecast |
| `tepsVat` | TEPS computed: VAT = (CFR+insurance) × rate% | number | Phoenix | false | no | TEPS forecast |
| `totalProvision` | TEPS computed: VAT + Excise & Duties | number | Phoenix | false | no | TEPS forecast, A/C export |
| `actualLandedCostMUR` | Inc.2: actual total landed cost in MUR after clearance (entered once final duty/VAT/freight invoices received) | number | Phoenix | true | no | TEPS actual vs estimate, A/C export |
| `actualLandedCostDate` | Inc.2: date actual landed cost was confirmed | date | Phoenix | true | no | TEPS actual vs estimate |
| `actualLandedCostNote` | Inc.2: note on actual cost source (e.g. customs declaration ref, broker invoice no.) | string | Phoenix | true | no | TEPS actual vs estimate |

## `payment_requests`

| Field | Meaning | Type | Owner | Editable | Required | UI |
|---|---|---|---|---|---|---|
| `rfpRef` | RFP reference (per-entity auto-number) | string | Phoenix | false | yes | list, detail, form |
| `entity` | Owning company (inherited from order); drives RFP counter | string | Phoenix | false | no | scopes lists |
| `orderId` | Linked order | string | Phoenix | true | yes | list, detail |
| `supplier` | Supplier | string | Phoenix | true | no | list, detail |
| `milestoneId` | Linked milestone id | string | Phoenix | true | no | detail, milestone sync |
| `amount` | Payment amount | number | Phoenix | true | yes | list, detail, forecast |
| `currency` | Currency | string | Phoenix | true | no | list, detail |
| `dueDate` | Payment due date | date | Phoenix | true | yes | list, My Work, forecast |
| `status` | draft / submitted / approved / paid / rejected | string | Phoenix | true | no | list, detail |
| `invoiceNumber` | Supplier invoice number | string | Phoenix | true | no | detail, My Work |
| `invoiceDate` | Supplier invoice date | date | Phoenix | true | no | payment form, Data Quality |
| `iblValueDate` | IBL value date (used as paid date) | date | Phoenix | true | no | detail |
| `paymentReference` | Bank / payment transaction reference for a paid RFP | string | Phoenix | true | no | payment form, Data Quality |
| `requestDate` | RFP request date | date | Phoenix | true | no | detail |
| `paymentApproved` | Request for payment approved | bool | Phoenix | true | no | form, detail, reflected on order |
| `paymentApprovedBy` | Approved by (AB / MC) | string | Phoenix | true | no | form, detail |
| `paymentApprovedDate` | Approval date | date | Phoenix | true | no | form, detail, reflected on order |
| `isPaid` | Payment made (independent of status) | bool | Phoenix | true | no | list tick |
| `paidDate` | Date payment was made | date | Phoenix | true | no | list tick |

## `exports`

| Field | Meaning | Type | Owner | Editable | Required | UI |
|---|---|---|---|---|---|---|
| `exportRef` | Auto-generated outbound reference, e.g. EXP-2026-0001. Unique per entity. | string | Phoenix | true | no | list, detail, search |
| `entity` | Owning entity (Phoenix / Seychelles Breweries / Edena). | string | Phoenix | true | no | list scope, form |
| `tripType` | one_way (sample, return to supplier, scrap — no return) or round_trip (repair, refurbishment, calibration — item comes back). | string | Phoenix | true | no | form, lifecycle, metrics |
| `reason` | Reason for export: sample / return_to_supplier / repair / refurbishment / calibration / scrap / other. | string | Phoenix | true | no | form, metrics grouping |
| `mode` | Transport mode: AIR / SEA / COURIER. | string | Phoenix | true | no | form, list |
| `carrier` | Carrier / courier name (e.g. DHL, Emirates SkyCargo). | string | Phoenix | true | no | form, detail |
| `trackingRef` | Airway bill / courier tracking number / BL. | string | Phoenix | true | no | form, detail |
| `destination` | Where it is being sent — supplier / vendor / service provider name. | string | Phoenix | true | no | form, list |
| `destinationCountry` | Destination country. | string | Phoenix | true | no | form, detail |
| `itemDescription` | What is being exported (free text). | string | Phoenix | true | no | form, list, search |
| `quantity` | Quantity / number of items or packages. | string | Phoenix | true | no | form, detail |
| `linkedOrderId` | Optional linked ERP order/PO (orderId). Typically set for round_trip (the return generates/relates to a PO); optional for one_way. | string | Phoenix | true | no | form, detail, cross-link |
| `projectRef` | Optional free-text project reference when not tied to a PO. | string | Phoenix | true | no | form, detail |
| `status` | Lifecycle status (see REF.exportStatuses): Draft / Dispatched / In transit / Delivered / Return in transit / Received back / Closed / Cancelled. | string | Phoenix | true | no | list, detail, metrics |
| `dispatchDate` | Date the item was dispatched (outbound leg start). Anchor for turnaround. | date | Phoenix | true | no | form, metrics |
| `deliveredDate` | Date delivered to destination / vendor (outbound leg end). | date | Phoenix | true | no | form, metrics |
| `expectedReturnDate` | For round_trip: expected date the item comes back. Overdue flagged if not received back by this date. | date | Phoenix | true | no | form, overdue flag |
| `returnDispatchDate` | For round_trip: date the item was sent back to us by the vendor. | date | Phoenix | true | no | form |
| `receivedBackDate` | For round_trip: date the item was received back (turnaround end). | date | Phoenix | true | no | form, metrics |
| `value` | Declared / insured value of the exported item. | number | Phoenix | true | no | form, detail |
| `currency` | Currency of the declared value. | string | Phoenix | true | no | form, detail |
| `logisticOfficer` | Logistics officer responsible for this export. | string | Phoenix | true | no | form, list, My Work |
| `notes` | Free-text notes. | string | Phoenix | true | no | form, detail |
| `documentUrl` | SharePoint / OneDrive link to export docs (packing list, proforma, gate pass). | string | Phoenix | true | no | form, detail |
| `createdAt` | When the export record was created. | date | Phoenix | false | no | ordering |
| `createdBy` | Officer who created it. | string | Phoenix | false | no | audit |
| `updatedAt` | Last update timestamp. | date | Phoenix | false | no | concurrency |
| `updatedBy` | Officer who last updated it. | string | Phoenix | false | no | audit |
| `archived` | Soft-delete flag. | bool | Phoenix | false | no | hidden; backup |

## `suppliers`

| Field | Meaning | Type | Owner | Editable | Required | UI |
|---|---|---|---|---|---|---|
| `entity` | Owning entity (Phoenix / Seychelles Breweries / Edena). Suppliers are per-entity: the same vendor name may exist separately under each entity with its own vendor code. | string | Phoenix | true | no | list scope, form |
| `name` | Supplier name | string | Phoenix | true | yes | list, form |
| `legalName` | Supplier legal/registered name (used for ERP matching) | string | Phoenix | true | no | form, reconciliation |
| `country` | Country | string | Phoenix | true | no | list, form |
| `defaultCurrency` | Default currency | string | Phoenix | true | no | form |
| `defaultTerms` | Default payment terms | string | Phoenix | true | no | form |
| `aliases` | Former/variant names (for reconciliation) | array | Phoenix | true | no | list, form |
| `erpMappings` | Per-entity ERP vendor mapping: array of {entity, erpSource, vendorNo, effectiveFrom, effectiveTo, active}; supports Navision-to-BC migration without losing history | array | Phoenix | true | no | form, import/reconciliation |
| `contacts` | Supplier contacts: array of {id, name, role, entity, purpose, escalationLevel, email, phone, preferred, active} | array | Phoenix | true | no | form, detail |
| `supplierRating` | preferred / normal / watchlist / blocked | string | Phoenix | true | no | list, form |
| `supplierRatingReason` | Reason supporting the current supplier rating, mandatory for watchlist and blocked | string | Phoenix | true | no | form, detail |
| `supplierRatingReviewDate` | Next scheduled supplier rating review date | date | Phoenix | true | no | form, detail |
| `supplierRatingReviewedBy` | Officer who last reviewed or changed the supplier rating | string | Phoenix | false | no | form audit, detail |
| `supplierRatingReviewedAt` | Timestamp of the last supplier rating review or change | date | Phoenix | false | no | form audit, detail |
| `supplierRatingHistory` | Append-only rating review history: array of {id, rating, reason, reviewDate, reviewedBy, reviewedAt, approvedBy} | array | Phoenix | false | no | detail |
| `mergedSupplierHistory` | Audit history of supplier masters merged into this record: array of {sourceId, sourceName, mergedAt, mergedBy, reason} | array | Phoenix | false | no | detail |
| `mergedIntoSupplierId` | For archived duplicate supplier records, the surviving supplier master id | string | Phoenix | false | no | archive audit |
| `mergedAt` | Timestamp when this duplicate supplier was merged | date | Phoenix | false | no | archive audit |
| `mergedBy` | Officer who performed the supplier merge | string | Phoenix | false | no | archive audit |
| `mergeReason` | Reason recorded for the supplier merge | string | Phoenix | false | no | archive audit |
| `active` | Active flag | bool | Phoenix | true | no | list, form |
| `notes` | Notes | string | Phoenix | true | no | form |

## `officers`

| Field | Meaning | Type | Owner | Editable | Required | UI |
|---|---|---|---|---|---|---|
| `code` | 2-letter officer code | string | Phoenix | true | yes | everywhere (author/assignee) |
| `fullName` | Full name | string | Phoenix | true | yes | lists, forms |
| `email` | Individual login email/username used to link the authenticated user to this officer profile | string | Phoenix | true | no | Officers & Roles, login mapping |
| `authUid` | Firebase Auth / SSO user id for direct officer-profile lookup | string | Phoenix | true | no | Officers & Roles, login mapping |
| `role` | admin or one of the 10 organisational roles: procurement_senior_manager, procurement_manager, procurement_supervisor, procurement_officer, logistics_manager, logistics_officer, demand_supervisor, demand_officer, finance, stakeholder | string | Phoenix | true | no | permissions |
| `function` | technical / indirect / supplychain | string | Phoenix | true | no | assignment |
| `active` | Active flag | bool | Phoenix | true | no | lists |
| `delegateToCode` | Inc.5d: officer code to delegate My Work items to (set during absence) | string | Phoenix | true | no | delegation |
| `delegateUntil` | Inc.5d: delegation expiry date (inclusive); clears automatically after this date | date | Phoenix | true | no | delegation |
| `delegateReason` | Inc.5d: reason / note for delegation (e.g. Annual leave) | string | Phoenix | true | no | delegation |

## `documents`

| Field | Meaning | Type | Owner | Editable | Required | UI |
|---|---|---|---|---|---|---|
| `relatedType` | order / shipment / payment / supplier | string | Phoenix | false | yes | section |
| `relatedId` | Parent record id | string | Phoenix | false | yes | section |
| `documentType` | PO / Invoice / BL / COA / etc. | string | Phoenix | true | yes | section, reports |
| `folder` | Folder: purchase_order / shipping_documents / payment_request / grn | string | Phoenix | true | no | order documents folders |
| `folderLabel` | Display label for the selected logical folder | string | Phoenix | false | no | documents, SharePoint-ready metadata |
| `poFolderName` | Future SharePoint parent folder: PO number plus supplier name | string | Phoenix | false | no | documents, SharePoint-ready metadata |
| `documentFolderPath` | Human-readable logical folder path inside the PO folder | string | Phoenix | false | no | documents, reports |
| `sharePointFolderPath` | SharePoint-ready folder path segments joined by /; actual folder creation is deferred to Graph integration | string | Phoenix | false | no | documents, future SharePoint upload |
| `storageProvider` | metadata-only / sharepoint-link / demo-firestore | string | Phoenix | false | no | documents, reports |
| `documentName` | Display name | string | Phoenix | true | no | section |
| `documentUrl` | Link (SharePoint/OneDrive/path) | string | Phoenix | true | no | section |
| `fileData` | Demo: uploaded file as base64 data URL (small files; SharePoint link replaces this on implementation) | string | Phoenix | true | no | section upload |
| `fileName` | Uploaded file original name | string | Phoenix | true | no | section |
| `fileSize` | Uploaded file size (bytes) | number | Phoenix | true | no | section |
| `fileMime` | Uploaded file MIME type | string | Phoenix | true | no | section |
| `status` | missing / requested / received / approved / rejected | string | Phoenix | true | no | section, reports, My Work |
| `required` | Required/compliance document | bool | Phoenix | true | no | section, reports |
| `receivedDate` | Received date | date | Phoenix | true | no | section |
| `expiryDate` | Expiry date | date | Phoenix | true | no | section, alerts |
| `expiryAlertDays` | Days-before-expiry to warn | number | Phoenix | true | no | section |
| `version` | Version/revision label | string | Phoenix | true | no | section |
| `verifiedBy` | Officer who verified | string | Phoenix | false | no | section |
| `verifiedAt` | Verification timestamp | date | Phoenix | false | no | section |
| `rejectedReason` | Reason when status=rejected | string | Phoenix | true | no | section, reports, My Work |
| `archived` | Soft-delete flag | bool | Phoenix | false | no | hidden; backup |
| `archivedAt` | Archive timestamp | date | Phoenix | false | no | backup |
| `archivedBy` | Officer who archived | string | Phoenix | false | no | backup |
| `archiveReason` | Archive reason | string | Phoenix | false | no | backup |

## `followups`

| Field | Meaning | Type | Owner | Editable | Required | UI |
|---|---|---|---|---|---|---|
| `relatedType` | Parent type | string | Phoenix | false | no | section |
| `relatedId` | Parent id | string | Phoenix | false | no | section |
| `comment` | Update/comment | string | Phoenix | true | no | section |
| `officer` | Author code | string | Phoenix | false | no | section |
| `nextAction` | Next action text | string | Phoenix | true | no | section, reports, My Work |
| `nextActionDueDate` | Next action due date | date | Phoenix | true | no | section, reports, My Work |
| `assignedTo` | Assigned officer code | string | Phoenix | true | no | section, My Work |
| `status` | open / done / cancelled | string | Phoenix | true | no | section, reports |
| `archived` | Soft-delete flag | bool | Phoenix | false | no | hidden; backup |
| `archivedAt` | Archive timestamp | date | Phoenix | false | no | backup |
| `archivedBy` | Officer who archived | string | Phoenix | false | no | backup |
| `archiveReason` | Archive reason | string | Phoenix | false | no | backup |

## `issues`

| Field | Meaning | Type | Owner | Editable | Required | UI |
|---|---|---|---|---|---|---|
| `relatedType` | Parent type (standardized) | string | Phoenix | false | no | section, reports, My Work |
| `relatedId` | Parent id | string | Phoenix | false | no | section, reports, My Work |
| `issueType` | delay / missing document / customs / damage / shortage / etc. | string | Phoenix | true | no | section, reports |
| `issueCategory` | Cause / category code (root-cause classification) | string | Phoenix | true | no | section, reports, My Work |
| `severity` | low / medium / high / critical | string | Phoenix | true | no | section, reports, My Work |
| `impactType` | Operational impact: cost / time / quantity / compliance / quality | string | Phoenix | true | no | section, reports |
| `responsibleParty` | supplier / freight forwarder / customs / internal / ERP-data | string | Phoenix | true | no | section, reports |
| `targetResolutionDate` | Target resolution date (drives overdue alerts) | date | Phoenix | true | no | section, reports, My Work |
| `escalationLevel` | Escalation level: 0 none / 1 supervisor / 2 manager / 3 head | number | Phoenix | true | no | section, reports, My Work |
| `escalatedTo` | Officer/role the issue is escalated to | string | Phoenix | true | no | section, My Work |
| `resolutionCode` | Resolution outcome code | string | Phoenix | true | no | section, reports |
| `status` | open / resolved | string | Phoenix | true | no | section, reports, My Work |
| `owner` | Issue owner (officer code) | string | Phoenix | true | no | section, reports, My Work |
| `actionNotes` | What is being done | string | Phoenix | true | no | section, reports |
| `dataQualityKey` | Stable source key for a Data Quality Cockpit work item; prevents duplicate linked actions for the same finding | string | Phoenix | false | no | Data Quality Cockpit, issue detail |
| `dataQualityMessage` | Data Quality finding text captured when the linked action was created or reopened | string | Phoenix | false | no | Data Quality Cockpit, issue detail |
| `dataQualityLevel` | Source Data Quality level: info / warn / danger | string | Phoenix | false | no | Data Quality Cockpit, issue detail |
| `openedBy` | Officer who opened | string | Phoenix | false | no | section |
| `openedDate` | Opened date | date | Phoenix | false | no | section, reports |
| `resolvedDate` | Resolved date | date | Phoenix | true | no | section |
| `resolvedBy` | Officer who resolved | string | Phoenix | false | no | section |
| `resolvedAt` | Resolution timestamp | date | Phoenix | false | no | section, reports |
| `archived` | Soft-delete flag | bool | Phoenix | false | no | hidden; backup |
| `archivedAt` | Archive timestamp | date | Phoenix | false | no | backup |
| `archivedBy` | Officer who archived | string | Phoenix | false | no | backup |
| `archiveReason` | Archive reason | string | Phoenix | false | no | backup |

## `updateRequests`

| Field | Meaning | Type | Owner | Editable | Required | UI |
|---|---|---|---|---|---|---|
| `entity` | Owning entity (follows the target order/shipment) | string | Phoenix | true | no | My Work, order/shipment detail |
| `targetType` | Target record type: order or shipment | string | Phoenix | true | no | My Work, order/shipment detail |
| `orderId` | Business PO number the request is about or linked to | string | Phoenix | true | no | My Work, order/shipment detail |
| `orderDocId` | Firestore id of the linked order, where available | string | Phoenix | true | no | open order detail |
| `shipmentId` | Business shipment reference when the request targets a shipment | string | Phoenix | false | no | My Work, shipment detail |
| `shipmentDocId` | Firestore id of the shipment when the request targets a shipment | string | Phoenix | false | no | open shipment detail |
| `supplier` | Supplier name (snapshot for display) | string | Phoenix | false | no | My Work card |
| `message` | What the stakeholder is asking for (free text) | string | Phoenix | true | no | My Work card, request detail |
| `requestorCode` | Officer/user code of the requesting stakeholder (current profile; real login when available) | string | Phoenix | false | no | My Work card |
| `requestorName` | Display name of the requestor (snapshot) | string | Phoenix | false | no | My Work card |
| `targetOfficers` | Array of assigned officer codes notified (purchasing and/or logistics) | array | Phoenix | false | no | My Work routing |
| `status` | open / attended — open requests are persistent until an officer attends | string | Phoenix | true | no | My Work, order/shipment badges |
| `dueDate` | SLA due date (default request date + 3 working days) — drives on-time/overdue | date | Phoenix | false | no | My Work escalation |
| `createdAt` | When the request was raised | date | Phoenix | false | no | My Work card |
| `attendedBy` | Officer code who attended the request | string | Phoenix | false | no | request detail |
| `attendedAt` | When the request was attended | date | Phoenix | false | no | request detail |
| `attendNote` | Officer reply / what was done when attending | string | Phoenix | true | no | request detail |
| `archived` | Soft-delete flag | bool | Phoenix | false | no | hidden; backup |

## `contactLog`

| Field | Meaning | Type | Owner | Editable | Required | UI |
|---|---|---|---|---|---|---|
| `entity` | Owning entity (follows the order/shipment) | string | Phoenix | true | no | order/shipment detail, chase reports |
| `relatedType` | Linked record type: order or shipment | string | Phoenix | true | no | detail, chase reports |
| `orderId` | Business PO number this contact relates to | string | Phoenix | true | no | order detail timeline |
| `orderDocId` | Firestore id of the linked order, where available | string | Phoenix | false | no | open order detail |
| `shipmentId` | Business shipment reference when the contact targets a shipment | string | Phoenix | false | no | shipment detail timeline |
| `supplier` | Supplier name (snapshot for display) | string | Phoenix | false | no | detail, chase reports |
| `contactDate` | When the contact happened | date | Phoenix | true | no | timeline |
| `direction` | outbound (we contacted them) / inbound (they responded to us) | string | Phoenix | true | no | timeline |
| `channel` | Channel: email / phone / Teams / supplier portal / meeting / WhatsApp / other | string | Phoenix | true | no | timeline |
| `contactPerson` | Supplier-side person contacted / who responded (free text or from supplier contacts) | string | Phoenix | true | no | timeline |
| `summary` | What was said / asked / agreed (free text) | string | Phoenix | true | no | timeline |
| `responseExpectedBy` | Date a reply / action is expected back from the supplier | date | Phoenix | true | no | timeline, auto-chase |
| `officerCode` | Officer who logged the contact (current profile) | string | Phoenix | false | no | timeline |
| `officerName` | Display name of the logging officer (snapshot) | string | Phoenix | false | no | timeline |
| `createdAt` | When the log entry was created | date | Phoenix | false | no | timeline ordering |
| `archived` | Soft-delete flag | bool | Phoenix | false | no | hidden; backup |

## `kpiSnapshot`

| Field | Meaning | Type | Owner | Editable | Required | UI |
|---|---|---|---|---|---|---|
| `entity` | Entity the snapshot belongs to | string | Phoenix | true | no | KPI trends |
| `period` | Period key YYYY-MM the snapshot represents | string | Phoenix | true | no | KPI trends, x-axis |
| `values` | Object of KPI values at capture: {otifPct,mtto,avgLateness,avgClearance,overduePayments,openOrders,highRisk,...} | object | Phoenix | true | no | KPI trend charts |
| `capturedAt` | When this snapshot was captured | date | Phoenix | false | no | KPI trends |
| `capturedBy` | Officer / system that captured it (auto = automatic monthly capture) | string | Phoenix | false | no | KPI trends |
| `source` | auto (first-load-of-month) / manual (recapture) / backfill (computed from historical dates) | string | Phoenix | false | no | KPI trends |
| `archived` | Soft-delete flag | bool | Phoenix | false | no | hidden; backup |

## `status_log`

| Field | Meaning | Type | Owner | Editable | Required | UI |
|---|---|---|---|---|---|---|
| `entryType` | Record type (order/shipment/payment/...) | string | Phoenix | false | no | audit trail |
| `refId` | Record id this entry refers to | string | Phoenix | false | no | audit trail |
| `action` | created / updated / status-change / etc. | string | Phoenix | false | no | audit trail |
| `entryText` | Human description of the change | string | Phoenix | false | no | timeline |
| `officerCode` | Who made the change | string | Phoenix | false | no | timeline |
| `at` | Timestamp | date | Phoenix | false | no | timeline |
| `importRun` | Structured committed-Excel-import audit: {runId,status,source,fileName,fileSizeBytes,fileLastModified,sourceSheets,candidateCount,previewCreateCount,previewUpdateCount,entityCounts,functionCounts,sheetStats,skippedClosed,skippedUnmatched,validationErrorCount,conflictCount,unmatchedSupplierCount,groupedPOCount,activeRuleCount,storedRuleCount,created,updated,failed,processed,cancelled,rowErrors,completedAtClient} | map | Phoenix | false | no | ERP Reconciliation > Recent Import History |

## `system_config`

| Field | Meaning | Type | Owner | Editable | Required | UI |
|---|---|---|---|---|---|---|
| `value` | Counter value (e.g. RFP sequence) | number | Phoenix | false | no | internal |
| `year` | Year of the counter | number | Phoenix | false | no | internal |
| `entity` | Entity the counter belongs to | string | Phoenix | false | no | internal |
| `configKey` | Named shared configuration key, e.g. erp_import_rules | string | Phoenix | false | no | internal, ERP Import Rules |
| `rules` | ERP Import Rules array: {ruleKey, ruleType, entity, erpSource, sourceField, matchValue, requiresBlankField, secondaryField, secondaryMatchValue, resultValue, priority, active, notes} | array | Phoenix | true | no | ERP Import Rules |
| `calendars` | Business calendars array: {entity, holidays:[{date: YYYY-MM-DD, label}]} used by working-day controls | array | Phoenix | true | no | Working Calendars, Data Quality, My Work |
