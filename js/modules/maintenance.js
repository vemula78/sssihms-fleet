/* =============================================================
 * SSSIHMS Fleet — Maintenance module
 * Spec §5.6 (Preventive Maintenance) + §5.7 (Breakdown & Repair Tracking)
 * Tabs: PM Schedules | PM History | Breakdown Tickets
 * ============================================================= */
(function () {

  // ---------- small date helpers ----------
  function addDays(iso, days) {
    if (!iso || days == null) return iso || null;
    const d = new Date(iso.slice(0, 10) + 'T00:00');
    d.setDate(d.getDate() + Number(days));
    return d.toISOString().slice(0, 10);
  }
  function nowLocalDT() {
    const d = new Date(); const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function num(v) { return v == null || v === '' || isNaN(v) ? 0 : Number(v); }

  // ---------- lookups ----------
  function vehicleOptions() {
    return DB.list('vehicles').sort((a, b) => a.regNo.localeCompare(b.regNo))
      .map(v => ({ value: v.id, label: v.regNo + ' (' + v.assetCode + ')' }));
  }
  function vendorOptions() {
    return DB.list('vendors', v => v.active !== false).sort((a, b) => a.name.localeCompare(b.name))
      .map(v => ({ value: v.id, label: v.name }));
  }

  // ---------- due computation (§5.6: whichever threshold hits first) ----------
  function dueInfo(sch, veh) {
    if (sch.status !== 'active') return { label: sch.status, cls: sch.status.replace(/\s+/g, '-') };
    const dDays = App.daysUntil(sch.nextDueDate);
    const dKm = (veh && sch.nextDueOdo != null) ? (sch.nextDueOdo - veh.odometer) : null;
    const overdue = (dDays != null && dDays < 0) || (dKm != null && dKm <= 0);
    const dueSoon = !overdue && ((dDays != null && dDays <= 14) || (dKm != null && dKm <= 1000));
    if (overdue) return { label: 'Overdue', cls: 'overdue' };
    if (dueSoon) return { label: 'Due soon', cls: 'due' };
    return { label: 'OK', cls: 'ok' };
  }

  const SEV_CLS = { low: 'muted', medium: 'due', high: 'expiring', critical: 'critical' };
  const BD_STATUS_CLS = {
    'open': 'open', 'assigned': 'assigned', 'in progress': 'in-progress',
    'waiting for parts': 'due', 'waiting for approval': 'due',
    'resolved': 'resolved', 'closed': 'closed', 'cancelled': 'cancelled',
  };
  const BD_STATUS_FLOW = ['open', 'assigned', 'in progress', 'waiting for parts', 'waiting for approval', 'resolved', 'closed', 'cancelled'];
  const VEHICLE_STATUS_OPTIONS = ['available', 'restricted use', 'under maintenance', 'off road'];

  function vehLink(id) {
    const v = DB.get('vehicles', id);
    if (!v) return '—';
    return '<a class="rowlink" href="#/vehicles/' + App.esc(id) + '">' + App.esc(v.regNo) + ' (' + App.esc(v.assetCode) + ')</a>';
  }

  // =============================================================
  // Tab: PM Schedules
  // =============================================================
  function renderSchedules(container) {
    const canManage = App.can('maintenance.manage');
    const wrap = App.el('<div></div>');

    const bar = App.el('<div class="filter-bar"></div>');
    const vehSel = document.createElement('select'); vehSel.innerHTML = '<option value="">All vehicles</option>';
    vehicleOptions().forEach(o => vehSel.appendChild(new Option(o.label, o.value)));
    const statSel = document.createElement('select');
    ['All statuses', 'active', 'paused', 'retired'].forEach((s, i) => statSel.appendChild(new Option(s, i === 0 ? '' : s)));
    const dueSel = document.createElement('select');
    ['Any due status', 'Overdue', 'Due soon', 'OK'].forEach((s, i) => dueSel.appendChild(new Option(s, i === 0 ? '' : s)));
    [['Vehicle', vehSel], ['Status', statSel], ['Due', dueSel]].forEach(([label, input]) => {
      const f = App.el('<div class="field"></div>'); f.innerHTML = '<label>' + label + '</label>'; f.appendChild(input); bar.appendChild(f);
    });
    if (canManage) {
      const addBtn = App.el('<button class="btn">+ New PM schedule</button>');
      addBtn.addEventListener('click', () => openScheduleForm());
      bar.appendChild(addBtn);
    }
    wrap.appendChild(bar);
    const tblHost = App.el('<div></div>'); wrap.appendChild(tblHost);

    function draw() {
      let rows = DB.list('pmSchedules');
      if (vehSel.value) rows = rows.filter(r => r.vehicleId === vehSel.value);
      if (statSel.value) rows = rows.filter(r => r.status === statSel.value);
      rows = rows.map(r => ({ r, veh: DB.get('vehicles', r.vehicleId), due: dueInfo(r, DB.get('vehicles', r.vehicleId)) }));
      if (dueSel.value) rows = rows.filter(x => x.due.label === dueSel.value);
      rows.sort((a, b) => (App.daysUntil(a.r.nextDueDate) || 0) - (App.daysUntil(b.r.nextDueDate) || 0));

      tblHost.innerHTML = '';
      tblHost.appendChild(App.table({
        columns: [
          { key: 'vehicle', label: 'Vehicle', render: x => vehLink(x.r.vehicleId) },
          { key: 'type', label: 'Type', render: x => App.esc(x.r.maintenanceType) },
          { key: 'freq', label: 'Frequency', render: x => [x.r.freqDays ? x.r.freqDays + ' days' : null, x.r.freqKm ? x.r.freqKm + ' km' : null].filter(Boolean).join(' / ') || '—' },
          { key: 'last', label: 'Last service', render: x => App.fmtDate(x.r.lastServiceDate) + (x.r.lastServiceOdo != null ? ' · ' + App.fmtNum(x.r.lastServiceOdo, 0) + ' km' : '') },
          { key: 'next', label: 'Next due', render: x => App.fmtDate(x.r.nextDueDate) + (x.r.nextDueOdo != null ? ' · ' + App.fmtNum(x.r.nextDueOdo, 0) + ' km' : '') },
          { key: 'odo', label: 'Current odo', num: true, render: x => x.veh ? App.fmtNum(x.veh.odometer, 0) : '—' },
          { key: 'assigned', label: 'Assigned to', render: x => App.esc(x.r.assignedTo || '—') },
          { key: 'est', label: 'Est. cost', num: true, render: x => App.fmtINR(x.r.estCost) },
          { key: 'priority', label: 'Priority', render: x => App.badge(x.r.priority) },
          { key: 'status', label: 'Status', render: x => App.badge(x.r.status) },
          { key: 'due', label: 'Due status', render: x => App.badge(x.due.label, x.due.cls) },
          {
            key: 'actions', label: '', render: x => {
              if (!canManage) return '';
              const bits = [];
              bits.push('<button class="btn small" data-act="complete" data-id="' + x.r.id + '">Record completion</button>');
              bits.push('<button class="btn small ghost" data-act="edit" data-id="' + x.r.id + '">Edit</button>');
              bits.push('<button class="btn small ghost" data-act="toggle" data-id="' + x.r.id + '">' + (x.r.status === 'active' ? 'Pause' : 'Activate') + '</button>');
              bits.push('<button class="btn small danger" data-act="del" data-id="' + x.r.id + '">Delete</button>');
              return '<div style="display:flex;gap:.3rem;flex-wrap:wrap">' + bits.join('') + '</div>';
            }
          },
        ],
        rows, empty: 'No PM schedules match the filters.',
      }));

      tblHost.querySelectorAll('button[data-act]').forEach(btn => {
        btn.addEventListener('click', () => {
          const sch = DB.get('pmSchedules', btn.dataset.id);
          if (!sch) return;
          if (btn.dataset.act === 'edit') openScheduleForm(sch);
          else if (btn.dataset.act === 'complete') openCompletionForm(sch);
          else if (btn.dataset.act === 'toggle') { DB.update('pmSchedules', sch.id, { status: sch.status === 'active' ? 'paused' : 'active' }); App.toast('Schedule updated'); draw(); }
          else if (btn.dataset.act === 'del') { if (confirm('Delete this PM schedule?')) { DB.softDelete('pmSchedules', sch.id); App.toast('Schedule deleted'); draw(); } }
        });
      });
    }
    [vehSel, statSel, dueSel].forEach(el => el.addEventListener('change', draw));
    draw();

    function openScheduleForm(existing) {
      const f = App.form([
        { name: 'vehicleId', label: 'Vehicle', type: 'select', options: vehicleOptions(), required: true },
        { name: 'maintenanceType', label: 'Maintenance type', type: 'text', required: true, hint: 'e.g. Preventive maintenance, Oil and lubricant' },
        { name: 'freqDays', label: 'Frequency (days)', type: 'number', min: 0 },
        { name: 'freqKm', label: 'Frequency (km)', type: 'number', min: 0 },
        { name: 'lastServiceDate', label: 'Last service date', type: 'date' },
        { name: 'lastServiceOdo', label: 'Last service odometer', type: 'number', min: 0 },
        { name: 'nextDueDate', label: 'Next due date', type: 'date', required: true },
        { name: 'nextDueOdo', label: 'Next due odometer', type: 'number', min: 0, required: true },
        { name: 'assignedTo', label: 'Assigned team / vendor', type: 'text' },
        { name: 'estCost', label: 'Estimated cost (₹)', type: 'number', min: 0 },
        { name: 'priority', label: 'Priority', type: 'select', options: ['low', 'medium', 'high'], required: true },
        { name: 'status', label: 'Status', type: 'select', options: ['active', 'paused', 'retired'], required: true, value: 'active' },
      ], existing || {});
      App.modal({
        title: existing ? 'Edit PM schedule' : 'New PM schedule',
        body: f.el,
        actions: [
          { label: 'Cancel', cls: 'ghost' },
          {
            label: existing ? 'Save' : 'Create', onClick: close => {
              if (!f.validate()) return;
              const v = f.read();
              if (!v.freqDays && !v.freqKm) { App.toast('Set a frequency in days and/or km', true); return; }
              if (existing) DB.update('pmSchedules', existing.id, v);
              else DB.insert('pmSchedules', v);
              App.toast('PM schedule saved'); close(); draw();
            }
          },
        ],
      });
    }

    function openCompletionForm(sch) {
      const veh = DB.get('vehicles', sch.vehicleId);
      const f = App.form([
        { name: 'vendorId', label: 'Vendor / workshop', type: 'select', options: vendorOptions(), required: true },
        { name: 'serviceDate', label: 'Service date', type: 'date', required: true, value: DB.todayISO() },
        {
          name: 'serviceOdo', label: 'Service odometer', type: 'number', min: 0, required: true, value: veh ? veh.odometer : 0,
          validate: (val) => { if (sch.lastServiceOdo != null && Number(val) < sch.lastServiceOdo) return 'Must be ≥ last service odometer (' + sch.lastServiceOdo + ')'; return null; },
        },
        { name: 'workPerformed', label: 'Work performed', type: 'textarea', required: true, full: true },
        { name: 'partsCost', label: 'Parts cost (₹)', type: 'number', min: 0, value: 0 },
        { name: 'laborCost', label: 'Labor cost (₹)', type: 'number', min: 0, value: 0 },
        { name: 'otherCost', label: 'Other cost (₹)', type: 'number', min: 0, value: 0 },
        { name: 'taxes', label: 'Taxes (₹)', type: 'number', min: 0, value: 0 },
        { name: 'discount', label: 'Discount (₹)', type: 'number', min: 0, value: 0 },
        { name: 'invoiceNo', label: 'Invoice number', type: 'text' },
        { name: 'downtimeStart', label: 'Downtime start', type: 'date' },
        { name: 'downtimeEnd', label: 'Downtime end', type: 'date' },
        { name: 'fitness', label: 'Vehicle fitness after service', type: 'select', options: ['fit', 'fit with observation', 'unfit'], required: true },
        { name: 'remarks', label: 'Remarks', type: 'textarea', full: true },
      ], {});

      const totalLine = App.el('<div class="hint" style="grid-column:1/-1;font-weight:700"></div>');
      f.el.appendChild(totalLine);
      function refreshTotal() {
        const v = f.read();
        const total = num(v.partsCost) + num(v.laborCost) + num(v.otherCost) + num(v.taxes) - num(v.discount);
        totalLine.textContent = 'Total cost: ' + App.fmtINR(total);
      }
      ['partsCost', 'laborCost', 'otherCost', 'taxes', 'discount'].forEach(n => f.inputs[n].input.addEventListener('input', refreshTotal));
      refreshTotal();

      App.modal({
        title: 'Record PM completion — ' + (veh ? veh.regNo : ''),
        body: f.el,
        actions: [
          { label: 'Cancel', cls: 'ghost' },
          {
            label: 'Save completion', onClick: close => {
              if (!f.validate()) return;
              const v = f.read();
              const totalCost = num(v.partsCost) + num(v.laborCost) + num(v.otherCost) + num(v.taxes) - num(v.discount);
              DB.insert('pmRecords', Object.assign({}, v, {
                vehicleId: sch.vehicleId, scheduleRef: sch.id, totalCost,
              }));
              const nextDueDate = sch.freqDays ? addDays(v.serviceDate, sch.freqDays) : sch.nextDueDate;
              const nextDueOdo = sch.freqKm ? Number(v.serviceOdo) + Number(sch.freqKm) : sch.nextDueOdo;
              DB.update('pmSchedules', sch.id, {
                lastServiceDate: v.serviceDate, lastServiceOdo: Number(v.serviceOdo),
                nextDueDate, nextDueOdo,
              });
              if (veh) {
                const patch = {};
                if (Number(v.serviceOdo) > veh.odometer) patch.odometer = Number(v.serviceOdo);
                if (v.fitness === 'unfit') patch.status = 'under maintenance';
                else if (veh.status === 'under maintenance') patch.status = 'available';
                if (Object.keys(patch).length) DB.update('vehicles', veh.id, patch);
              }
              App.toast('PM completion recorded'); close(); draw();
            }
          },
        ],
      });
    }
    return wrap;
  }

  // =============================================================
  // Tab: PM History
  // =============================================================
  function renderHistory(container) {
    const wrap = App.el('<div></div>');
    const bar = App.el('<div class="filter-bar"></div>');
    const vehSel = document.createElement('select'); vehSel.innerHTML = '<option value="">All vehicles</option>';
    vehicleOptions().forEach(o => vehSel.appendChild(new Option(o.label, o.value)));
    const f1 = App.el('<div class="field"></div>'); f1.innerHTML = '<label>Vehicle</label>'; f1.appendChild(vehSel); bar.appendChild(f1);
    const exportBtn = App.el('<button class="btn secondary">Export CSV</button>'); bar.appendChild(exportBtn);
    wrap.appendChild(bar);
    const tblHost = App.el('<div></div>'); wrap.appendChild(tblHost);

    function rowsData() {
      let rows = DB.list('pmRecords').sort((a, b) => (b.serviceDate || '').localeCompare(a.serviceDate || ''));
      if (vehSel.value) rows = rows.filter(r => r.vehicleId === vehSel.value);
      return rows;
    }
    function draw() {
      const rows = rowsData();
      tblHost.innerHTML = '';
      tblHost.appendChild(App.table({
        columns: [
          { key: 'vehicle', label: 'Vehicle', render: r => vehLink(r.vehicleId) },
          { key: 'date', label: 'Service date', render: r => App.fmtDate(r.serviceDate) },
          { key: 'odo', label: 'Odometer', num: true, render: r => App.fmtNum(r.serviceOdo, 0) },
          { key: 'vendor', label: 'Vendor', render: r => App.esc(App.vendorName(r.vendorId)) },
          { key: 'work', label: 'Work performed', render: r => App.esc(r.workPerformed || '—') },
          { key: 'downtime', label: 'Downtime', render: r => (r.downtimeStart ? App.fmtDate(r.downtimeStart) : '—') + ' → ' + (r.downtimeEnd ? App.fmtDate(r.downtimeEnd) : '—') },
          { key: 'fitness', label: 'Fitness', render: r => App.badge(r.fitness, r.fitness === 'unfit' ? 'unfit' : (r.fitness === 'fit' ? 'fit' : 'due')) },
          { key: 'total', label: 'Total cost', num: true, render: r => App.fmtINR(r.totalCost) },
        ],
        rows, empty: 'No PM records yet.',
      }));
    }
    vehSel.addEventListener('change', draw);
    exportBtn.addEventListener('click', () => {
      const rows = rowsData();
      App.exportCSV('pm-history.csv', ['Vehicle', 'Service date', 'Odometer', 'Vendor', 'Work performed', 'Parts', 'Labor', 'Other', 'Taxes', 'Discount', 'Total', 'Invoice', 'Fitness'],
        rows.map(r => [App.vehicleName(r.vehicleId), r.serviceDate, r.serviceOdo, App.vendorName(r.vendorId), r.workPerformed, r.partsCost, r.laborCost, r.otherCost, r.taxes, r.discount, r.totalCost, r.invoiceNo, r.fitness]));
    });
    draw();
    return wrap;
  }

  // =============================================================
  // Tab: Breakdown tickets
  // =============================================================
  function renderBreakdowns(container) {
    const canManage = App.can('maintenance.manage');
    const canVendor = App.can('vendor.update');
    const wrap = App.el('<div></div>');

    const bar = App.el('<div class="filter-bar"></div>');
    const vehSel = document.createElement('select'); vehSel.innerHTML = '<option value="">All vehicles</option>';
    vehicleOptions().forEach(o => vehSel.appendChild(new Option(o.label, o.value)));
    const statSel = document.createElement('select'); statSel.innerHTML = '<option value="">All statuses</option>';
    BD_STATUS_FLOW.forEach(s => statSel.appendChild(new Option(s, s)));
    const sevSel = document.createElement('select'); sevSel.innerHTML = '<option value="">All severities</option>';
    ['low', 'medium', 'high', 'critical'].forEach(s => sevSel.appendChild(new Option(s, s)));
    [['Vehicle', vehSel], ['Status', statSel], ['Severity', sevSel]].forEach(([label, input]) => {
      const f = App.el('<div class="field"></div>'); f.innerHTML = '<label>' + label + '</label>'; f.appendChild(input); bar.appendChild(f);
    });
    if (canManage) {
      const addBtn = App.el('<button class="btn">+ New breakdown ticket</button>');
      addBtn.addEventListener('click', () => openTicketForm());
      bar.appendChild(addBtn);
    }
    wrap.appendChild(bar);
    const tblHost = App.el('<div></div>'); wrap.appendChild(tblHost);

    function rowsData() {
      let rows = DB.list('breakdowns').sort((a, b) => (b.reportedAt || '').localeCompare(a.reportedAt || ''));
      if (vehSel.value) rows = rows.filter(r => r.vehicleId === vehSel.value);
      if (statSel.value) rows = rows.filter(r => r.status === statSel.value);
      if (sevSel.value) rows = rows.filter(r => r.severity === sevSel.value);
      return rows;
    }
    function draw() {
      const rows = rowsData();
      tblHost.innerHTML = '';
      tblHost.appendChild(App.table({
        columns: [
          { key: 'ticket', label: 'Ticket #', render: r => App.esc(r.ticketNo) },
          { key: 'vehicle', label: 'Vehicle', render: r => vehLink(r.vehicleId) },
          { key: 'reported', label: 'Reported', render: r => App.fmtDateTime(r.reportedAt) + '<br><span class="text-muted">' + App.esc(r.reportedBy || '') + '</span>' },
          { key: 'category', label: 'Category', render: r => App.esc(r.issueCategory || '—') },
          { key: 'severity', label: 'Severity', render: r => App.badge(r.severity, SEV_CLS[r.severity] || 'muted') },
          { key: 'impact', label: 'Impact', render: r => (r.safetyImpact ? App.badge('Safety', 'critical') : '') + ' ' + (r.readinessImpact ? App.badge('Readiness', 'expiring') : '') },
          { key: 'vendor', label: 'Vendor', render: r => App.esc(App.vendorName(r.assignedVendorId)) },
          { key: 'status', label: 'Status', render: r => App.badge(r.status, BD_STATUS_CLS[r.status] || 'muted') },
          { key: 'cost', label: 'Total cost', num: true, render: r => App.fmtINR(r.totalCost) },
          {
            key: 'actions', label: '', render: r => {
              if (!canManage && !canVendor) return '';
              return '<button class="btn small ghost" data-id="' + r.id + '">Manage</button>';
            }
          },
        ],
        rows, empty: 'No breakdown tickets match the filters.',
      }));
      tblHost.querySelectorAll('button[data-id]').forEach(btn => btn.addEventListener('click', () => {
        const t = DB.get('breakdowns', btn.dataset.id); if (t) openManageForm(t);
      }));
    }
    [vehSel, statSel, sevSel].forEach(el => el.addEventListener('change', draw));
    draw();

    function openTicketForm() {
      const f = App.form([
        { name: 'vehicleId', label: 'Vehicle', type: 'select', options: vehicleOptions(), required: true },
        { name: 'reportedBy', label: 'Reported by', type: 'text', required: true, value: App.currentUser() },
        { name: 'reportedAt', label: 'Reported at', type: 'datetime-local', required: true, value: nowLocalDT() },
        { name: 'odometer', label: 'Odometer at report', type: 'number', min: 0 },
        { name: 'location', label: 'Location', type: 'text' },
        { name: 'issueCategory', label: 'Issue category', type: 'select', required: true, options: ['Electrical repair', 'Breakdown repair', 'Tyre replacement', 'Accident repair', 'AC repair', 'Body repair', 'Engine repair', 'Other'] },
        { name: 'description', label: 'Issue description', type: 'textarea', required: true, full: true },
        { name: 'severity', label: 'Severity', type: 'select', required: true, options: ['low', 'medium', 'high', 'critical'] },
        { name: 'safetyImpact', label: 'Safety impact', type: 'checkbox' },
        { name: 'readinessImpact', label: 'Ambulance readiness impact', type: 'checkbox' },
        { name: 'statusImpact', label: 'Vehicle status impact', type: 'select', required: true, options: VEHICLE_STATUS_OPTIONS, value: 'under maintenance' },
        { name: 'assignedVendorId', label: 'Assigned vendor', type: 'select', options: vendorOptions() },
        { name: 'targetResponseAt', label: 'Target response', type: 'datetime-local' },
        { name: 'targetResolutionAt', label: 'Target resolution', type: 'datetime-local' },
      ], {});
      App.modal({
        title: 'New breakdown ticket',
        body: f.el,
        actions: [
          { label: 'Cancel', cls: 'ghost' },
          {
            label: 'Create ticket', onClick: close => {
              if (!f.validate()) return;
              const v = f.read();
              const ticketNo = DB.nextNumber('breakdown', 'BD');
              const rec = DB.insert('breakdowns', Object.assign({}, v, {
                ticketNo, status: 'open', downtimeStart: v.reportedAt,
                laborCost: 0, partsCost: 0, towingCost: 0, otherCost: 0, taxes: 0, totalCost: 0,
              }));
              // §5.7: critical/safety or ambulance-readiness impact auto-sets vehicle unavailable
              let newStatus = v.statusImpact;
              if (v.readinessImpact && newStatus === 'available') newStatus = 'under maintenance';
              if ((v.severity === 'critical' || v.safetyImpact) && newStatus === 'available') newStatus = 'under maintenance';
              if (newStatus && newStatus !== 'available') DB.update('vehicles', v.vehicleId, { status: newStatus });
              App.toast('Ticket ' + ticketNo + ' created'); close(); draw();
            }
          },
        ],
      });
    }

    function openManageForm(t) {
      const veh = DB.get('vehicles', t.vehicleId);
      const f = App.form([
        { name: 'status', label: 'Status', type: 'select', required: true, options: BD_STATUS_FLOW, value: t.status },
        { name: 'assignedVendorId', label: 'Assigned vendor', type: 'select', options: vendorOptions(), value: t.assignedVendorId || '' },
        { name: 'laborCost', label: 'Labor cost (₹)', type: 'number', min: 0, value: t.laborCost || 0 },
        { name: 'partsCost', label: 'Parts cost (₹)', type: 'number', min: 0, value: t.partsCost || 0 },
        { name: 'towingCost', label: 'Towing cost (₹)', type: 'number', min: 0, value: t.towingCost || 0 },
        { name: 'otherCost', label: 'Other cost (₹)', type: 'number', min: 0, value: t.otherCost || 0 },
        { name: 'taxes', label: 'Taxes (₹)', type: 'number', min: 0, value: t.taxes || 0 },
        { name: 'invoiceNo', label: 'Invoice number', type: 'text', value: t.invoiceNo || '' },
        { name: 'downtimeEnd', label: 'Downtime end', type: 'date', value: t.downtimeEnd || '' },
        { name: 'rootCause', label: 'Root cause', type: 'textarea', full: true, value: t.rootCause || '', hint: 'Required to close the ticket' },
        { name: 'correctiveAction', label: 'Corrective action', type: 'textarea', full: true, value: t.correctiveAction || '', hint: 'Required to close the ticket' },
        { name: 'finalVehicleStatus', label: 'Final vehicle status', type: 'select', options: VEHICLE_STATUS_OPTIONS, value: t.finalVehicleStatus || (veh ? veh.status : ''), hint: 'Required to close the ticket' },
        { name: 'closureNotes', label: 'Closure notes', type: 'textarea', full: true, value: t.closureNotes || '' },
      ], {});
      const totalLine = App.el('<div class="hint" style="grid-column:1/-1;font-weight:700"></div>');
      f.el.appendChild(totalLine);
      function refreshTotal() {
        const v = f.read();
        totalLine.textContent = 'Total repair cost: ' + App.fmtINR(num(v.laborCost) + num(v.partsCost) + num(v.towingCost) + num(v.otherCost) + num(v.taxes));
      }
      ['laborCost', 'partsCost', 'towingCost', 'otherCost', 'taxes'].forEach(n => f.inputs[n].input.addEventListener('input', refreshTotal));
      refreshTotal();

      const actions = [{ label: 'Close (no changes)', cls: 'ghost' }];
      if (canManage || canVendor) {
        actions.push({
          label: 'Save', onClick: close => {
            if (!f.validate()) return;
            const v = f.read();
            const totalCost = num(v.laborCost) + num(v.partsCost) + num(v.towingCost) + num(v.otherCost) + num(v.taxes);
            const closing = v.status === 'closed';
            if (closing) {
              if (!canManage) { App.toast('Only Maintenance Team / Transport Manager can close a ticket', true); return; }
              if (!v.rootCause || !v.correctiveAction || !v.finalVehicleStatus) {
                App.toast('Root cause, corrective action and final vehicle status are required to close', true); return;
              }
            }
            const patch = Object.assign({}, v, { totalCost });
            if (closing && !patch.downtimeEnd) patch.downtimeEnd = DB.todayISO();
            DB.update('breakdowns', t.id, patch);
            if (closing && veh) DB.update('vehicles', veh.id, { status: v.finalVehicleStatus });
            App.toast('Ticket ' + t.ticketNo + ' updated'); close(); draw();
          }
        });
      }
      App.modal({ title: 'Manage ticket ' + t.ticketNo + ' — ' + (veh ? veh.regNo : ''), body: f.el, actions });
    }
    return wrap;
  }

  // =============================================================
  // Module shell (tabs)
  // =============================================================
  const TABS = [
    { id: 'schedules', label: 'PM Schedules', render: renderSchedules },
    { id: 'history', label: 'PM History', render: renderHistory },
    { id: 'breakdowns', label: 'Breakdown Tickets', render: renderBreakdowns },
  ];

  function renderModule(container, params) {
    const active = (params && params[0]) || 'schedules';
    const root = App.el('<div></div>');
    const tabBar = App.el('<div class="tabs"></div>');
    TABS.forEach(t => {
      const b = App.el('<button' + (t.id === active ? ' class="active"' : '') + '>' + App.esc(t.label) + '</button>');
      b.addEventListener('click', () => App.navigate('#/maintenance/' + t.id));
      tabBar.appendChild(b);
    });
    root.appendChild(tabBar);
    const tab = TABS.find(t => t.id === active) || TABS[0];
    root.appendChild(tab.render(container));
    container.appendChild(root);
  }

  App.registerModule({
    id: 'maintenance',
    title: 'Maintenance',
    order: 5,
    render(container, params) { renderModule(container, params); },
  });
})();
