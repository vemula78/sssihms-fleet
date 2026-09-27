(function () {
  function num(v) { return Number(v || 0); }
  function isoToday() { return new Date().toISOString().slice(0, 10); }
  function monthStart() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01'; }
  function uniq(rows, key) { return rows.map(r => r[key]).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).sort(); }
  function dateOnly(v) { return (v || '').slice(0, 10); }
  function inRange(date, f) {
    const d = dateOnly(date);
    if (!d) return true;
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;
    return true;
  }
  function vehicleOk(vehicleId, f) {
    const v = DB.get('vehicles', vehicleId);
    if (!v) return !f.vehicle && !f.type && !f.department;
    return (!f.vehicle || v.id === f.vehicle) && (!f.type || v.type === f.type) && (!f.department || v.department === f.department);
  }
  function linkVehicle(id) { return '<a class="rowlink" href="#/vehicles/' + App.esc(id) + '">' + App.esc(App.vehicleName(id)) + '</a>'; }
  function downtimeDays(row) {
    if (!row.downtimeStart) return 0;
    const end = row.downtimeEnd || isoToday();
    return Math.max(0, Math.ceil((new Date(dateOnly(end) + 'T00:00') - new Date(dateOnly(row.downtimeStart) + 'T00:00')) / 86400000) + 1);
  }
  function fuelStats(vehicleId, f) {
    const logs = DB.list('fuelLogs').filter(r => r.vehicleId === vehicleId && FleetRules.isTrustedFuelLog(r) && inRange(r.date, f)).sort((a, b) => num(a.odometer) - num(b.odometer));
    const qty = logs.reduce((s, r) => s + num(r.qty), 0);
    const amount = logs.reduce((s, r) => s + num(r.amount), 0);
    const km = logs.length > 1 ? Math.max(0, num(logs[logs.length - 1].odometer) - num(logs[0].odometer)) : 0;
    return { qty, amount, km, kmpl: qty ? km / qty : null, costPerKm: km ? amount / km : null };
  }
  function maintCost(vehicleId, f) {
    return DB.list('pmRecords').filter(r => r.vehicleId === vehicleId && inRange(r.serviceDate, f)).reduce((s, r) => s + num(r.totalCost), 0) +
      DB.list('breakdowns').filter(r => r.vehicleId === vehicleId && inRange(r.reportedAt, f)).reduce((s, r) => s + num(r.totalCost), 0);
  }
  function totalCost(vehicleId, f) {
    return fuelStats(vehicleId, f).amount + maintCost(vehicleId, f);
  }
  function pmState(p) {
    const v = DB.get('vehicles', p.vehicleId);
    const byDate = App.daysUntil(p.nextDueDate);
    const byKm = v && p.nextDueOdo != null ? p.nextDueOdo - num(v.odometer) : null;
    if ((byDate != null && byDate < 0) || (byKm != null && byKm < 0)) return 'overdue';
    if ((byDate != null && byDate <= 30) || (byKm != null && byKm <= 1000)) return 'due';
    return 'ok';
  }
  function responseMins(t) {
    if (!t.ambulance || !t.ambulance.callReceivedAt || !t.ambulance.arrivePickupAt) return null;
    return Math.round((new Date(t.ambulance.arrivePickupAt) - new Date(t.ambulance.callReceivedAt)) / 60000);
  }
  function cols(list) {
    return list.map(c => typeof c === 'string' ? { key: c, label: c.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()) } : c);
  }
  function csvRows(columns, rows) {
    return rows.map(r => columns.map(c => {
      if (c.csv) return c.csv(r);
      const v = r[c.key];
      return v == null ? '' : v;
    }));
  }
  const reports = [
    { id: 'vehicle-master', title: 'Vehicle master report', build: f => {
      const rows = DB.list('vehicles').filter(v => vehicleOk(v.id, f));
      return { rows, columns: cols([
        { key: 'vehicle', label: 'Vehicle', render: r => linkVehicle(r.id), csv: r => App.vehicleName(r.id) }, 'type', 'department', 'baseLocation', 'status', 'odometer', 'fuelType', 'ownership'
      ]) };
    } },
    { id: 'availability', title: 'Vehicle availability report', build: f => ({ rows: DB.list('vehicles').filter(v => vehicleOk(v.id, f)), columns: cols([
      { key: 'vehicle', label: 'Vehicle', render: r => linkVehicle(r.id), csv: r => App.vehicleName(r.id) }, 'type', 'department', 'status',
      { key: 'activeTrip', label: 'Active trip', render: r => (DB.list('trips').find(t => t.vehicleId === r.id && ['assigned','started'].indexOf(t.status) !== -1) || {}).tripNo || '—' }
    ]) }) },
    { id: 'trip-register', title: 'Trip register', build: f => ({ rows: DB.list('trips').filter(r => inRange(r.requestedAt, f) && vehicleOk(r.vehicleId, f)), columns: cols([
      'tripNo', { key: 'requestedAt', label: 'Requested', render: r => App.fmtDateTime(r.requestedAt), csv: r => r.requestedAt }, 'source', 'requestingDept',
      { key: 'vehicleId', label: 'Vehicle', render: r => linkVehicle(r.vehicleId), csv: r => App.vehicleName(r.vehicleId) },
      { key: 'driverId', label: 'Driver', render: r => App.esc(App.driverName(r.driverId)), csv: r => App.driverName(r.driverId) }, 'status', 'distance'
    ]) }) },
    { id: 'ambulance-response', title: 'Ambulance emergency response report', build: f => ({ rows: DB.list('trips').filter(r => r.ambulance && inRange(r.requestedAt, f) && vehicleOk(r.vehicleId, f)), columns: cols([
      'tripNo', { key: 'vehicleId', label: 'Ambulance', render: r => linkVehicle(r.vehicleId), csv: r => App.vehicleName(r.vehicleId) }, 'priority',
      { key: 'callReceivedAt', label: 'Call received', render: r => App.fmtDateTime(r.ambulance.callReceivedAt), csv: r => r.ambulance.callReceivedAt },
      { key: 'arrivePickupAt', label: 'Arrive pickup', render: r => App.fmtDateTime(r.ambulance.arrivePickupAt), csv: r => r.ambulance.arrivePickupAt },
      { key: 'response', label: 'Response mins', num: true, render: r => App.fmtNum(responseMins(r), 0), csv: r => responseMins(r) }, { key: 'disinfectionDone', label: 'Disinfected', render: r => r.ambulance.disinfectionDone ? 'Yes' : 'No' }
    ]) }) },
    { id: 'readiness-failures', title: 'Ambulance readiness failure report', build: f => ({ rows: DB.list('readinessChecks').filter(r => r.result === 'fail' && inRange(r.date, f) && vehicleOk(r.vehicleId, f)), columns: cols([
      { key: 'date', label: 'Date', render: r => App.fmtDate(r.date), csv: r => r.date }, { key: 'vehicleId', label: 'Vehicle', render: r => linkVehicle(r.vehicleId), csv: r => App.vehicleName(r.vehicleId) }, 'checkedBy',
      { key: 'failedItems', label: 'Failed items', render: r => App.esc((r.failedItems || []).join(', ')), csv: r => (r.failedItems || []).join(', ') }, 'remarks'
    ]) }) },
    { id: 'fuel-consumption', title: 'Fuel consumption report', build: f => ({ rows: DB.list('fuelLogs').filter(r => inRange(r.date, f) && vehicleOk(r.vehicleId, f) && (!f.vendor || r.vendorId === f.vendor)), columns: cols([
      'logNo', { key: 'date', label: 'Date', render: r => App.fmtDate(r.date), csv: r => r.date }, { key: 'vehicleId', label: 'Vehicle', render: r => linkVehicle(r.vehicleId), csv: r => App.vehicleName(r.vehicleId) },
      { key: 'vendorId', label: 'Vendor', render: r => App.esc(App.vendorName(r.vendorId)), csv: r => App.vendorName(r.vendorId) }, 'qty', 'rate', { key: 'amount', label: 'Amount', num: true, render: r => App.fmtINR(r.amount), csv: r => r.amount }, 'odometer', 'status'
    ]) }) },
    { id: 'fuel-efficiency', title: 'Fuel efficiency report', build: f => {
      const rows = DB.list('vehicles').filter(v => vehicleOk(v.id, f)).map(v => Object.assign({ vehicleId: v.id, benchmark: v.mileageBenchmark }, fuelStats(v.id, f)));
      return { rows, columns: cols([{ key: 'vehicleId', label: 'Vehicle', render: r => linkVehicle(r.vehicleId), csv: r => App.vehicleName(r.vehicleId) }, 'km', 'qty', { key: 'kmpl', label: 'Km/L', num: true, render: r => App.fmtNum(r.kmpl, 1) }, 'benchmark', { key: 'costPerKm', label: 'Fuel cost/km', num: true, render: r => r.costPerKm == null ? '—' : App.fmtINR(r.costPerKm) }]) };
    } },
    { id: 'fuel-vendor-spend', title: 'Fuel vendor spend report', build: f => {
      const map = {}; DB.list('fuelLogs').filter(r => FleetRules.isTrustedFuelLog(r) && inRange(r.date, f) && vehicleOk(r.vehicleId, f) && (!f.vendor || r.vendorId === f.vendor)).forEach(r => { const k = r.vendorId || 'none'; map[k] = map[k] || { vendorId: k, qty: 0, amount: 0, bills: 0 }; map[k].qty += num(r.qty); map[k].amount += num(r.amount); map[k].bills++; });
      return { rows: Object.values(map), columns: cols([{ key: 'vendorId', label: 'Vendor', render: r => App.esc(App.vendorName(r.vendorId)), csv: r => App.vendorName(r.vendorId) }, 'bills', 'qty', { key: 'amount', label: 'Spend', num: true, render: r => App.fmtINR(r.amount), csv: r => r.amount }]) };
    } },
    { id: 'pm-due', title: 'Preventive maintenance due report', build: f => ({ rows: DB.list('pmSchedules').filter(r => r.status !== 'closed' && vehicleOk(r.vehicleId, f)), columns: cols([
      { key: 'vehicleId', label: 'Vehicle', render: r => linkVehicle(r.vehicleId), csv: r => App.vehicleName(r.vehicleId) }, 'maintenanceType', { key: 'nextDueDate', label: 'Due date', render: r => App.fmtDate(r.nextDueDate), csv: r => r.nextDueDate }, 'nextDueOdo',
      { key: 'state', label: 'State', render: r => App.badge(pmState(r), pmState(r)), csv: r => pmState(r) }, 'assignedTo', { key: 'estCost', label: 'Est cost', num: true, render: r => App.fmtINR(r.estCost), csv: r => r.estCost }
    ]) }) },
    { id: 'pm-history', title: 'Preventive maintenance history report', build: f => ({ rows: DB.list('pmRecords').filter(r => inRange(r.serviceDate, f) && vehicleOk(r.vehicleId, f) && (!f.vendor || r.vendorId === f.vendor)), columns: cols([
      { key: 'serviceDate', label: 'Date', render: r => App.fmtDate(r.serviceDate), csv: r => r.serviceDate }, { key: 'vehicleId', label: 'Vehicle', render: r => linkVehicle(r.vehicleId), csv: r => App.vehicleName(r.vehicleId) },
      { key: 'vendorId', label: 'Vendor', render: r => App.esc(App.vendorName(r.vendorId)), csv: r => App.vendorName(r.vendorId) }, 'serviceOdo', 'workPerformed', { key: 'totalCost', label: 'Total', num: true, render: r => App.fmtINR(r.totalCost), csv: r => r.totalCost }, 'fitness'
    ]) }) },
    { id: 'breakdown', title: 'Breakdown report', build: f => ({ rows: DB.list('breakdowns').filter(r => inRange(r.reportedAt, f) && vehicleOk(r.vehicleId, f) && (!f.vendor || r.assignedVendorId === f.vendor)), columns: cols([
      'ticketNo', { key: 'reportedAt', label: 'Reported', render: r => App.fmtDateTime(r.reportedAt), csv: r => r.reportedAt }, { key: 'vehicleId', label: 'Vehicle', render: r => linkVehicle(r.vehicleId), csv: r => App.vehicleName(r.vehicleId) }, 'issueCategory', 'severity', 'status', { key: 'totalCost', label: 'Cost', num: true, render: r => App.fmtINR(r.totalCost), csv: r => r.totalCost }
    ]) }) },
    { id: 'downtime', title: 'Vehicle downtime report', build: f => ({ rows: DB.list('breakdowns').filter(r => inRange(r.reportedAt, f) && vehicleOk(r.vehicleId, f)).map(r => Object.assign({ days: downtimeDays(r) }, r)), columns: cols([
      'ticketNo', { key: 'vehicleId', label: 'Vehicle', render: r => linkVehicle(r.vehicleId), csv: r => App.vehicleName(r.vehicleId) }, { key: 'downtimeStart', label: 'Start', render: r => App.fmtDateTime(r.downtimeStart), csv: r => r.downtimeStart }, { key: 'downtimeEnd', label: 'End', render: r => App.fmtDateTime(r.downtimeEnd), csv: r => r.downtimeEnd }, 'days', 'status'
    ]) }) },
    { id: 'maintenance-cost', title: 'Maintenance cost report', build: f => ({ rows: DB.list('vehicles').filter(v => vehicleOk(v.id, f)).map(v => ({ vehicleId: v.id, cost: maintCost(v.id, f) })).filter(r => r.cost > 0), columns: cols([{ key: 'vehicleId', label: 'Vehicle', render: r => linkVehicle(r.vehicleId), csv: r => App.vehicleName(r.vehicleId) }, { key: 'cost', label: 'Maintenance cost', num: true, render: r => App.fmtINR(r.cost), csv: r => r.cost }]) }) },
    { id: 'vehicle-total-cost', title: 'Vehicle total cost report', build: f => ({ rows: DB.list('vehicles').filter(v => vehicleOk(v.id, f)).map(v => ({ vehicleId: v.id, total: totalCost(v.id, f), fuel: fuelStats(v.id, f).amount, maintenance: maintCost(v.id, f) })).sort((a, b) => b.total - a.total), columns: cols([{ key: 'vehicleId', label: 'Vehicle', render: r => linkVehicle(r.vehicleId), csv: r => App.vehicleName(r.vehicleId) }, { key: 'fuel', label: 'Fuel', num: true, render: r => App.fmtINR(r.fuel), csv: r => r.fuel }, { key: 'maintenance', label: 'Maintenance', num: true, render: r => App.fmtINR(r.maintenance), csv: r => r.maintenance }, { key: 'total', label: 'Total', num: true, render: r => App.fmtINR(r.total), csv: r => r.total }]) }) },
    { id: 'cost-per-km', title: 'Cost per kilometer report', build: f => ({ rows: DB.list('vehicles').filter(v => vehicleOk(v.id, f)).map(v => { const fs = fuelStats(v.id, f); const total = totalCost(v.id, f); return { vehicleId: v.id, km: fs.km, total, cpk: fs.km ? total / fs.km : null }; }), columns: cols([{ key: 'vehicleId', label: 'Vehicle', render: r => linkVehicle(r.vehicleId), csv: r => App.vehicleName(r.vehicleId) }, 'km', { key: 'total', label: 'Total cost', num: true, render: r => App.fmtINR(r.total), csv: r => r.total }, { key: 'cpk', label: 'Cost/km', num: true, render: r => r.cpk == null ? '—' : App.fmtINR(r.cpk), csv: r => r.cpk }]) }) },
    { id: 'compliance-expiry', title: 'Compliance expiry report', build: f => ({ rows: DB.list('documents').filter(r => inRange(r.expiryDate, f) && (!r.vehicleId || vehicleOk(r.vehicleId, f))), columns: cols(['docType', { key: 'subject', label: 'Subject', render: r => r.vehicleId ? linkVehicle(r.vehicleId) : App.esc(App.driverName(r.driverId)), csv: r => r.vehicleId ? App.vehicleName(r.vehicleId) : App.driverName(r.driverId) }, 'docNo', { key: 'expiryDate', label: 'Expiry', render: r => App.fmtDate(r.expiryDate), csv: r => r.expiryDate }, { key: 'status', label: 'Status', render: r => { const s = App.docStatus(r.expiryDate); return App.badge(s.label, s.cls); }, csv: r => App.docStatus(r.expiryDate).label }]) }) },
    { id: 'driver-license-expiry', title: 'Driver license expiry report', build: f => ({ rows: DB.list('drivers').filter(d => inRange(d.licenseExpiry, f) && (!f.department || vehicleOk(d.assignedVehicleId, f))), columns: cols(['driverId', 'name', 'licenseNo', 'licenseClass', { key: 'licenseExpiry', label: 'Expiry', render: r => App.fmtDate(r.licenseExpiry), csv: r => r.licenseExpiry }, { key: 'status', label: 'Status', render: r => { const s = App.docStatus(r.licenseExpiry); return App.badge(s.label, s.cls); }, csv: r => App.docStatus(r.licenseExpiry).label }]) }) },
    { id: 'vendor-performance', title: 'Vendor performance report', build: f => {
      const rows = DB.list('vendors').filter(v => !f.vendor || v.id === f.vendor).map(v => {
        const fuel = DB.list('fuelLogs').filter(r => r.vendorId === v.id && FleetRules.isTrustedFuelLog(r) && inRange(r.date, f)).reduce((s, r) => s + num(r.amount), 0);
        const pm = DB.list('pmRecords').filter(r => r.vendorId === v.id && inRange(r.serviceDate, f)).reduce((s, r) => s + num(r.totalCost), 0);
        const bd = DB.list('breakdowns').filter(r => r.assignedVendorId === v.id && inRange(r.reportedAt, f)).reduce((s, r) => s + num(r.totalCost), 0);
        return { vendorId: v.id, type: v.type, active: v.active ? 'Yes' : 'No', spend: fuel + pm + bd };
      });
      return { rows, columns: cols([{ key: 'vendorId', label: 'Vendor', render: r => App.esc(App.vendorName(r.vendorId)), csv: r => App.vendorName(r.vendorId) }, 'type', 'active', { key: 'spend', label: 'Spend', num: true, render: r => App.fmtINR(r.spend), csv: r => r.spend }]) };
    } },
    { id: 'high-cost', title: 'High-cost vehicle report', build: f => ({ rows: DB.list('vehicles').filter(v => vehicleOk(v.id, f)).map(v => ({ vehicleId: v.id, total: totalCost(v.id, f) })).sort((a, b) => b.total - a.total).slice(0, 10), columns: cols([{ key: 'vehicleId', label: 'Vehicle', render: r => linkVehicle(r.vehicleId), csv: r => App.vehicleName(r.vehicleId) }, { key: 'total', label: 'Total cost', num: true, render: r => App.fmtINR(r.total), csv: r => r.total }]) }) }
  ];
  function renderFilterBar(container, reportId, f, run) {
    const vehicles = DB.list('vehicles');
    const form = App.form([
      { name: 'report', label: 'Report', type: 'select', required: true, options: reports.map(r => ({ value: r.id, label: r.title })), value: reportId },
      { name: 'from', label: 'From', type: 'date', value: f.from },
      { name: 'to', label: 'To', type: 'date', value: f.to },
      { name: 'vehicle', label: 'Vehicle', type: 'select', options: vehicles.map(v => ({ value: v.id, label: App.vehicleName(v.id) })), value: f.vehicle },
      { name: 'type', label: 'Type', type: 'select', options: uniq(vehicles, 'type').map(x => ({ value: x, label: x })), value: f.type },
      { name: 'department', label: 'Department', type: 'select', options: uniq(vehicles, 'department').map(x => ({ value: x, label: x })), value: f.department },
      { name: 'vendor', label: 'Vendor', type: 'select', options: DB.list('vendors').map(v => ({ value: v.id, label: v.name })), value: f.vendor },
    ], Object.assign({ report: reportId }, f));
    const bar = App.el('<div class="filter-bar"></div>');
    bar.appendChild(form.el);
    const apply = App.el('<button class="btn">Run</button>');
    apply.addEventListener('click', () => { const next = form.read(); run(next.report, next); });
    bar.appendChild(apply);
    container.appendChild(bar);
  }
  function render(container, params) {
    const reportId = params && params[0] ? params[0] : 'vehicle-master';
    const filters = Object.assign({ from: monthStart(), to: isoToday() }, params && params[1] ? JSON.parse(decodeURIComponent(params[1])) : {});
    const report = reports.find(r => r.id === reportId) || reports[0];
    function run(nextReport, nextFilters) {
      delete nextFilters.report;
      location.hash = '#/reports/' + nextReport + '/' + encodeURIComponent(JSON.stringify(nextFilters));
    }
    container.innerHTML = '<div class="page-title"><div><h2>Reports</h2><p class="text-muted">Spec 5.12 filtered reports with CSV export and print view.</p></div><button class="btn secondary" id="print-report">Print</button></div>';
    renderFilterBar(container, report.id, filters, run);
    const built = report.build(filters);
    const actions = App.el('<div class="page-title"><h3>' + App.esc(report.title) + '</h3><button class="btn" id="csv-report">Export CSV</button></div>');
    container.appendChild(actions);
    container.appendChild(App.table({ columns: built.columns, rows: built.rows, empty: 'No records for selected filters.' }));
    container.querySelector('#print-report').addEventListener('click', () => window.print());
    container.querySelector('#csv-report').addEventListener('click', () => App.exportCSV(report.id + '.csv', built.columns.map(c => c.label), csvRows(built.columns, built.rows)));
  }
  App.registerModule({ id: 'reports', title: 'Reports', order: 7,
    roles: ['Transport Manager','Finance User','Management Viewer'], render: render });
})();
