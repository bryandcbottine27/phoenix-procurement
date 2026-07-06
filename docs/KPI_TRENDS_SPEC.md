# Phoenix Procurement — KPI Trends Over Time (Spec for review)

This spec covers **KPI trends over time** — turning the app's point-in-time KPIs (OTIF, lead time,
clearance, overdue payments, etc.) into month-on-month trends a procurement / supply-chain manager
can report and act on. Nothing here is built yet; this is for your review and mark-up.

Guiding principle, unchanged: **follow-up app, not an ERP.** Trends are computed from the operational
data the app already holds — no new transactional source.

The value in one line: a number like "OTIF 87%" tells you nothing on its own. "OTIF 87%, down from
93% last month, third month falling" tells you to act, and on what. Trends are what make the existing
KPIs *managerial* rather than just operational.

---

## What exists today

The Dashboard computes these live, for the active entity, from current data:
- **OTIF** (on-time-in-full): received-by-requested-date %.
- **MTTO** (mean time to order).
- **Shipment lateness** average (days vs ETA).
- **Average clearance** time (target 3 days).
- **Overdue payments**, open foreign/local orders, in-transit, under-clearance counts.
- Risk / follow-up / promise-overdue / ERP-exception counts (from `procurementFollowup`).

Every one of these is **point-in-time** — recomputed from scratch on each render, with no memory of
what it was last week or last month. There is no history, and no trend.

---

## The core decision: where does history come from?

To show a trend you need the KPI's value at past points in time. The app currently keeps none. Three
ways to get it, with my recommendation:

### Option A — Periodic KPI snapshot (recommended)
The app stores a small `kpiSnapshot` record per entity per period (month), holding the computed KPI
values at that time. A trend is just the series of snapshots.
- **Pros:** clean, cheap (one small record per entity per month), exact (stores the real value as it
  was), fast to chart, works regardless of later data edits.
- **Cons:** needs a capture trigger (see below); a month with no capture has a gap.
- **Capture trigger options:** (1) a manual "Capture this month's KPIs" button (simplest, reliable,
  officer-controlled); (2) auto-capture on first app load of a new month (zero effort, but depends on
  someone opening the app); (3) both — auto with a manual override/recapture. **Recommendation: both**,
  defaulting to auto-on-first-load-of-month with a manual "recapture now" for corrections.

### Option B — Reconstruct history from the audit log
Derive past KPI values by replaying `status_log` / record history.
- **Pros:** no new store; history exists retroactively from day one.
- **Cons:** heavy and fragile — KPIs like OTIF depend on many fields at a point in time, which the
  audit log doesn't fully capture; reconstruction would be approximate and slow. Not recommended as
  the primary mechanism.

### Option C — Recompute "as-of" each month from current records
Filter current records by date (e.g. orders received in May) and compute the KPI for that window.
- **Pros:** no stored history; recalculates on demand.
- **Cons:** only works for KPIs that are cleanly date-bucketable (OTIF by receipt month: yes; "open
  orders right now": no — you can't recover how many were open last March from today's data). Good as
  a *complement* for the date-bucketable KPIs, not a full solution.

**Recommended approach: A as the backbone (snapshot monthly), with C used where it's naturally exact**
(e.g. OTIF computed for each receipt-month from the actual GRN dates, so even past months before
snapshots began can be shown). This gives reliable forward trends immediately and as much backfill as
the data honestly supports.

---

## What I would build

### 1. Extract the KPI computations into a reusable engine
Today the KPI math lives inline in `dashboard.js`. Move it into a `PXKpi` engine that returns a plain
object of KPI values for a given entity (and optionally a date window), e.g.
`{ otifPct, mtto, avgLateness, avgClearance, overduePayments, openOrders, ... }`. The live dashboard
then calls the same engine — single source of truth, so the trend and the dashboard can never
disagree. (Low risk: it's a refactor of existing logic, covered by the build-time invariant tests.)

### 2. `kpiSnapshot` collection + capture
A small record per entity per period: `{ entity, period: '2026-06', capturedAt, capturedBy, values:{...} }`.
Auto-capture on first load of a new month; a manual "Capture / recapture this month" button on the
new KPI view. Last-write-wins per (entity, period).

### 3. A "KPI Trends" view (under Reports & Controls)
- **Trend tiles**: each KPI shown as its current value + direction vs last period (▲ improving /
  ▼ worsening, colour-coded by whether up is good for that metric — e.g. up is good for OTIF, bad for
  lateness).
- **Trend charts**: a simple line/bar per KPI over the last 6–12 periods. (Charting: lightweight inline
  SVG so it stays in the single-file build with no new dependency.)
- **Period selector** and entity scope (like every other view).
- **Export**: the trend series as CSV for the monthly pack.

### 4. Trend direction on the main Dashboard (optional, high-impact)
Add a small "▲/▼ vs last month" indicator to the existing dashboard KPI tiles, reading the latest two
snapshots. This puts the trend where managers already look, not only in a separate view.

---

## KPIs to trend (initial set, all already computed)

| KPI | Up is… | Source |
|---|---|---|
| OTIF % | good | dashboard OTIF logic (also date-bucketable for backfill) |
| Average shipment lateness (days) | bad | dashboard lateness |
| Average clearance time (days) | bad | dashboard clearance |
| MTTO (days) | bad | dashboard MTTO |
| Overdue payments (count) | bad | dashboard overdue |
| Open orders (count) | neutral | dashboard counts |
| High-risk orders (count) | bad | procurementFollowup |

The set is easy to extend once the engine + snapshot exist (e.g. demurrage MUR, on-time-payment %
when those features mature).

---

## Build status — BUILT & SHIPPED

All decisions below were taken as recommended and the feature is built, verified, and documented
(PHOENIX_DEVELOPER_NOTES.md section 13m; pilot scenario 36):
- Capture trigger: **auto on first use each month + manual recapture + backfill** button.
- Backfill: **yes** — date-bucketable KPIs (OTIF, MTTO, lateness, clearance) computed from real
  2024-onward dates; count KPIs trend forward from first capture.
- Location: **both** — a dedicated KPI Trends view and ▲/▼ indicators on the Dashboard tiles.
- Granularity: **monthly**.
- Charting: **inline SVG** (no new dependency).

Go-live behaviour confirmed by test: old/incomplete orders are excluded from a KPI's sample, never
blocking a calculation or the app; empty months are skipped; backfill is idempotent.

---

## Decisions to confirm

1. **Capture trigger**: auto-on-first-load-of-month + manual recapture (my recommendation), or
   manual-only, or auto-only?
2. **Backfill**: should I compute OTIF (and other date-bucketable KPIs) for past months from existing
   GRN dates so the trend isn't empty on day one — accepting that count-type KPIs (open orders,
   overdue) can only trend forward from first snapshot? Recommendation: yes, backfill what's honest.
3. **Where the trend lives**: a dedicated "KPI Trends" view, dashboard indicators, or both?
   Recommendation: both — the view for analysis, the indicators for daily glance.
4. **Period granularity**: monthly (recommended for management reporting), or also weekly?
5. **Charting**: inline SVG (keeps the single-file build dependency-free) — confirm that's acceptable
   vs a charting library.

---

## Why this is the right foundation

Once KPIs are snapshotted over time, every other analytic you might want later — supplier league
tables over time, cycle-time trends, demurrage-cost trends — becomes "add another value to the
snapshot," not a new architecture. This phase builds the spine; the rest is incremental.

## What I need from you
Mark this up: the five decisions above, which KPIs matter most for your monthly reporting, and
anything missing from the KPI set. Once you confirm, I'll build it the same way as the follow-up
phases — verified, invariant-checked, documented, and shipped.
