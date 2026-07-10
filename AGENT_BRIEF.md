# SSSIHMS Fleet — module developer brief

You are building ONE JavaScript module file for a static, framework-free fleet-management
prototype for SSSIHMS hospital (Whitefield, Bangalore). Full functional spec:
`TRANSPORT_AMBULANCE_FLEET_TRACKING_SPECS.md` (in this directory). Foundation is already built.

## Hard rules
- Write ONLY your assigned file under `js/modules/`. Do NOT modify index.html, db.js, app.js, brand.css or other modules.
- Plain ES5/ES6 browser JS in an IIFE, no imports/exports, no build step, no frameworks.
- Read `js/db.js` and `js/app.js` FIRST — their header comments document the full API
  (DB.list/get/insert/update/softDelete/nextNumber/audit/getSettings; App.registerModule,
  App.form/table/modal/toast/badge/exportCSV/fmtDate/fmtINR/fmtNum/daysUntil/docStatus/can/
  vehicleName/driverName/vendorName/el/esc). Use these helpers — do not reinvent them.
- Register with `App.registerModule({ id, title, order, render(container, params) })`.
- Dates display as DD-MMM-YYYY via App.fmtDate; money via App.fmtINR (Indian numbering).
- Permission-gate all mutating actions with App.can(action) — hide or disable buttons the
  current role can't use. Every insert/update goes through DB.insert/DB.update (auto-audited).
- Soft delete only (DB.softDelete). Odometer rules: values must move forward; validate.
- Status badge CSS classes already exist for common statuses (see brand.css badge list).
- Cross-links: vehicle detail page is `#/vehicles/<id>` (owned by masters module). Link
  vehicle names there with `<a class="rowlink" href="#/vehicles/ID">...</a>`.
- Seed data exists — build list pages so they look alive immediately.
- Keep the file self-contained and defensive (missing refs → '—').

## Module assignments (each agent builds exactly one row)

| File | id / nav title / order | Scope |
|---|---|---|
| js/modules/dashboard.js | `dashboard` / "Dashboard" / 1 | Spec §5.1: stat tiles (fleet by status, ambulances available, PM due/overdue, docs expiring 90/60/30/7/0, monthly fuel + maintenance cost, open breakdowns, readiness failures, top cost vehicles, cost/km, fuel efficiency), filters (date range, vehicle type, dept, status). Compute from DB collections. Tiles link to relevant pages. |
| js/modules/masters.js | `vehicles` / "Fleet Register" / 2 | Spec §4.1–4.4, §5.2, §5.10: vehicle list w/ filters + CRUD, driver register + CRUD, vendor register + CRUD (tabs or sub-nav). Vehicle detail page at `#/vehicles/<id>` with tabbed sections: profile, fuel history, maintenance history, PM schedules, breakdowns, documents, cost summary, audit trail, printable QR label (use `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=<encoded url>` img). Unique regNo + assetCode validation. |
| js/modules/trips.js | `trips` / "Trips & Ambulance" / 3 | Spec §5.3–5.4: trip list + request/approve/assign/start/complete/cancel lifecycle, overlap + odometer validations, completing updates vehicle odometer/status; ambulance trips get extended emergency fields (times, response time computed, oxygen, disinfection, handover); readiness checklist entry per ambulance per day — critical failure (settings.criticalChecklistItems) marks ambulance unavailable + creates breakdown ticket; block dispatch of non-ready/non-compliant vehicles with override for App.can('override'). |
| js/modules/fuel.js | `fuel` / "Fuel" / 4 | Spec §5.5: fuel log list w/ filters + entry form (auto amount = qty × rate), verification workflow (draft/submitted/verified/rejected via fuel.verify perm), distance since last fill, full-tank-to-full-tank efficiency, cost/km, variance vs vehicle.mileageBenchmark, validations (positive qty/rate, odometer forward, duplicate bill warn, tank capacity, odometer jump tolerance, approval above threshold), per-vehicle efficiency summary table, CSV export. Completing a fuel entry updates vehicle.odometer if greater. |
| js/modules/maintenance.js | `maintenance` / "Maintenance" / 5 | Spec §5.6–5.7: PM schedules (due by date OR km, whichever first; due/overdue badges), record completion (parts/labor/other/taxes/discount → total, next-due recompute, vehicle odometer update, downtime, fitness), breakdown tickets full lifecycle (severity, safety/readiness impact auto-marks vehicle unavailable; closing requires root cause + corrective action + final vehicle status; cost components → total). |
| js/modules/compliance.js | `compliance` / "Compliance" / 6 | Spec §5.9 + §5.11: document register (vehicle & driver docs) + CRUD, expiry status via App.docStatus, reminders view grouped by 90/60/30/7/0/overdue buckets, non-compliance: expired critical docs (Insurance, Fitness certificate, Permit, Driver license) flag vehicle/driver non-compliant (surface a helper `window.Compliance.isVehicleCompliant(id)` / `isDriverCompliant(id)` for other modules), driver license expiry list, CSV export. |
| js/modules/reports.js | `reports` / "Reports" / 7 | Spec §5.12: report picker rendering each report as filterable table + CSV export + print button (window.print): vehicle master, availability, trip register, ambulance response, readiness failures, fuel consumption/efficiency/vendor spend, PM due + history, breakdown, downtime, maintenance cost, vehicle total cost, cost/km, compliance expiry, driver license expiry, vendor spend, high-cost vehicles. Shared filter bar (date range, vehicle, type, dept, vendor). |

## Definition of done for your module
- Registers and renders without console errors against the seeded data.
- All lists show seeded records; forms validate per spec; mutations audit automatically.
- Role gating works (switch role in header).
- No modification to any file other than your own.
