(function () {
  function isoToday() { return new Date().toISOString().slice(0, 10); }
  function startOfMonth() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01'; }
  function num(v) { return Number(v || 0); }
  function inRange(date, filters) {
    const d = (date || '').slice(0, 10);
    if (!d) return true;
    if (filters.from && d < filters.from) return false;
    if (filters.to && d > filters.to) return false;
    return true;
  }
  function uniq(rows, key) {
    return rows.map(r => r[key]).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).sort();
  }
  function vehicleLink(id) {
    return '<a class="rowlink" href="#/vehicles/' + App.esc(id) + '">' + App.esc(App.vehicleName(id)) + '</a>';
  }
  function vehicleMatches(v, f) {
    if (!v) return false;
    return (!f.type || v.type === f.type) &&
      (!f.department || v.department === f.department) &&
      (!f.baseLocation || v.baseLocation === f.baseLocation) &&
      (!f.status || v.status === f.status);
  }
  function filterVehicles(f) { return DB.list('vehicles').filter(v => vehicleMatches(v, f)); }
  function byVehicle(rows, vehicles) {
    const ids = vehicles.map(v => v.id);
    return rows.filter(r => !r.vehicleId || ids.indexOf(r.vehicleId) !== -1);
  }
  function latestReadiness(vehicleId) {
    return DB.list('readinessChecks')
      .filter(r => r.vehicleId === vehicleId)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  }
  function pmState(schedule) {
    const v = DB.get('vehicles', schedule.vehicleId);
    const byDate = App.daysUntil(schedule.nextDueDate);
    const byKm = v && schedule.nextDueOdo != null ? schedule.nextDueOdo - num(v.odometer) : null;
    const overdue = (byDate != null && byDate < 0) || (byKm != null && byKm < 0);
    const due = overdue || (byDate != null && byDate <= 30) || (byKm != null && byKm <= 1000);
    return overdue ? 'overdue' : due ? 'due' : 'ok';
  }
  function totalCost(vehicleId, f) {
    const fuel = DB.list('fuelLogs').filter(r => r.vehicleId === vehicleId && FleetRules.isTrustedFuelLog(r) && inRange(r.date, f)).reduce((s, r) => s + num(r.amount), 0);
    const pm = DB.list('pmRecords').filter(r => r.vehicleId === vehicleId && inRange(r.serviceDate, f)).reduce((s, r) => s + num(r.totalCost), 0);
    const bd = DB.list('breakdowns').filter(r => r.vehicleId === vehicleId && inRange(r.reportedAt, f)).reduce((s, r) => s + num(r.totalCost), 0);
    return fuel + pm + bd;
  }
  function fuelStats(vehicleId, f) {
    const logs = DB.list('fuelLogs').filter(r => r.vehicleId === vehicleId && FleetRules.isTrustedFuelLog(r) && inRange(r.date, f)).sort((a, b) => num(a.odometer) - num(b.odometer));
    const qty = logs.reduce((s, r) => s + num(r.qty), 0);
    const amount = logs.reduce((s, r) => s + num(r.amount), 0);
    const km = logs.length > 1 ? Math.max(0, num(logs[logs.length - 1].odometer) - num(logs[0].odometer)) : 0;
    return { qty, amount, km, efficiency: qty ? km / qty : null, costPerKm: km ? amount / km : null };
  }
  function downtimeDays(row) {
    if (!row.downtimeStart) return 0;
    const end = row.downtimeEnd || isoToday();
    const ms = new Date(end.slice(0, 10) + 'T00:00') - new Date(row.downtimeStart.slice(0, 10) + 'T00:00');
    return Math.max(0, Math.ceil(ms / 86400000) + 1);
  }
  function tile(label, value, cls, href, sub) {
    const tag = href ? 'a' : 'div';
    return '<' + tag + (href ? ' href="' + App.esc(href) + '"' : '') + ' class="card stat ' + (cls || '') + '" style="text-decoration:none;color:inherit">' +
      '<div class="stat-value">' + App.esc(value) + '</div><div class="stat-label">' + App.esc(label) + '</div>' +
      (sub ? '<div class="text-muted" style="font-size:.78rem;margin-top:.25rem">' + App.esc(sub) + '</div>' : '') + '</' + tag + '>';
  }
  function renderFilters(container, f, rerender) {
    const vehicles = DB.list('vehicles');
    const bar = App.el('<div class="filter-bar"></div>');
    const form = App.form([
      { name: 'from', label: 'From', type: 'date', value: f.from },
      { name: 'to', label: 'To', type: 'date', value: f.to },
      { name: 'type', label: 'Type', type: 'select', options: uniq(vehicles, 'type').map(x => ({ value: x, label: x })), value: f.type },
      { name: 'department', label: 'Department', type: 'select', options: uniq(vehicles, 'department').map(x => ({ value: x, label: x })), value: f.department },
      { name: 'baseLocation', label: 'Base location', type: 'select', options: uniq(vehicles, 'baseLocation').map(x => ({ value: x, label: x })), value: f.baseLocation },
      { name: 'status', label: 'Status', type: 'select', options: uniq(vehicles, 'status').map(x => ({ value: x, label: x })), value: f.status },
      { name: 'vendor', label: 'Vendor', type: 'select', options: DB.list('vendors').map(v => ({ value: v.id, label: v.name })), value: f.vendor },
    ], f);
    bar.appendChild(form.el);
    const apply = App.el('<button class="btn">Apply</button>');
    const reset = App.el('<button class="btn ghost">Reset</button>');
    apply.addEventListener('click', () => rerender(form.read()));
    reset.addEventListener('click', () => rerender({ from: startOfMonth(), to: isoToday() }));
    bar.appendChild(apply); bar.appendChild(reset); container.appendChild(bar);
  }
  function render(container, params) {
    let filters = Object.assign({ from: startOfMonth(), to: isoToday() }, params && params[0] ? JSON.parse(decodeURIComponent(params[0])) : {});
    function rerender(next) {
      location.hash = '#/dashboard/' + encodeURIComponent(JSON.stringify(next));
    }
    container.innerHTML = '<div class="page-title"><div><h2>Dashboard</h2><p class="text-muted">Live fleet, ambulance, compliance, readiness, and cost indicators.</p></div></div>';
    renderFilters(container, filters, rerender);
    const vehicles = filterVehicles(filters);
    const ambs = vehicles.filter(v => v.type === 'ambulance');
    const statusCounts = vehicles.reduce((m, v) => { m[v.status] = (m[v.status] || 0) + 1; return m; }, {});
    const pm = byVehicle(DB.list('pmSchedules').filter(p => p.status !== 'closed'), vehicles);
    const pmDue = pm.filter(p => pmState(p) === 'due').length;
    const pmOver = pm.filter(p => pmState(p) === 'overdue').length;
    const docs = byVehicle(DB.list('documents'), vehicles);
    const bucket = n => docs.filter(d => App.daysUntil(d.expiryDate) != null && App.daysUntil(d.expiryDate) <= n && App.daysUntil(d.expiryDate) >= 0).length;
    const fuel = byVehicle(DB.list('fuelLogs').filter(r => FleetRules.isTrustedFuelLog(r) && inRange(r.date, filters) && (!filters.vendor || r.vendorId === filters.vendor)), vehicles);
    const pmRecords = byVehicle(DB.list('pmRecords').filter(r => inRange(r.serviceDate, filters) && (!filters.vendor || r.vendorId === filters.vendor)), vehicles);
    const breakdowns = byVehicle(DB.list('breakdowns').filter(r => inRange(r.reportedAt, filters) && (!filters.vendor || r.assignedVendorId === filters.vendor)), vehicles);
    const openBreakdowns = breakdowns.filter(b => b.status !== 'closed').length;
    const readinessFailures = byVehicle(DB.list('readinessChecks').filter(r => r.result === 'fail' && inRange(r.date, filters)), vehicles).length;
    const fuelCost = fuel.reduce((s, r) => s + num(r.amount), 0);
    const maintCost = pmRecords.reduce((s, r) => s + num(r.totalCost), 0) + breakdowns.reduce((s, r) => s + num(r.totalCost), 0);

    const tiles = App.el('<div class="grid cols-4 mb-1"></div>');
    tiles.innerHTML = [
      tile('Vehicles in filtered fleet', vehicles.length, '', '#/vehicles', Object.keys(statusCounts).map(k => k + ': ' + statusCounts[k]).join(', ')),
      tile('Ambulances available now', ambs.filter(v => v.status === 'available' && FleetRules.readinessPassesForDate(latestReadiness(v.id), isoToday())).length, 'ok', '#/trips'),
      tile('Ambulances under maintenance', ambs.filter(v => v.status === 'under maintenance').length, 'warn', '#/maintenance'),
      tile('Vehicles on trip', vehicles.filter(v => v.status === 'on trip').length, 'info', '#/trips'),
      tile('PM due', pmDue, pmDue ? 'warn' : 'ok', '#/maintenance'),
      tile('PM overdue', pmOver, pmOver ? 'danger' : 'ok', '#/maintenance'),
      tile('Open breakdowns', openBreakdowns, openBreakdowns ? 'danger' : 'ok', '#/maintenance'),
      tile('Readiness failures', readinessFailures, readinessFailures ? 'danger' : 'ok', '#/trips'),
      tile('Docs expiring <=90 days', bucket(90), 'warn', '#/compliance', '60d ' + bucket(60) + ' | 30d ' + bucket(30) + ' | 7d ' + bucket(7) + ' | today ' + bucket(0)),
      tile('Monthly fuel cost', App.fmtINR(fuelCost), '', '#/fuel'),
      tile('Monthly maintenance cost', App.fmtINR(maintCost), '', '#/maintenance'),
      tile('Vehicle downtime days', App.fmtNum(breakdowns.reduce((s, b) => s + downtimeDays(b), 0), 0), 'warn', '#/maintenance')
    ].join('');
    container.appendChild(tiles);

    const summaries = vehicles.map(v => {
      const fs = fuelStats(v.id, filters);
      const cost = totalCost(v.id, filters);
      return { vehicleId: v.id, vehicle: App.vehicleName(v.id), type: v.type, status: v.status, totalCost: cost, km: fs.km, costPerKm: fs.km ? cost / fs.km : null, efficiency: fs.efficiency, benchmark: v.mileageBenchmark };
    });
    const grid = App.el('<div class="grid cols-2"></div>');
    const high = App.el('<div class="card"><h3>Top High-Cost Vehicles</h3></div>');
    high.appendChild(App.table({ columns: [
      { key: 'vehicle', label: 'Vehicle', render: r => vehicleLink(r.vehicleId) },
      { key: 'totalCost', label: 'Total cost', num: true, render: r => App.fmtINR(r.totalCost) },
      { key: 'costPerKm', label: 'Cost/km', num: true, render: r => r.costPerKm == null ? '—' : App.fmtINR(r.costPerKm) }
    ], rows: summaries.slice().sort((a, b) => b.totalCost - a.totalCost).slice(0, 10), empty: 'No cost records.' }));
    const eff = App.el('<div class="card"><h3>Cost Per Km and Fuel Efficiency</h3></div>');
    eff.appendChild(App.table({ columns: [
      { key: 'vehicle', label: 'Vehicle', render: r => vehicleLink(r.vehicleId) },
      { key: 'km', label: 'Km', num: true, render: r => App.fmtNum(r.km, 0) },
      { key: 'costPerKm', label: 'Cost/km', num: true, render: r => r.costPerKm == null ? '—' : App.fmtINR(r.costPerKm) },
      { key: 'efficiency', label: 'Km/L', num: true, render: r => r.efficiency == null ? '—' : App.fmtNum(r.efficiency, 1) },
      { key: 'benchmark', label: 'Benchmark', num: true, render: r => App.fmtNum(r.benchmark, 1) }
    ], rows: summaries, empty: 'No fuel records.' }));
    grid.appendChild(high); grid.appendChild(eff); container.appendChild(grid);
  }
  App.registerModule({ id: 'dashboard', title: 'Dashboard', order: 1,
    roles: ['Transport Manager','Ambulance Coordinator','Maintenance Team','Finance User','Management Viewer'], render: render });
})();
