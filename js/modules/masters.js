/* =============================================================
 * SSSIHMS Fleet — Fleet Register module (vehicles, drivers, vendors)
 * Owns: #/vehicles (list + CRUD), #/vehicles/drivers, #/vehicles/vendors,
 *       #/vehicles/<id>[/<tab>]  (vehicle detail page, cross-linked by all
 *       other modules).
 * Spec refs: §4.1-4.4, §5.2, §5.10.
 * ============================================================= */
(function () {
  'use strict';

  var TYPES = ['ambulance', 'patient transport', 'staff transport', 'utility', 'goods', 'other'];
  var AMB_CATS = ['BLS', 'ALS', 'neonatal', 'cardiac', 'mortuary', 'other'];
  var FUEL_TYPES = ['petrol', 'diesel', 'CNG', 'electric', 'hybrid', 'other'];
  var OWNERSHIP = ['owned', 'leased', 'rented', 'donated', 'outsourced'];
  var STATUSES = ['available', 'on trip', 'under maintenance', 'off road', 'standby', 'retired'];
  var EMP_TYPES = ['employee', 'contract', 'vendor'];
  var VENDOR_TYPES = ['fuel station', 'workshop', 'dealer', 'insurance', 'towing', 'certification', 'rental agency', 'other'];
  var CRITICAL_DOC_TYPES = ['Insurance', 'Fitness certificate', 'Permit', 'Driver license'];
  var VEHICLE_TABS = [
    ['profile', 'Profile'], ['fuel', 'Fuel'], ['maintenance', 'Maintenance'], ['pm', 'PM Schedule'],
    ['breakdowns', 'Breakdowns'], ['documents', 'Documents'], ['cost', 'Cost Summary'],
    ['audit', 'Audit Trail'], ['qr', 'QR Label'],
  ];

  // ---------------------------------------------------------------- helpers
  // NOTE: App.table() in js/app.js currently builds <td> cells but never
  // appends them to their <tr> (rows render empty). Since this module may
  // not modify app.js, a drop-in-compatible local table builder is used
  // instead so vehicle/driver/vendor data actually renders. Behavior is
  // otherwise identical to App.table's documented contract.
  function buildTable(opts) {
    var columns = opts.columns, rows = opts.rows, empty = opts.empty;
    var wrap = App.el('<div class="table-wrap"></div>');
    if (!rows.length) { wrap.innerHTML = '<p style="padding:1rem" class="text-muted">' + App.esc(empty || 'No records.') + '</p>'; return wrap; }
    var tbl = App.el('<table class="data"></table>');
    tbl.innerHTML = '<thead><tr>' + columns.map(function (c) { return '<th class="' + (c.num ? 'num' : '') + '">' + App.esc(c.label) + '</th>'; }).join('') + '</tr></thead>';
    var tbody = document.createElement('tbody');
    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      columns.forEach(function (c) {
        var td = document.createElement('td');
        if (c.num) td.className = 'num';
        var val = c.render ? c.render(row) : row[c.key];
        if (val instanceof Element) td.appendChild(val);
        else if (c.render) td.innerHTML = (val == null ? '—' : val);
        else td.textContent = (val == null || val === '') ? '—' : val;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody); wrap.appendChild(tbl); return wrap;
  }

  function norm(v) { return (v == null ? '' : String(v)).trim().toLowerCase(); }

  async function persist(action, successMessage, onDone) {
    try { await action(); App.toast(successMessage); if (onDone) onDone(); }
    catch (error) { App.toast(error.message, true); }
  }

  function statusBadge(s) { return App.badge(s || '—', s); }

  function driverForVehicle(vehicleId) {
    return DB.list('drivers', function (d) { return d.assignedVehicleId === vehicleId; })[0] || null;
  }

  function activeTripForVehicle(vehicleId) {
    return DB.list('trips', function (t) {
      return t.vehicleId === vehicleId && ['assigned', 'started'].indexOf(t.status) !== -1;
    })[0] || null;
  }

  function vehicleDocs(vehicleId) {
    return DB.list('documents', function (d) { return d.vehicleId === vehicleId; })
      .sort(function (a, b) { return (a.expiryDate || '').localeCompare(b.expiryDate || ''); });
  }

  function isVehicleNonCompliant(vehicleId) {
    return vehicleDocs(vehicleId).some(function (d) {
      return CRITICAL_DOC_TYPES.indexOf(d.docType) !== -1 && App.daysUntil(d.expiryDate) != null && App.daysUntil(d.expiryDate) < 0;
    });
  }

  function pmStatusFor(sched, vehicle) {
    var daysLeft = App.daysUntil(sched.nextDueDate);
    var kmLeft = (sched.nextDueOdo != null && vehicle) ? (sched.nextDueOdo - vehicle.odometer) : null;
    var overdue = (daysLeft != null && daysLeft < 0) || (kmLeft != null && kmLeft < 0);
    var due = !overdue && ((daysLeft != null && daysLeft <= 15) || (kmLeft != null && kmLeft <= 500));
    if (sched.status && sched.status !== 'active') return { label: sched.status, cls: sched.status };
    if (overdue) return { label: 'overdue', cls: 'overdue' };
    if (due) return { label: 'due soon', cls: 'due' };
    return { label: 'scheduled', cls: 'ok' };
  }

  function subNav(active) {
    var wrap = App.el('<div style="margin-bottom:1rem;display:flex;gap:.4rem;flex-wrap:wrap"></div>');
    [['', 'Vehicles'], ['drivers', 'Drivers'], ['vendors', 'Vendors']].forEach(function (t) {
      var a = App.el('<a href="#/vehicles' + (t[0] ? '/' + t[0] : '') + '" class="btn small ' + (active === t[0] ? '' : 'ghost') + '" style="text-decoration:none">' + App.esc(t[1]) + '</a>');
      wrap.appendChild(a);
    });
    return wrap;
  }

  function confirmDelete(label, onYes) {
    App.modal({
      title: 'Confirm delete',
      body: '<p>Delete <strong>' + App.esc(label) + '</strong>? This can be recovered only by a database admin (soft delete).</p>',
      actions: [
        { label: 'Cancel', cls: 'ghost' },
        { label: 'Delete', cls: 'danger', onClick: function (close) { onYes(); close(); } },
      ],
    });
  }

  // ================================================================
  // VEHICLE LIST
  // ================================================================
  function renderVehicleList(container) {
    var filters = { type: '', status: '', dept: '', q: '' };

    function paint() {
      container.innerHTML = '';
      container.appendChild(subNav(''));

      var title = App.el('<div class="page-title"><h2>Fleet Register — Vehicles</h2></div>');
      if (App.can('masters.edit')) {
        var addBtn = App.el('<button class="btn">+ Add Vehicle</button>');
        addBtn.addEventListener('click', function () { openVehicleForm(null, paint); });
        title.appendChild(addBtn);
      }
      container.appendChild(title);

      var vehicles = DB.list('vehicles');
      var depts = Array.from(new Set(vehicles.map(function (v) { return v.department; }).filter(Boolean))).sort();

      var bar = App.el('<div class="filter-bar card"></div>');
      var typeSel = document.createElement('select');
      typeSel.appendChild(new Option('All types', ''));
      TYPES.forEach(function (t) { typeSel.appendChild(new Option(t, t)); });
      typeSel.value = filters.type;
      var statusSel = document.createElement('select');
      statusSel.appendChild(new Option('All statuses', ''));
      STATUSES.forEach(function (t) { statusSel.appendChild(new Option(t, t)); });
      statusSel.value = filters.status;
      var deptSel = document.createElement('select');
      deptSel.appendChild(new Option('All departments', ''));
      depts.forEach(function (d) { deptSel.appendChild(new Option(d, d)); });
      deptSel.value = filters.dept;
      var q = document.createElement('input');
      q.type = 'text'; q.placeholder = 'Search reg no / asset code / make / model'; q.value = filters.q;
      q.style.minWidth = '260px';

      [['Type', typeSel], ['Status', statusSel], ['Department', deptSel], ['Search', q]].forEach(function (pair) {
        var f = App.el('<div class="field"></div>');
        f.innerHTML = '<label>' + pair[0] + '</label>';
        f.appendChild(pair[1]);
        bar.appendChild(f);
      });
      typeSel.addEventListener('change', function () { filters.type = typeSel.value; paint(); });
      statusSel.addEventListener('change', function () { filters.status = statusSel.value; paint(); });
      deptSel.addEventListener('change', function () { filters.dept = deptSel.value; paint(); });
      q.addEventListener('input', function () { filters.q = q.value; paint(); });
      container.appendChild(bar);

      var rows = vehicles.filter(function (v) {
        if (filters.type && v.type !== filters.type) return false;
        if (filters.status && v.status !== filters.status) return false;
        if (filters.dept && v.department !== filters.dept) return false;
        if (filters.q) {
          var hay = norm([v.regNo, v.assetCode, v.make, v.model, v.callSign].join(' '));
          if (hay.indexOf(norm(filters.q)) === -1) return false;
        }
        return true;
      }).sort(function (a, b) { return (a.assetCode || '').localeCompare(b.assetCode || ''); });

      var canEdit = App.can('masters.edit');
      var tbl = buildTable({
        columns: [
          { key: 'assetCode', label: 'Asset Code' },
          { key: 'regNo', label: 'Reg No', render: function (r) { return '<a class="rowlink" href="#/vehicles/' + r.id + '">' + App.esc(r.regNo) + '</a>'; } },
          { key: 'type', label: 'Type', render: function (r) { return App.esc(r.type) + (r.ambCategory ? ' <span class="text-muted">(' + App.esc(r.ambCategory) + ')</span>' : ''); } },
          { key: 'department', label: 'Department' },
          { key: 'status', label: 'Status', render: function (r) { return statusBadge(r.status); } },
          { key: 'odometer', label: 'Odometer', num: true, render: function (r) { return App.fmtNum(r.odometer, 0) + ' km'; } },
          { key: 'driver', label: 'Assigned Driver', render: function (r) { var d = driverForVehicle(r.id); return d ? App.esc(d.name) : '<span class="text-muted">unassigned</span>'; } },
          { key: 'compliance', label: 'Compliance', render: function (r) { return isVehicleNonCompliant(r.id) ? App.badge('non-compliant', 'expired') : App.badge('compliant', 'valid'); } },
          {
            key: 'actions', label: 'Actions', render: function (r) {
              var wrap = App.el('<div style="display:flex;gap:.3rem;flex-wrap:wrap"></div>');
              var viewA = App.el('<a class="btn small ghost" href="#/vehicles/' + r.id + '" style="text-decoration:none">View</a>');
              wrap.appendChild(viewA);
              if (canEdit) {
                var editBtn = App.el('<button class="btn small ghost">Edit</button>');
                editBtn.addEventListener('click', function () { openVehicleForm(r, paint); });
                var delBtn = App.el('<button class="btn small danger">Delete</button>');
                delBtn.addEventListener('click', function () {
                  confirmDelete(r.regNo + ' (' + r.assetCode + ')', function () { persist(function () { return DB.softDelete('vehicles', r.id); }, 'Vehicle deleted', paint); });
                });
                wrap.appendChild(editBtn);
                wrap.appendChild(delBtn);
              }
              return wrap;
            },
          },
        ],
        rows: rows,
        empty: 'No vehicles match the current filters.',
      });
      container.appendChild(tbl);

      var exportBtn = App.el('<button class="btn ghost small" style="margin-top:.6rem">Export CSV</button>');
      exportBtn.addEventListener('click', function () {
        App.exportCSV('vehicles.csv', ['Asset Code', 'Reg No', 'Type', 'Category', 'Department', 'Status', 'Odometer', 'Ownership', 'Fuel Type'],
          rows.map(function (r) { return [r.assetCode, r.regNo, r.type, r.ambCategory || '', r.department, r.status, r.odometer, r.ownership, r.fuelType]; }));
      });
      container.appendChild(exportBtn);
    }

    paint();
  }

  function openVehicleForm(existing, onDone) {
    var fields = [
      { name: 'assetCode', label: 'Asset Code', required: true },
      { name: 'regNo', label: 'Registration Number', required: true },
      { name: 'type', label: 'Vehicle Type', type: 'select', options: TYPES, required: true },
      { name: 'ambCategory', label: 'Ambulance Category', type: 'select', options: AMB_CATS, hint: 'Only if type = ambulance' },
      { name: 'make', label: 'Make' },
      { name: 'model', label: 'Model' },
      { name: 'year', label: 'Year of Manufacture', type: 'number' },
      { name: 'chassisNo', label: 'Chassis Number' },
      { name: 'engineNo', label: 'Engine Number' },
      { name: 'fuelType', label: 'Fuel Type', type: 'select', options: FUEL_TYPES },
      { name: 'ownership', label: 'Ownership', type: 'select', options: OWNERSHIP },
      { name: 'department', label: 'Department / Cost Center', required: true },
      { name: 'baseLocation', label: 'Base Location' },
      { name: 'status', label: 'Current Status', type: 'select', options: STATUSES, required: true },
      { name: 'odometer', label: 'Current Odometer (km)', type: 'number', min: 0, required: true },
      { name: 'purchaseDate', label: 'Purchase Date', type: 'date' },
      { name: 'purchaseCost', label: 'Purchase Cost (₹)', type: 'number', min: 0 },
      { name: 'vendor', label: 'Vendor / Dealer' },
      { name: 'seating', label: 'Seating Capacity', type: 'number', min: 0 },
      { name: 'loadCapacity', label: 'Load Capacity' },
      { name: 'tankCapacity', label: 'Tank Capacity (L)', type: 'number', min: 0 },
      { name: 'mileageBenchmark', label: 'Expected Mileage Benchmark (km/l)', type: 'number', min: 0 },
      { name: 'callSign', label: 'Ambulance Call Sign' },
      { name: 'emergencyPhone', label: 'Emergency Contact Number' },
      { name: 'gpsDeviceId', label: 'GPS Device ID' },
      { name: 'fastagId', label: 'FASTag ID' },
      { name: 'fuelCardNo', label: 'Fuel Card Number' },
      { name: 'insuranceProvider', label: 'Insurance Provider' },
      { name: 'pollutionCategory', label: 'Pollution Category / Emission Standard' },
      { name: 'monthlyUtilization', label: 'Expected Monthly Utilization (km)', type: 'number', min: 0 },
      { name: 'depreciationMethod', label: 'Depreciation Method' },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true },
    ];
    fields[0].validate = function (v) {
      v = norm(v); if (!v) return null;
      var dup = DB.list('vehicles', function (x) { return (!existing || x.id !== existing.id) && norm(x.assetCode) === v; });
      return dup.length ? 'Asset code already in use' : null;
    };
    fields[1].validate = function (v) {
      v = norm(v); if (!v) return null;
      var dup = DB.list('vehicles', function (x) { return (!existing || x.id !== existing.id) && norm(x.regNo) === v; });
      return dup.length ? 'Registration number already in use' : null;
    };
    fields.filter(function (f) { return f.name === 'odometer'; })[0].validate = function (v) {
      if (existing && v !== '' && v != null && Number(v) < Number(existing.odometer)) {
        return 'Cannot be less than current odometer (' + App.fmtNum(existing.odometer, 0) + ' km)';
      }
      return null;
    };

    var f = App.form(fields, existing || { status: 'available', ownership: 'owned', fuelType: 'diesel' });
    App.modal({
      title: existing ? 'Edit Vehicle — ' + existing.regNo : 'Add Vehicle',
      body: f.el,
      actions: [
        { label: 'Cancel', cls: 'ghost' },
        {
          label: existing ? 'Save' : 'Add Vehicle', onClick: async function (close) {
            if (!f.validate()) return;
            var data = f.read();
            try {
              if (existing) await DB.update('vehicles', existing.id, data);
              else await DB.insert('vehicles', data);
              App.toast(existing ? 'Vehicle updated' : 'Vehicle added'); close(); onDone && onDone();
            } catch (error) { App.toast(error.message, true); }
          },
        },
      ],
    });
  }

  // ================================================================
  // DRIVER LIST
  // ================================================================
  function renderDriverList(container) {
    var filters = { active: '', q: '' };

    function paint() {
      container.innerHTML = '';
      container.appendChild(subNav('drivers'));

      var title = App.el('<div class="page-title"><h2>Fleet Register — Drivers</h2></div>');
      if (App.can('masters.edit')) {
        var addBtn = App.el('<button class="btn">+ Add Driver</button>');
        addBtn.addEventListener('click', function () { openDriverForm(null, paint); });
        title.appendChild(addBtn);
      }
      container.appendChild(title);

      var bar = App.el('<div class="filter-bar card"></div>');
      var activeSel = document.createElement('select');
      [['', 'All'], ['1', 'Active'], ['0', 'Inactive']].forEach(function (o) { activeSel.appendChild(new Option(o[1], o[0])); });
      activeSel.value = filters.active;
      var q = document.createElement('input'); q.type = 'text'; q.placeholder = 'Search name / mobile / license'; q.value = filters.q; q.style.minWidth = '260px';
      [['Status', activeSel], ['Search', q]].forEach(function (p) {
        var w = App.el('<div class="field"></div>'); w.innerHTML = '<label>' + p[0] + '</label>'; w.appendChild(p[1]); bar.appendChild(w);
      });
      activeSel.addEventListener('change', function () { filters.active = activeSel.value; paint(); });
      q.addEventListener('input', function () { filters.q = q.value; paint(); });
      container.appendChild(bar);

      var rows = DB.list('drivers').filter(function (d) {
        if (filters.active === '1' && !d.active) return false;
        if (filters.active === '0' && d.active) return false;
        if (filters.q) {
          var hay = norm([d.name, d.mobile, d.licenseNo, d.driverId].join(' '));
          if (hay.indexOf(norm(filters.q)) === -1) return false;
        }
        return true;
      }).sort(function (a, b) { return (a.driverId || '').localeCompare(b.driverId || ''); });

      var canEdit = App.can('masters.edit');
      var tbl = buildTable({
        columns: [
          { key: 'driverId', label: 'Driver ID' },
          { key: 'name', label: 'Name' },
          { key: 'mobile', label: 'Mobile' },
          { key: 'licenseNo', label: 'License No' },
          {
            key: 'licenseExpiry', label: 'License Expiry', render: function (r) {
              var st = App.docStatus(r.licenseExpiry);
              return App.fmtDate(r.licenseExpiry) + ' ' + App.badge(st.label, st.cls);
            },
          },
          { key: 'employeeType', label: 'Type' },
          { key: 'assignedVehicleId', label: 'Assigned Vehicle', render: function (r) { return r.assignedVehicleId ? '<a class="rowlink" href="#/vehicles/' + r.assignedVehicleId + '">' + App.esc(App.vehicleName(r.assignedVehicleId)) + '</a>' : '—'; } },
          { key: 'shift', label: 'Shift' },
          { key: 'active', label: 'Status', render: function (r) { return r.active ? App.badge('active') : App.badge('inactive'); } },
          {
            key: 'actions', label: 'Actions', render: function (r) {
              var wrap = App.el('<div style="display:flex;gap:.3rem;flex-wrap:wrap"></div>');
              if (!canEdit) { wrap.textContent = '—'; return wrap; }
              var editBtn = App.el('<button class="btn small ghost">Edit</button>');
              editBtn.addEventListener('click', function () { openDriverForm(r, paint); });
              var delBtn = App.el('<button class="btn small danger">Delete</button>');
              delBtn.addEventListener('click', function () { confirmDelete(r.name, function () { persist(function () { return DB.softDelete('drivers', r.id); }, 'Driver deleted', paint); }); });
              wrap.appendChild(editBtn); wrap.appendChild(delBtn);
              return wrap;
            },
          },
        ],
        rows: rows,
        empty: 'No drivers match the current filters.',
      });
      container.appendChild(tbl);

      var exportBtn = App.el('<button class="btn ghost small" style="margin-top:.6rem">Export CSV</button>');
      exportBtn.addEventListener('click', function () {
        App.exportCSV('drivers.csv', ['Driver ID', 'Name', 'Mobile', 'License No', 'License Expiry', 'Type', 'Shift', 'Active'],
          rows.map(function (r) { return [r.driverId, r.name, r.mobile, r.licenseNo, r.licenseExpiry, r.employeeType, r.shift, r.active ? 'Yes' : 'No']; }));
      });
      container.appendChild(exportBtn);
    }
    paint();
  }

  function openDriverForm(existing, onDone) {
    var vehicleOpts = DB.list('vehicles').filter(function (v) { return v.status !== 'retired'; })
      .sort(function (a, b) { return a.regNo.localeCompare(b.regNo); })
      .map(function (v) { return { value: v.id, label: v.regNo + ' (' + v.assetCode + ')' }; });

    var fields = [
      { name: 'driverId', label: 'Driver ID', required: true },
      { name: 'name', label: 'Name', required: true },
      { name: 'mobile', label: 'Mobile Number', required: true },
      { name: 'altContact', label: 'Alternate Contact' },
      { name: 'licenseNo', label: 'License Number', required: true },
      { name: 'licenseClass', label: 'License Class' },
      { name: 'licenseExpiry', label: 'License Expiry Date', type: 'date', required: true },
      { name: 'badgeNo', label: 'Badge Number' },
      { name: 'employeeType', label: 'Employee Type', type: 'select', options: EMP_TYPES, required: true },
      { name: 'assignedVehicleId', label: 'Assigned Vehicle', type: 'select', options: vehicleOpts },
      { name: 'shift', label: 'Shift' },
      { name: 'active', label: 'Active', type: 'checkbox', value: true },
      { name: 'emergencyContact', label: 'Emergency Contact' },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true },
    ];
    fields[0].validate = function (v) {
      v = norm(v); if (!v) return null;
      var dup = DB.list('drivers', function (x) { return (!existing || x.id !== existing.id) && norm(x.driverId) === v; });
      return dup.length ? 'Driver ID already in use' : null;
    };

    var f = App.form(fields, existing || { active: true, employeeType: 'employee' });
    App.modal({
      title: existing ? 'Edit Driver — ' + existing.name : 'Add Driver',
      body: f.el,
      actions: [
        { label: 'Cancel', cls: 'ghost' },
        {
          label: existing ? 'Save' : 'Add Driver', onClick: async function (close) {
            if (!f.validate()) return;
            var data = f.read();
            try {
              if (existing) await DB.update('drivers', existing.id, data);
              else await DB.insert('drivers', data);
              App.toast(existing ? 'Driver updated' : 'Driver added'); close(); onDone && onDone();
            } catch (error) { App.toast(error.message, true); }
          },
        },
      ],
    });
  }

  // ================================================================
  // VENDOR LIST
  // ================================================================
  function renderVendorList(container) {
    var filters = { type: '', q: '' };

    function paint() {
      container.innerHTML = '';
      container.appendChild(subNav('vendors'));

      var title = App.el('<div class="page-title"><h2>Fleet Register — Vendors</h2></div>');
      if (App.can('masters.edit')) {
        var addBtn = App.el('<button class="btn">+ Add Vendor</button>');
        addBtn.addEventListener('click', function () { openVendorForm(null, paint); });
        title.appendChild(addBtn);
      }
      container.appendChild(title);

      var bar = App.el('<div class="filter-bar card"></div>');
      var typeSel = document.createElement('select');
      typeSel.appendChild(new Option('All types', ''));
      VENDOR_TYPES.forEach(function (t) { typeSel.appendChild(new Option(t, t)); });
      typeSel.value = filters.type;
      var q = document.createElement('input'); q.type = 'text'; q.placeholder = 'Search name / contact / phone'; q.value = filters.q; q.style.minWidth = '260px';
      [['Type', typeSel], ['Search', q]].forEach(function (p) {
        var w = App.el('<div class="field"></div>'); w.innerHTML = '<label>' + p[0] + '</label>'; w.appendChild(p[1]); bar.appendChild(w);
      });
      typeSel.addEventListener('change', function () { filters.type = typeSel.value; paint(); });
      q.addEventListener('input', function () { filters.q = q.value; paint(); });
      container.appendChild(bar);

      var rows = DB.list('vendors').filter(function (v) {
        if (filters.type && v.type !== filters.type) return false;
        if (filters.q) {
          var hay = norm([v.name, v.contactPerson, v.phone].join(' '));
          if (hay.indexOf(norm(filters.q)) === -1) return false;
        }
        return true;
      }).sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });

      var canEdit = App.can('masters.edit');
      var tbl = buildTable({
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'type', label: 'Type' },
          { key: 'contactPerson', label: 'Contact Person' },
          { key: 'phone', label: 'Phone' },
          { key: 'gst', label: 'GST / Tax No' },
          { key: 'paymentTerms', label: 'Payment Terms' },
          { key: 'active', label: 'Status', render: function (r) { return r.active ? App.badge('active') : App.badge('inactive'); } },
          {
            key: 'actions', label: 'Actions', render: function (r) {
              var wrap = App.el('<div style="display:flex;gap:.3rem;flex-wrap:wrap"></div>');
              if (!canEdit) { wrap.textContent = '—'; return wrap; }
              var editBtn = App.el('<button class="btn small ghost">Edit</button>');
              editBtn.addEventListener('click', function () { openVendorForm(r, paint); });
              var delBtn = App.el('<button class="btn small danger">Delete</button>');
              delBtn.addEventListener('click', function () { confirmDelete(r.name, function () { persist(function () { return DB.softDelete('vendors', r.id); }, 'Vendor deleted', paint); }); });
              wrap.appendChild(editBtn); wrap.appendChild(delBtn);
              return wrap;
            },
          },
        ],
        rows: rows,
        empty: 'No vendors match the current filters.',
      });
      container.appendChild(tbl);

      var exportBtn = App.el('<button class="btn ghost small" style="margin-top:.6rem">Export CSV</button>');
      exportBtn.addEventListener('click', function () {
        App.exportCSV('vendors.csv', ['Name', 'Type', 'Contact Person', 'Phone', 'GST', 'Payment Terms', 'Active'],
          rows.map(function (r) { return [r.name, r.type, r.contactPerson, r.phone, r.gst || '', r.paymentTerms || '', r.active ? 'Yes' : 'No']; }));
      });
      container.appendChild(exportBtn);
    }
    paint();
  }

  function openVendorForm(existing, onDone) {
    if (!App.can('masters.edit')) return App.toast('You do not have permission to manage vendor master data.', true);
    var fields = [
      { name: 'name', label: 'Vendor Name', required: true },
      { name: 'type', label: 'Vendor Type', type: 'select', options: VENDOR_TYPES, required: true },
      { name: 'contactPerson', label: 'Contact Person' },
      { name: 'phone', label: 'Phone' },
      { name: 'email', label: 'Email' },
      { name: 'address', label: 'Address', type: 'textarea', full: true },
      { name: 'gst', label: 'GST / Tax Number' },
      { name: 'contractTerms', label: 'Contract Terms', type: 'textarea', full: true },
      { name: 'paymentTerms', label: 'Payment Terms' },
      { name: 'creditFacility', label: 'Credit Facility', type: 'checkbox' },
      { name: 'monthlyBilling', label: 'Monthly Billing Enabled', type: 'checkbox' },
      { name: 'active', label: 'Active', type: 'checkbox', value: true },
    ];
    fields[0].validate = function (v) {
      v = norm(v); if (!v) return null;
      var dup = DB.list('vendors', function (x) { return (!existing || x.id !== existing.id) && norm(x.name) === v; });
      return dup.length ? 'Vendor name already in use' : null;
    };
    var f = App.form(fields, existing || { active: true });
    App.modal({
      title: existing ? 'Edit Vendor — ' + existing.name : 'Add Vendor',
      body: f.el,
      actions: [
        { label: 'Cancel', cls: 'ghost' },
        {
          label: existing ? 'Save' : 'Add Vendor', onClick: async function (close) {
            if (!f.validate()) return;
            var data = f.read();
            try {
              if (existing) await DB.update('vendors', existing.id, data);
              else await DB.insert('vendors', data);
              App.toast(existing ? 'Vendor updated' : 'Vendor added'); close(); onDone && onDone();
            } catch (error) { App.toast(error.message, true); }
          },
        },
      ],
    });
  }

  // ================================================================
  // VEHICLE DETAIL PAGE
  // ================================================================
  function renderVehicleDetail(container, id, initialTab) {
    var vehicle = DB.get('vehicles', id);
    if (!vehicle) {
      container.innerHTML = '';
      container.appendChild(subNav(''));
      container.appendChild(App.el('<div class="card"><h3>Vehicle not found</h3><p class="text-muted">It may have been deleted. <a class="rowlink" href="#/vehicles">Back to Fleet Register</a></p></div>'));
      return;
    }
    var activeTab = VEHICLE_TABS.some(function (t) { return t[0] === initialTab; }) ? initialTab : 'profile';

    function paint() {
      container.innerHTML = '';
      container.appendChild(subNav(''));

      var head = App.el('<div class="page-title"></div>');
      var h2 = App.el('<h2></h2>');
      h2.textContent = vehicle.regNo + ' — ' + (vehicle.make || '') + ' ' + (vehicle.model || '') + ' (' + vehicle.assetCode + ')';
      head.appendChild(h2);
      var headActions = App.el('<div style="display:flex;gap:.5rem;align-items:center"></div>');
      headActions.appendChild(App.el('<span>' + statusBadge(vehicle.status) + '</span>'));
      if (isVehicleNonCompliant(vehicle.id)) headActions.appendChild(App.el('<span>' + App.badge('non-compliant', 'expired') + '</span>'));
      if (App.can('masters.edit')) {
        var editBtn = App.el('<button class="btn small ghost">Edit Vehicle</button>');
        editBtn.addEventListener('click', function () { openVehicleForm(vehicle, function () { vehicle = DB.get('vehicles', id); paint(); }); });
        headActions.appendChild(editBtn);
      }
      head.appendChild(headActions);
      container.appendChild(head);

      var tabsBar = App.el('<div class="tabs"></div>');
      VEHICLE_TABS.forEach(function (t) {
        var b = App.el('<button class="' + (t[0] === activeTab ? 'active' : '') + '"></button>');
        b.textContent = t[1];
        b.addEventListener('click', function () { activeTab = t[0]; location.hash = '#/vehicles/' + id + '/' + t[0]; paint(); });
        tabsBar.appendChild(b);
      });
      container.appendChild(tabsBar);

      var panel = App.el('<div></div>');
      container.appendChild(panel);

      switch (activeTab) {
        case 'profile': renderProfileTab(panel); break;
        case 'fuel': renderFuelTab(panel); break;
        case 'maintenance': renderMaintenanceTab(panel); break;
        case 'pm': renderPmTab(panel); break;
        case 'breakdowns': renderBreakdownsTab(panel); break;
        case 'documents': renderDocumentsTab(panel); break;
        case 'cost': renderCostTab(panel); break;
        case 'audit': renderAuditTab(panel); break;
        case 'qr': renderQrTab(panel); break;
      }
    }

    function kvRow(dt, dd) {
      return '<dt>' + App.esc(dt) + '</dt><dd>' + (dd == null || dd === '' ? '—' : dd) + '</dd>';
    }

    function renderProfileTab(panel) {
      var driver = driverForVehicle(vehicle.id);
      var trip = activeTripForVehicle(vehicle.id);
      var grid = App.el('<div class="grid cols-2"></div>');

      var profileCard = App.el('<div class="card"><h3>Master Profile</h3><dl class="kv"></dl></div>');
      var dl = profileCard.querySelector('dl');
      dl.innerHTML = [
        kvRow('Asset Code', App.esc(vehicle.assetCode)),
        kvRow('Registration No', App.esc(vehicle.regNo)),
        kvRow('Type', App.esc(vehicle.type) + (vehicle.ambCategory ? ' (' + App.esc(vehicle.ambCategory) + ')' : '')),
        kvRow('Make / Model', App.esc((vehicle.make || '') + ' ' + (vehicle.model || '')) + (vehicle.year ? ' · ' + vehicle.year : '')),
        kvRow('Chassis No', App.esc(vehicle.chassisNo)),
        kvRow('Engine No', App.esc(vehicle.engineNo)),
        kvRow('Fuel Type', App.esc(vehicle.fuelType)),
        kvRow('Ownership', App.esc(vehicle.ownership)),
        kvRow('Department', App.esc(vehicle.department)),
        kvRow('Base Location', App.esc(vehicle.baseLocation)),
        kvRow('Seating / Load Capacity', FleetRules.safeTextJoin([vehicle.seating ? vehicle.seating + ' seats' : null, vehicle.loadCapacity], ' · ') || null),
        kvRow('Tank Capacity', vehicle.tankCapacity ? vehicle.tankCapacity + ' L' : null),
        kvRow('Mileage Benchmark', vehicle.mileageBenchmark ? App.fmtNum(vehicle.mileageBenchmark) + ' km/l' : null),
        kvRow('Purchase Date / Cost', (vehicle.purchaseDate ? App.fmtDate(vehicle.purchaseDate) : '—') + ' / ' + App.fmtINR(vehicle.purchaseCost)),
        kvRow('Vendor / Dealer', App.esc(vehicle.vendor)),
        kvRow('Call Sign', App.esc(vehicle.callSign)),
        kvRow('Emergency Phone', App.esc(vehicle.emergencyPhone)),
        kvRow('GPS Device / FASTag', FleetRules.safeTextJoin([vehicle.gpsDeviceId, vehicle.fastagId], ' / ') || null),
        kvRow('Insurance Provider', App.esc(vehicle.insuranceProvider)),
        kvRow('Pollution Category', App.esc(vehicle.pollutionCategory)),
        kvRow('Notes', App.esc(vehicle.notes)),
      ].join('');
      grid.appendChild(profileCard);

      var statusCard = App.el('<div class="card"><h3>Availability &amp; Assignment</h3><dl class="kv"></dl></div>');
      var dl2 = statusCard.querySelector('dl');
      dl2.innerHTML = [
        kvRow('Current Status', statusBadge(vehicle.status)),
        kvRow('Last Known Odometer', App.fmtNum(vehicle.odometer, 0) + ' km'),
        kvRow('Assigned Driver', driver ? App.esc(driver.name) + ' (' + App.esc(driver.mobile) + ')' : null),
        kvRow('Active Trip', trip ? '<a class="rowlink" href="#/trips">' + App.esc(trip.tripNo) + ' — ' + App.esc(trip.status) + '</a>' : 'None'),
      ].join('');
      grid.appendChild(statusCard);

      panel.appendChild(grid);
    }

    function renderFuelTab(panel) {
      var logs = DB.list('fuelLogs', function (f) { return f.vehicleId === vehicle.id; }).sort(function (a, b) { return (a.odometer || 0) - (b.odometer || 0); });
      var withDistance = logs.map(function (l, i) {
        var prev = i > 0 ? logs[i - 1] : null;
        var distance = prev && l.odometer != null && prev.odometer != null ? l.odometer - prev.odometer : null;
        var kmpl = (distance && l.qty) ? distance / l.qty : null;
        return Object.assign({}, l, { distance: distance, kmpl: kmpl });
      }).sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });

      var link = App.el('<p style="margin-bottom:.6rem"><a class="rowlink" href="#/fuel">Enter / verify fuel logs in the Fuel module →</a></p>');
      panel.appendChild(link);
      panel.appendChild(buildTable({
        columns: [
          { key: 'date', label: 'Date', render: function (r) { return App.fmtDate(r.date); } },
          { key: 'logNo', label: 'Log No' },
          { key: 'qty', label: 'Qty (L)', num: true, render: function (r) { return App.fmtNum(r.qty); } },
          { key: 'rate', label: 'Rate', num: true, render: function (r) { return App.fmtINR(r.rate); } },
          { key: 'amount', label: 'Amount', num: true, render: function (r) { return App.fmtINR(r.amount); } },
          { key: 'odometer', label: 'Odometer', num: true, render: function (r) { return App.fmtNum(r.odometer, 0); } },
          { key: 'distance', label: 'Distance Since Last', num: true, render: function (r) { return r.distance != null ? App.fmtNum(r.distance, 0) + ' km' : '—'; } },
          { key: 'kmpl', label: 'Efficiency', num: true, render: function (r) { return r.kmpl != null ? App.fmtNum(r.kmpl, 1) + ' km/l' : '—'; } },
          { key: 'vendorId', label: 'Vendor', render: function (r) { return App.esc(App.vendorName(r.vendorId)); } },
          { key: 'status', label: 'Status', render: function (r) { return statusBadge(r.status); } },
        ],
        rows: withDistance,
        empty: 'No fuel logs recorded for this vehicle.',
      }));
    }

    function renderMaintenanceTab(panel) {
      var recs = DB.list('pmRecords', function (r) { return r.vehicleId === vehicle.id; }).sort(function (a, b) { return (b.serviceDate || '').localeCompare(a.serviceDate || ''); });
      var link = App.el('<p style="margin-bottom:.6rem"><a class="rowlink" href="#/maintenance">Record service / manage maintenance in the Maintenance module →</a></p>');
      panel.appendChild(link);
      panel.appendChild(buildTable({
        columns: [
          { key: 'serviceDate', label: 'Service Date', render: function (r) { return App.fmtDate(r.serviceDate); } },
          { key: 'serviceOdo', label: 'Odometer', num: true, render: function (r) { return App.fmtNum(r.serviceOdo, 0); } },
          { key: 'vendorId', label: 'Vendor', render: function (r) { return App.esc(App.vendorName(r.vendorId)); } },
          { key: 'workPerformed', label: 'Work Performed' },
          { key: 'totalCost', label: 'Total Cost', num: true, render: function (r) { return App.fmtINR(r.totalCost); } },
          { key: 'fitness', label: 'Fitness Outcome' },
          { key: 'invoiceNo', label: 'Invoice No' },
        ],
        rows: recs,
        empty: 'No maintenance history recorded for this vehicle.',
      }));
    }

    function renderPmTab(panel) {
      var scheds = DB.list('pmSchedules', function (s) { return s.vehicleId === vehicle.id; });
      var link = App.el('<p style="margin-bottom:.6rem"><a class="rowlink" href="#/maintenance">Manage PM schedules in the Maintenance module →</a></p>');
      panel.appendChild(link);
      panel.appendChild(buildTable({
        columns: [
          { key: 'maintenanceType', label: 'Type' },
          { key: 'freq', label: 'Frequency', render: function (r) { return [r.freqDays ? r.freqDays + ' days' : null, r.freqKm ? App.fmtNum(r.freqKm, 0) + ' km' : null].filter(Boolean).join(' / ') || '—'; } },
          { key: 'lastServiceDate', label: 'Last Service', render: function (r) { return App.fmtDate(r.lastServiceDate); } },
          { key: 'nextDueDate', label: 'Next Due', render: function (r) { return App.fmtDate(r.nextDueDate) + (r.nextDueOdo ? ' / ' + App.fmtNum(r.nextDueOdo, 0) + ' km' : ''); } },
          { key: 'priority', label: 'Priority' },
          { key: 'assignedTo', label: 'Assigned To' },
          { key: 'estCost', label: 'Est. Cost', num: true, render: function (r) { return App.fmtINR(r.estCost); } },
          { key: 'status', label: 'Status', render: function (r) { var st = pmStatusFor(r, vehicle); return App.badge(st.label, st.cls); } },
        ],
        rows: scheds,
        empty: 'No PM schedules configured for this vehicle.',
      }));
    }

    function renderBreakdownsTab(panel) {
      var rows = DB.list('breakdowns', function (b) { return b.vehicleId === vehicle.id; }).sort(function (a, b) { return (b.reportedAt || '').localeCompare(a.reportedAt || ''); });
      var link = App.el('<p style="margin-bottom:.6rem"><a class="rowlink" href="#/maintenance">Manage breakdown tickets in the Maintenance module →</a></p>');
      panel.appendChild(link);
      panel.appendChild(buildTable({
        columns: [
          { key: 'ticketNo', label: 'Ticket No' },
          { key: 'reportedAt', label: 'Reported', render: function (r) { return App.fmtDateTime(r.reportedAt); } },
          { key: 'issueCategory', label: 'Category' },
          { key: 'description', label: 'Description' },
          { key: 'severity', label: 'Severity', render: function (r) { return App.badge(r.severity, r.severity); } },
          { key: 'status', label: 'Status', render: function (r) { return statusBadge(r.status); } },
          { key: 'totalCost', label: 'Cost', num: true, render: function (r) { return App.fmtINR(r.totalCost); } },
        ],
        rows: rows,
        empty: 'No breakdown tickets recorded for this vehicle.',
      }));
    }

    function renderDocumentsTab(panel) {
      var docs = vehicleDocs(vehicle.id);
      var link = App.el('<p style="margin-bottom:.6rem"><a class="rowlink" href="#/compliance">Manage documents in the Compliance module →</a></p>');
      panel.appendChild(link);
      panel.appendChild(buildTable({
        columns: [
          { key: 'docType', label: 'Document Type' },
          { key: 'docNo', label: 'Document No' },
          { key: 'authority', label: 'Issuing Authority' },
          { key: 'issueDate', label: 'Issue Date', render: function (r) { return App.fmtDate(r.issueDate); } },
          { key: 'expiryDate', label: 'Expiry Date', render: function (r) { var st = App.docStatus(r.expiryDate); return App.fmtDate(r.expiryDate) + ' ' + App.badge(st.label, st.cls); } },
          { key: 'critical', label: 'Critical', render: function (r) { return CRITICAL_DOC_TYPES.indexOf(r.docType) !== -1 ? App.badge('critical', 'critical') : '—'; } },
          { key: 'remarks', label: 'Remarks' },
        ],
        rows: docs,
        empty: 'No documents on file for this vehicle.',
      }));
    }

    function renderCostTab(panel) {
      var fuelLogs = DB.list('fuelLogs', function (f) { return f.vehicleId === vehicle.id; });
      var pmRecs = DB.list('pmRecords', function (r) { return r.vehicleId === vehicle.id; });
      var bds = DB.list('breakdowns', function (b) { return b.vehicleId === vehicle.id; });
      var fuelCost = fuelLogs.filter(FleetRules.isTrustedFuelLog).reduce(function (s, f) { return s + (Number(f.amount) || 0); }, 0);
      var pmCost = pmRecs.reduce(function (s, r) { return s + (Number(r.totalCost) || 0); }, 0);
      var bdCost = bds.reduce(function (s, b) { return s + (Number(b.totalCost) || 0); }, 0);
      var total = fuelCost + pmCost + bdCost;
      var costPerKm = vehicle.odometer ? total / vehicle.odometer : null;

      var allVehicleTotals = DB.list('vehicles').map(function (v) {
        var fc = DB.list('fuelLogs', function (f) { return f.vehicleId === v.id && FleetRules.isTrustedFuelLog(f); }).reduce(function (s, f) { return s + (Number(f.amount) || 0); }, 0);
        var pc = DB.list('pmRecords', function (r) { return r.vehicleId === v.id; }).reduce(function (s, r) { return s + (Number(r.totalCost) || 0); }, 0);
        var bc = DB.list('breakdowns', function (b) { return b.vehicleId === v.id; }).reduce(function (s, b) { return s + (Number(b.totalCost) || 0); }, 0);
        return { id: v.id, total: fc + pc + bc };
      }).sort(function (a, b) { return b.total - a.total; });
      var rank = allVehicleTotals.findIndex(function (v) { return v.id === vehicle.id; });
      var isHighCost = rank !== -1 && rank < 10 && total > 0;

      var grid = App.el('<div class="grid cols-4"></div>');
      [
        ['Fuel Cost', App.fmtINR(fuelCost)],
        ['Preventive Maintenance Cost', App.fmtINR(pmCost)],
        ['Breakdown / Repair Cost', App.fmtINR(bdCost)],
        ['Total Lifetime Cost', App.fmtINR(total)],
      ].forEach(function (p) {
        grid.appendChild(App.el('<div class="card stat"><div class="stat-value">' + p[1] + '</div><div class="stat-label">' + App.esc(p[0]) + '</div></div>'));
      });
      panel.appendChild(grid);

      var extra = App.el('<div class="card mb-1" style="margin-top:1rem"><dl class="kv"></dl></div>');
      extra.querySelector('dl').innerHTML = [
        kvRow('Approx. Cost per KM (lifetime cost ÷ current odometer)', costPerKm != null ? '₹' + costPerKm.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' / km' : '—'),
        kvRow('Fuel Entries / PM Records / Breakdown Tickets', fuelLogs.length + ' / ' + pmRecs.length + ' / ' + bds.length),
        kvRow('High-Cost Vehicle Flag', isHighCost ? App.badge('high-cost', 'critical') : App.badge('normal', 'valid')),
      ].join('');
      panel.appendChild(extra);
    }

    function renderAuditTab(panel) {
      var direct = DB.list('auditLog', function (a) { return a.entityType === 'vehicles' && a.entityId === vehicle.id; });
      var related = DB.list('auditLog', function (a) {
        if (a.entityType === 'vehicles') return false;
        var payload = a.newValue || a.oldValue; if (!payload) return false;
        try { var obj = JSON.parse(payload); return obj.vehicleId === vehicle.id; } catch (e) { return false; }
      });
      var rows = direct.concat(related).sort(function (a, b) { return (b.timestamp || '').localeCompare(a.timestamp || ''); });
      panel.appendChild(buildTable({
        columns: [
          { key: 'timestamp', label: 'Timestamp', render: function (r) { return App.fmtDateTime(r.timestamp); } },
          { key: 'user', label: 'User' },
          { key: 'action', label: 'Action', render: function (r) { return App.badge(r.action, r.action); } },
          { key: 'entityType', label: 'Record Type' },
          { key: 'oldValue', label: 'Old Value', render: function (r) { return r.oldValue ? '<code style="font-size:.75rem">' + App.esc(r.oldValue.slice(0, 160)) + '</code>' : '—'; } },
          { key: 'newValue', label: 'New Value', render: function (r) { return r.newValue ? '<code style="font-size:.75rem">' + App.esc(r.newValue.slice(0, 160)) + '</code>' : '—'; } },
        ],
        rows: rows,
        empty: 'No audit history recorded for this vehicle yet.',
      }));
    }

    function renderQrTab(panel) {
      var url = location.origin + location.pathname + '#/vehicles/' + vehicle.id;
      var qrSrc = 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=' + encodeURIComponent(url);
      var wrap = App.el('<div></div>');
      wrap.innerHTML =
        '<style>' +
        '@media print { body > *:not(#print-qr-root) { display:none !important; } #print-qr-root { display:block !important; position:fixed; inset:0; } }' +
        '</style>' +
        '<div id="print-qr-root">' +
        '<div class="card" style="max-width:340px;text-align:center;padding:1.4rem">' +
        '<p style="font-family:\'Playfair Display\',serif;font-weight:700;font-size:1rem;margin:0 0 .3rem">SSSIHMS Fleet — Whitefield</p>' +
        '<img src="' + qrSrc + '" alt="QR code" width="180" height="180" style="margin:.6rem 0" />' +
        '<p style="font-size:1.1rem;font-weight:700;margin:.2rem 0">' + App.esc(vehicle.regNo) + '</p>' +
        '<p style="margin:.1rem 0">Asset Code: ' + App.esc(vehicle.assetCode) + '</p>' +
        '<p style="margin:.1rem 0;text-transform:capitalize">' + App.esc(vehicle.type) + (vehicle.ambCategory ? ' · ' + App.esc(vehicle.ambCategory) : '') + '</p>' +
        '</div></div>';
      panel.appendChild(wrap);
      var printBtn = App.el('<button class="btn small" style="margin-top:.8rem">Print Label</button>');
      printBtn.addEventListener('click', function () { window.print(); });
      panel.appendChild(printBtn);
      panel.appendChild(App.el('<p class="text-muted" style="margin-top:.4rem;font-size:.8rem">Scanning this code opens this vehicle\'s detail page directly.</p>'));
    }

    paint();
  }

  // ================================================================
  App.registerModule({
    id: 'vehicles',
    title: 'Fleet Register',
    order: 2,
    roles: ['Transport Manager','Ambulance Coordinator','Maintenance Team','Finance User','Management Viewer'],
    render: function (container, params) {
      var sub = params && params[0];
      if (!sub) return renderVehicleList(container);
      if (sub === 'drivers') return renderDriverList(container);
      if (sub === 'vendors') return renderVendorList(container);
      return renderVehicleDetail(container, sub, params[1]);
    },
  });
})();
