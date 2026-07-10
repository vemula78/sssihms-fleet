/* =============================================================
 * SSSIHMS Fleet — Fuel module (spec §5.5)
 * Fuel log list + filters, entry form (auto amount), verification
 * workflow (draft/submitted/verified/rejected via fuel.verify),
 * distance-since-last-fill, full-tank-to-full-tank efficiency,
 * cost/km, variance vs vehicle.mileageBenchmark, validations/alerts,
 * per-vehicle efficiency summary, CSV export.
 * ============================================================= */
(function () {

  let filters = { vehicleId: '', status: '', fuelType: '', from: '', to: '' };

  // ---------- derived calculations ----------

  function sortedVehicleLogs(vehicleId) {
    return DB.list('fuelLogs', l => l.vehicleId === vehicleId)
      .sort((a, b) => (a.odometer - b.odometer) || String(a.date).localeCompare(String(b.date)));
  }

  function lastOdometerForVehicle(vehicleId, excludeId) {
    const logs = sortedVehicleLogs(vehicleId).filter(l => l.id !== excludeId);
    return logs.length ? logs[logs.length - 1].odometer : null;
  }

  function isDuplicateBill(vendorId, billNo, excludeId) {
    if (!billNo || !vendorId) return false;
    const norm = String(billNo).trim().toLowerCase();
    return DB.list('fuelLogs', l => l.id !== excludeId && l.vendorId === vendorId
      && l.billNo && String(l.billNo).trim().toLowerCase() === norm).length > 0;
  }

  // { distanceSinceLast, kmpl (full-tank-to-full-tank), costPerKm }
  function computeDerived(log) {
    const logs = sortedVehicleLogs(log.vehicleId);
    const idx = logs.findIndex(l => l.id === log.id);
    const prev = idx > 0 ? logs[idx - 1] : null;
    const distanceSinceLast = prev ? (log.odometer - prev.odometer) : null;

    let kmpl = null;
    if (log.tankFull) {
      let prevFullIdx = -1;
      for (let i = idx - 1; i >= 0; i--) { if (logs[i].tankFull) { prevFullIdx = i; break; } }
      if (prevFullIdx >= 0) {
        const prevFull = logs[prevFullIdx];
        let qtySum = 0;
        for (let i = prevFullIdx + 1; i <= idx; i++) qtySum += Number(logs[i].qty) || 0;
        const dist = log.odometer - prevFull.odometer;
        if (dist > 0 && qtySum > 0) kmpl = dist / qtySum;
      }
    }
    const costPerKm = (distanceSinceLast && distanceSinceLast > 0) ? (log.amount / distanceSinceLast) : null;
    return { distanceSinceLast, kmpl, costPerKm };
  }

  function bumpVehicleOdometer(vehicleId, odo) {
    const veh = DB.get('vehicles', vehicleId);
    if (veh && odo != null && odo > (veh.odometer || 0)) DB.update('vehicles', vehicleId, { odometer: odo });
  }

  // ---------- entry form ----------

  function openFuelForm(existing, onSaved) {
    const settings = DB.getSettings();
    const vehicles = DB.list('vehicles', v => v.status !== 'retired' || (existing && existing.vehicleId === v.id))
      .sort((a, b) => a.regNo.localeCompare(b.regNo));
    const drivers = DB.list('drivers', d => d.active || (existing && existing.driverId === d.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    const vendors = DB.list('vendors', v => v.active || (existing && existing.vendorId === v.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    const canOverrideAmount = App.can('fuel.verify') || App.can('finance.view');

    function tankCapValidate(value, vals) {
      const veh = DB.get('vehicles', vals.vehicleId);
      if (veh && veh.tankCapacity && Number(value) > veh.tankCapacity) return 'Exceeds tank capacity (' + veh.tankCapacity + ' L)';
      return null;
    }
    function odoValidate(value, vals) {
      if (!vals.vehicleId) return null;
      const floor = lastOdometerForVehicle(vals.vehicleId, existing && existing.id);
      if (floor != null && Number(value) <= floor) return 'Must be greater than previous fuelling odometer (' + App.fmtNum(floor, 0) + ' km)';
      return null;
    }

    const fields = [
      { name: 'vehicleId', label: 'Vehicle', type: 'select', required: true,
        options: vehicles.map(v => ({ value: v.id, label: v.regNo + ' (' + v.assetCode + ')' })) },
      { name: 'date', label: 'Date', type: 'date', required: true },
      { name: 'driverId', label: 'Driver', type: 'select', options: drivers.map(d => ({ value: d.id, label: d.name })) },
      { name: 'vendorId', label: 'Fuel station / vendor', type: 'select', required: true,
        options: vendors.map(v => ({ value: v.id, label: v.name })) },
      { name: 'fuelType', label: 'Fuel type', type: 'select', required: true,
        options: ['diesel', 'petrol', 'CNG', 'electric', 'other'] },
      { name: 'qty', label: 'Quantity (L / kg)', type: 'number', required: true, min: 0.01, step: 0.01, validate: tankCapValidate },
      { name: 'rate', label: 'Rate per unit (₹)', type: 'number', required: true, min: 0.01, step: 0.01 },
      { name: 'amount', label: 'Total amount (₹)', type: 'number', min: 0.01, step: 0.01,
        hint: canOverrideAmount ? 'Auto = qty × rate; editable for Transport Manager / Finance User' : 'Auto-calculated (qty × rate)' },
      { name: 'billNo', label: 'Bill / receipt number', type: 'text' },
      { name: 'odometer', label: 'Odometer at fuelling (km)', type: 'number', required: true, min: 0, validate: odoValidate },
      { name: 'tankFull', label: 'Tank filled full', type: 'checkbox' },
      { name: 'paymentMode', label: 'Payment mode', type: 'select', options: ['cash', 'credit', 'fuel card', 'account', 'other'] },
      { name: 'remarks', label: 'Remarks', type: 'textarea', full: true },
    ];

    const values = existing ? Object.assign({}, existing, { date: (existing.date || '').slice(0, 10) })
      : { date: DB.todayISO(), fuelType: 'diesel', paymentMode: 'credit', tankFull: true };
    const f = App.form(fields, values);

    const qtyInput = f.inputs.qty.input, rateInput = f.inputs.rate.input, amountInput = f.inputs.amount.input;
    if (!canOverrideAmount) amountInput.readOnly = true;
    function recalcAmount() {
      if (canOverrideAmount && amountInput.dataset.manual === '1') return;
      const q = Number(qtyInput.value) || 0, r = Number(rateInput.value) || 0;
      amountInput.value = (q && r) ? (q * r).toFixed(2) : '';
    }
    qtyInput.addEventListener('input', recalcAmount);
    rateInput.addEventListener('input', recalcAmount);
    if (canOverrideAmount) amountInput.addEventListener('input', () => { amountInput.dataset.manual = '1'; });
    recalcAmount();

    f.inputs.vehicleId.input.addEventListener('change', () => {
      if (existing) return;
      const veh = DB.get('vehicles', f.inputs.vehicleId.input.value);
      if (veh && veh.fuelType) f.inputs.fuelType.input.value = veh.fuelType;
    });

    const close = App.modal({
      title: existing ? 'Edit fuel entry ' + existing.logNo : 'New fuel entry',
      body: f.el,
      actions: [
        { label: 'Cancel', cls: 'ghost' },
        { label: existing ? 'Save changes' : 'Save entry', cls: 'primary', onClick: c => trySave(c) },
      ],
    });

    function trySave(closeFn) {
      if (!f.validate()) return;
      const vals = f.read();
      vals.qty = Number(vals.qty); vals.rate = Number(vals.rate); vals.odometer = Number(vals.odometer);
      vals.amount = Number(amountInput.value) || (vals.qty * vals.rate);

      if (vals.billNo && isDuplicateBill(vals.vendorId, vals.billNo, existing && existing.id)) {
        if (settings.duplicateBillAction === 'block') {
          App.toast('Duplicate bill number "' + vals.billNo + '" for this vendor. Blocked by settings.', true);
          return;
        }
        if (!confirm('Bill number "' + vals.billNo + '" already exists for this vendor. Save anyway?')) return;
      }

      const floor = lastOdometerForVehicle(vals.vehicleId, existing && existing.id);
      if (floor != null && (vals.odometer - floor) > settings.odometerJumpTolerance) {
        if (!confirm('Odometer jump of ' + App.fmtNum(vals.odometer - floor, 0) + ' km exceeds the configured tolerance ('
          + settings.odometerJumpTolerance + ' km). Save and flag for review?')) return;
      }

      const needsApproval = vals.amount > settings.fuelApprovalThreshold;
      if (needsApproval && !confirm('Amount ' + App.fmtINR(vals.amount) + ' exceeds the fuel approval threshold ('
        + App.fmtINR(settings.fuelApprovalThreshold) + '). This entry will be flagged for approval on verification. Continue?')) return;

      vals.needsApproval = needsApproval;
      vals.enteredBy = existing ? existing.enteredBy : App.currentUser();

      let rec;
      if (!existing) {
        vals.logNo = DB.nextNumber('fuel', 'FL');
        vals.status = 'submitted';
        rec = DB.insert('fuelLogs', vals);
        App.toast('Fuel entry ' + rec.logNo + ' saved and submitted for verification.');
      } else {
        if (existing.status === 'rejected' || existing.status === 'draft') vals.status = 'submitted';
        rec = DB.update('fuelLogs', existing.id, vals);
        App.toast('Fuel entry ' + rec.logNo + ' updated.');
      }
      bumpVehicleOdometer(rec.vehicleId, rec.odometer);
      closeFn();
      onSaved();
    }
  }

  // ---------- verification workflow ----------

  function verifyLog(log, onDone) {
    if (log.needsApproval && !confirm('Entry ' + log.logNo + ' was flagged for approval (' + App.fmtINR(log.amount)
      + ' exceeds threshold). Confirm verification and approval?')) return;
    DB.update('fuelLogs', log.id, { status: 'verified', verifiedBy: App.currentUser() });
    App.toast('Fuel entry ' + log.logNo + ' verified.');
    onDone();
  }
  function rejectLog(log, onDone) {
    const reason = prompt('Reason for rejecting fuel entry ' + log.logNo + ':', '');
    if (reason === null) return;
    DB.update('fuelLogs', log.id, {
      status: 'rejected', verifiedBy: App.currentUser(),
      remarks: (log.remarks ? log.remarks + ' | ' : '') + 'Rejected: ' + (reason || 'no reason given'),
    });
    App.toast('Fuel entry ' + log.logNo + ' rejected.', true);
    onDone();
  }
  function deleteLog(log, onDone) {
    if (!confirm('Delete fuel entry ' + log.logNo + '? This cannot be undone.')) return;
    DB.softDelete('fuelLogs', log.id);
    App.toast('Fuel entry ' + log.logNo + ' deleted.');
    onDone();
  }

  // ---------- render ----------

  function render(container) {
    const settings = DB.getSettings();
    const allVehicles = DB.list('vehicles').sort((a, b) => a.regNo.localeCompare(b.regNo));

    const wrap = App.el('<div></div>');

    // header / toolbar
    const header = App.el(
      '<div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:.6rem;margin-bottom:1rem">' +
      '<div><h2 style="margin:0">Fuel Management</h2>' +
      '<p class="text-muted" style="margin:.2rem 0 0">Fuel logs, verification, efficiency &amp; cost/km — spec §5.5</p></div>' +
      '<div class="toolbar" style="display:flex;gap:.5rem"></div></div>'
    );
    const toolbar = header.querySelector('.toolbar');
    if (App.can('fuel.enter')) {
      const addBtn = App.el('<button class="btn">+ New fuel entry</button>');
      addBtn.addEventListener('click', () => openFuelForm(null, refresh));
      toolbar.appendChild(addBtn);
    }
    const exportBtn = App.el('<button class="btn ghost">Export CSV</button>');
    exportBtn.addEventListener('click', () => exportLogs());
    toolbar.appendChild(exportBtn);
    wrap.appendChild(header);

    // filter bar
    const fbar = App.el('<div class="filter-bar"></div>');
    fbar.appendChild(selectField('Vehicle', filters.vehicleId, [{ value: '', label: 'All vehicles' }]
      .concat(allVehicles.map(v => ({ value: v.id, label: v.regNo + ' (' + v.assetCode + ')' }))), v => { filters.vehicleId = v; refresh(); }));
    fbar.appendChild(selectField('Status', filters.status, [{ value: '', label: 'All statuses' },
      { value: 'draft', label: 'Draft' }, { value: 'submitted', label: 'Submitted' },
      { value: 'verified', label: 'Verified' }, { value: 'rejected', label: 'Rejected' }],
      v => { filters.status = v; refresh(); }));
    fbar.appendChild(selectField('Fuel type', filters.fuelType, [{ value: '', label: 'All' },
      { value: 'diesel', label: 'Diesel' }, { value: 'petrol', label: 'Petrol' },
      { value: 'CNG', label: 'CNG' }, { value: 'electric', label: 'Electric' }, { value: 'other', label: 'Other' }],
      v => { filters.fuelType = v; refresh(); }));
    fbar.appendChild(dateField('From', filters.from, v => { filters.from = v; refresh(); }));
    fbar.appendChild(dateField('To', filters.to, v => { filters.to = v; refresh(); }));
    const clearBtn = App.el('<button class="btn ghost small">Clear filters</button>');
    clearBtn.addEventListener('click', () => { filters = { vehicleId: '', status: '', fuelType: '', from: '', to: '' }; refresh(); });
    const clearWrap = App.el('<div class="field" style="align-self:flex-end"></div>');
    clearWrap.appendChild(clearBtn);
    fbar.appendChild(clearWrap);
    wrap.appendChild(fbar);

    // logs
    let logs = DB.list('fuelLogs').sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.logNo || '').localeCompare(String(a.logNo || '')));
    if (filters.vehicleId) logs = logs.filter(l => l.vehicleId === filters.vehicleId);
    if (filters.status) logs = logs.filter(l => l.status === filters.status);
    if (filters.fuelType) logs = logs.filter(l => l.fuelType === filters.fuelType);
    if (filters.from) logs = logs.filter(l => l.date >= filters.from);
    if (filters.to) logs = logs.filter(l => l.date <= filters.to);

    const logCard = App.el('<div class="card"><h3>Fuel log</h3></div>');
    logCard.appendChild(buildLogsTable(logs));
    wrap.appendChild(logCard);

    // per-vehicle efficiency summary
    const effCard = App.el('<div class="card" style="margin-top:1rem"><h3>Per-vehicle fuel efficiency summary</h3>' +
      '<p class="text-muted" style="margin-top:-.4rem">Actual efficiency from full-tank-to-full-tank fills, vs vehicle mileage benchmark. ' +
      'Flagged when ' + settings.fuelEfficiencyWarnPct + '% or more below benchmark.</p></div>');
    effCard.appendChild(buildEfficiencyTable(allVehicles));
    wrap.appendChild(effCard);

    container.innerHTML = '';
    container.appendChild(wrap);

    function refresh() { render(container); }

    function buildLogsTable(rows) {
      return App.table({
        empty: 'No fuel entries match the current filters.',
        columns: [
          { key: 'logNo', label: 'Log #' },
          { key: 'date', label: 'Date', render: r => App.fmtDate(r.date) },
          { key: 'vehicleId', label: 'Vehicle', render: r => vehicleLink(r.vehicleId) },
          { key: 'driverId', label: 'Driver', render: r => App.esc(App.driverName(r.driverId)) },
          { key: 'vendorId', label: 'Vendor', render: r => App.esc(App.vendorName(r.vendorId)) },
          { key: 'fuelType', label: 'Fuel' },
          { key: 'qty', label: 'Qty', num: true, render: r => App.fmtNum(r.qty, 1) },
          { key: 'rate', label: 'Rate', num: true, render: r => App.fmtINR(r.rate) },
          { key: 'amount', label: 'Amount', num: true, render: r => amountCell(r) },
          { key: 'billNo', label: 'Bill #', render: r => billCell(r) },
          { key: 'odometer', label: 'Odometer', num: true, render: r => App.fmtNum(r.odometer, 0) },
          { key: 'distance', label: 'Dist. since last', num: true, render: r => distCell(r) },
          { key: 'kmpl', label: 'km/l (full-tank)', num: true, render: r => kmplCell(r) },
          { key: 'costPerKm', label: '₹/km', num: true, render: r => costCell(r) },
          { key: 'status', label: 'Status', render: r => statusCell(r) },
          { key: 'actions', label: '', render: r => actionsCell(r) },
        ],
        rows,
      });
    }

    function vehicleLink(id) {
      const v = DB.get('vehicles', id);
      if (!v) return '—';
      return '<a class="rowlink" href="#/vehicles/' + App.esc(id) + '">' + App.esc(v.regNo) + ' (' + App.esc(v.assetCode) + ')</a>';
    }
    function amountCell(r) {
      let html = App.fmtINR(r.amount);
      if (r.needsApproval) html += ' ' + App.badge('approval', 'warn');
      return html;
    }
    function billCell(r) {
      if (!r.billNo) return '—';
      const dup = isDuplicateBill(r.vendorId, r.billNo, r.id);
      return App.esc(r.billNo) + (dup ? ' ' + App.badge('duplicate', 'danger') : '');
    }
    function distCell(r) {
      const d = computeDerived(r);
      if (d.distanceSinceLast == null) return '—';
      const jump = d.distanceSinceLast > settings.odometerJumpTolerance;
      return App.fmtNum(d.distanceSinceLast, 0) + ' km' + (jump ? ' ' + App.badge('jump', 'warn') : '');
    }
    function kmplCell(r) {
      const d = computeDerived(r);
      return d.kmpl == null ? '—' : App.fmtNum(d.kmpl, 2);
    }
    function costCell(r) {
      const d = computeDerived(r);
      return d.costPerKm == null ? '—' : App.fmtINR(Math.round(d.costPerKm));
    }
    function statusCell(r) {
      return App.badge(r.status, r.status);
    }
    function actionsCell(r) {
      const box = App.el('<div style="display:flex;gap:.3rem;flex-wrap:wrap"></div>');
      if (r.status === 'submitted' && App.can('fuel.verify')) {
        const vBtn = App.el('<button class="btn small">Verify</button>');
        vBtn.addEventListener('click', () => verifyLog(r, refresh));
        const rBtn = App.el('<button class="btn small danger">Reject</button>');
        rBtn.addEventListener('click', () => rejectLog(r, refresh));
        box.appendChild(vBtn); box.appendChild(rBtn);
      }
      if (r.status !== 'verified' && (App.can('fuel.enter') || App.can('fuel.verify'))) {
        const eBtn = App.el('<button class="btn small ghost">Edit</button>');
        eBtn.addEventListener('click', () => openFuelForm(r, refresh));
        const dBtn = App.el('<button class="btn small ghost">Delete</button>');
        dBtn.addEventListener('click', () => deleteLog(r, refresh));
        box.appendChild(eBtn); box.appendChild(dBtn);
      }
      return box;
    }

    function buildEfficiencyTable(vehicles) {
      const rows = vehicles.map(v => {
        const vlogs = sortedVehicleLogs(v.id).filter(l => l.status !== 'rejected');
        if (!vlogs.length) return null;
        const kmplVals = vlogs.map(computeDerived).map(d => d.kmpl).filter(k => k != null);
        const avgKmpl = kmplVals.length ? (kmplVals.reduce((a, b) => a + b, 0) / kmplVals.length) : null;
        const totalQty = vlogs.reduce((a, l) => a + (Number(l.qty) || 0), 0);
        const totalAmount = vlogs.reduce((a, l) => a + (Number(l.amount) || 0), 0);
        const totalDistance = vlogs.length > 1 ? (vlogs[vlogs.length - 1].odometer - vlogs[0].odometer) : null;
        const costPerKm = (totalDistance && totalDistance > 0) ? (totalAmount / totalDistance) : null;
        const benchmark = v.mileageBenchmark || null;
        const variance = (avgKmpl != null && benchmark) ? ((avgKmpl - benchmark) / benchmark * 100) : null;
        const flagged = variance != null && variance <= -settings.fuelEfficiencyWarnPct;
        return { v, avgKmpl, benchmark, variance, totalQty, totalAmount, totalDistance, costPerKm, flagged };
      }).filter(Boolean);

      return App.table({
        empty: 'No fuel history recorded yet.',
        columns: [
          { key: 'vehicle', label: 'Vehicle', render: r => vehicleLink(r.v.id) },
          { key: 'type', label: 'Type', render: r => App.esc(r.v.type) },
          { key: 'benchmark', label: 'Benchmark km/l', num: true, render: r => r.benchmark ? App.fmtNum(r.benchmark, 1) : '—' },
          { key: 'actual', label: 'Actual km/l', num: true, render: r => r.avgKmpl != null ? App.fmtNum(r.avgKmpl, 2) : '—' },
          { key: 'variance', label: 'Variance', num: true, render: r => varianceCell(r) },
          { key: 'totalQty', label: 'Fuel filled', num: true, render: r => App.fmtNum(r.totalQty, 1) },
          { key: 'totalAmount', label: 'Fuel spend', num: true, render: r => App.fmtINR(r.totalAmount) },
          { key: 'costPerKm', label: '₹/km', num: true, render: r => r.costPerKm != null ? App.fmtINR(Math.round(r.costPerKm)) : '—' },
        ],
        rows,
      });

      function varianceCell(r) {
        if (r.variance == null) return '—';
        const txt = (r.variance >= 0 ? '+' : '') + App.fmtNum(r.variance, 1) + '%';
        return txt + ' ' + (r.flagged ? App.badge('below benchmark', 'danger') : App.badge('ok', 'ok'));
      }
    }

    function exportLogs() {
      const headers = ['Log No', 'Date', 'Vehicle', 'Driver', 'Vendor', 'Fuel Type', 'Qty', 'Rate', 'Amount',
        'Bill No', 'Odometer', 'Distance Since Last (km)', 'Efficiency (km/l)', 'Cost/km (₹)', 'Tank Full',
        'Payment Mode', 'Status', 'Entered By', 'Verified By', 'Remarks'];
      const rows = logs.map(r => {
        const d = computeDerived(r);
        const veh = DB.get('vehicles', r.vehicleId);
        return [
          r.logNo || '', App.fmtDate(r.date), veh ? veh.regNo + ' (' + veh.assetCode + ')' : '—',
          App.driverName(r.driverId), App.vendorName(r.vendorId), r.fuelType || '', r.qty, r.rate, r.amount,
          r.billNo || '', r.odometer, d.distanceSinceLast != null ? d.distanceSinceLast : '',
          d.kmpl != null ? d.kmpl.toFixed(2) : '', d.costPerKm != null ? Math.round(d.costPerKm) : '',
          r.tankFull ? 'Yes' : 'No', r.paymentMode || '', r.status || '', r.enteredBy || '', r.verifiedBy || '', r.remarks || '',
        ];
      });
      App.exportCSV('fuel-logs.csv', headers, rows);
    }
  }

  function selectField(label, value, options, onChange) {
    const wrap = App.el('<div class="field"></div>');
    wrap.innerHTML = '<label>' + App.esc(label) + '</label>';
    const sel = document.createElement('select');
    options.forEach(o => sel.appendChild(new Option(o.label, o.value)));
    sel.value = value || '';
    sel.addEventListener('change', () => onChange(sel.value));
    wrap.appendChild(sel);
    return wrap;
  }
  function dateField(label, value, onChange) {
    const wrap = App.el('<div class="field"></div>');
    wrap.innerHTML = '<label>' + App.esc(label) + '</label>';
    const inp = document.createElement('input');
    inp.type = 'date'; inp.value = value || '';
    inp.addEventListener('change', () => onChange(inp.value));
    wrap.appendChild(inp);
    return wrap;
  }

  App.registerModule({
    id: 'fuel',
    title: 'Fuel',
    order: 4,
    render(container) { render(container); },
  });

})();
