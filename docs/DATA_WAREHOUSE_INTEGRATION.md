# Phoenix Procurement — Data Warehouse Integration Contract

## Target Architecture

Phoenix Procurement should not connect directly to Navision, Business Central, or the Data Warehouse from the browser.

```
Navision / Business Central
        -> Data Warehouse / staging views
        -> controlled sync/API service
        -> Phoenix Procurement
```

## Responsibility Split

ERP/Data Warehouse owns:

- PO number, supplier/vendor, vendor code, currency, amount, PO date, description.
- IPR number, HOD approval date, claimant/requested-by where available.
- ERP PO lifecycle status, receipt/invoice/payment facts when those feeds are added.
- ERP source metadata and warehouse provenance.

Phoenix owns:

- Operational status, notes, milestones, shipments, documents, follow-ups, issues.
- Payment request workflow, readiness controls, warning queues, closure decisions.
- Supplier-master enrichment, contacts, ratings, aliases and manual mapping decisions.

## Order Staging Fields

The future staging view/API should provide a canonical purchase-order row compatible with `src/warehouseAdapter.js`.

Important fields:

- `integrationLayer`
- `entity`
- `erpSource` (`Navision` or `Business Central`)
- `erpCompany`
- `erpEntityId`
- `erpDocumentId`
- `erpDocumentNo`
- `orderId`
- `erpVendorNo`
- `erpVendorName`
- `supplier`
- `currency`
- `amount`
- `dateOfOrder`
- `description`
- `paymentTerms`
- `category`
- `iprNumber`
- `iprApprovedDate`
- `claimant`
- `erpPoStatus`
- `lines`
- `warehouseSource`
- `warehouseRecordId`
- `warehouseBatchId`
- `warehouseExtractedAt`
- `warehouseLoadedAt`
- `warehouseHash`

## Sync Rule

On update, the sync may refresh ERP-owned and ERP-seeded fields only.

It must not overwrite Phoenix operational data, including `status`, `milestones`, shipments, documents, follow-ups, issues, payment requests, notes, closure fields, supplier commitment / chase fields (`supplierPromisedDate`, `supplierRevisedPromisedDate`, `nextSupplierFollowupDate`, etc.), or risk/readiness controls.

## Current Demo Feed

Until the warehouse sync exists, the Excel import acts as a manual staging feed. It stamps orders with:

- `integrationLayer: excel-import`
- `warehouseSource: manual-excel:<sheet>`
- `warehouseRecordId`
- `warehouseBatchId`
- `warehouseExtractedAt`
- `warehouseLoadedAt`

This keeps the demo feed compatible with the future Data Warehouse path.
