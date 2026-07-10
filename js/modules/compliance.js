(function () {
  const DOC_TYPES = [
    'Registration certificate',
    'Insurance',
    'Fitness certificate',
    'Pollution certificate',
    'Road tax',
    'Permit',
    'Driver license',
    'Driver badge',
    'Ambulance certification',
    'Medical equipment calibration',
    'Oxygen cylinder hydrotest',
    'Fire extinguisher validity',
    'Rental/lease agreement',
    'Service contract'
  ];
  const CRITICAL_VEHICLE_DOCS = ['Insurance', 'Fitness certificate', 'Permit'];
  const CRITICAL_DRIVER_DOCS = ['Driver license'];
  const BUCKETS = [
    { key: '90', label: '61-90 days', min: 61, max: 90 },
    { key: '60', label: '31-60 days', min: 31, max: 60 },
    { key: '30', label: '8-30 days', min: 8, max: 30 },
    { key: '7', label: '1-7 days', min: 1, max: 7 },
    { key: '0', label: 'Due today', min: 0, max: 0 },
    { key: 'overdue', label: 'Overdue', overdue: true }
  ];

  let state = { tab: 'register', owner: '', status: '', query: '' };

  function esc(v) { return App.esc(v == null || v === '' ? '—' : v); }
  function docs() { return DB.list('documents').sort((a, b) => String(a.expiryDate || '').localeCompare(String(b.expiryDate || ''))); }
  function vehicles() { return DB.list('vehicles').sort((a, b) => String(a.assetCode).localeCompare(String(b.assetCode))); }
  function drivers() { return DB.list('drivers').sort((a, b) => String(a.name).localeCompare(String(b.name))); }
  function ownerType(d) { return d.driverId ? 'driver' : 'vehicle'; }
  function ownerLabel(d) { return d.driverId ? App.driverName(d.driverId) : App.vehicleName(d.vehicleId); }
  function ownerLink(d) {
    if (d.vehicleId) return '<a class="rowlink" href="#/vehicles/' + App.esc(d.vehicleId) + '">' + App.esc(App.vehicleName(d.vehicleId)) + '</a>';
    return App.esc(App.driverName(d.driverId));
  }
  function docStatus(d) {
    if (d.status === 'renewed' || d.status === 'not applicable') return { label: d.status, cls: d.status === 'renewed' ? 'valid' : 'muted' };
    return App.docStatus(d.expiryDate);
  }
  function daysText(expiry) {
    const days = App.daysUntil(expiry);
    if (days == null) return '—';
    if (days < 0) return Math.abs(days) + ' days overdue';
    if (days === 0) return 'Due today';
    return days + ' days';
  }
  function isExpired(d) { return App.daysUntil(d.expiryDate) < 0 && d.status !== 'renewed' && d.status !== 'not applicable'; }
  function hasExpiredCritical(ownerKey, ownerId, criticalTypes) {
    return DB.list('documents', d => d[ownerKey] === ownerId)
      .some(d => criticalTypes.includes(d.docType) && isExpired(d));
  }
  function isVehicleCompliant(id) { return !hasExpiredCritical('vehicleId', id, CRITICAL_VEHICLE_DOCS); }
  function isDriverCompliant(id) {
    const driver = DB.get('drivers', id);
    if (driver && App.daysUntil(driver.licenseExpiry) < 0) return false;
    return !hasExpiredCritical('driverId', id, CRITICAL_DRIVER_DOCS);
  }
  function syncComplianceFlags() {
    vehicles().forEach(v => {
      const compliant = isVehicleCompliant(v.id);
      if (v.complianceStatus !== (compliant ? 'compliant' : 'non-compliant')) {
        DB.update('vehicles', v.id, { complianceStatus: compliant ? 'compliant' : 'non-compliant' });
      }
    });
    drivers().forEach(d => {
      const compliant = isDriverCompliant(d.id);
      if (d.complianceStatus !== (compliant ? 'compliant' : 'non-compliant')) {
        DB.update('drivers', d.id, { complianceStatus: compliant ? 'compliant' : 'non-compliant' });
      }
    });
  }
  function currentRows() {
    const q = String(state.query || '').trim().toLowerCase();
    return docs().filter(d => {
      const s = docStatus(d).label;
      if (state.owner && ownerType(d) !== state.owner) return false;
      if (state.status && s !== state.status) return false;
      if (!q) return true;
      return [d.docType, d.docNo, d.authority, ownerLabel(d), d.remarks].some(v => String(v || '').toLowerCase().includes(q));
    });
  }
  function summary() {
    const all = docs();
    const expired = all.filter(d => docStatus(d).label === 'expired').length;
    const expiring = all.filter(d => {
      const days = App.daysUntil(d.expiryDate);
      return days != null && days >= 0 && days <= 90;
    }).length;
    return { total: all.length, expired, expiring, vehNC: vehicles().filter(v => !isVehicleCompliant(v.id)).length, drvNC: drivers().filter(d => !isDriverCompliant(d.id)).length };
  }
  function render(container) {
    syncComplianceFlags();
    const s = summary();
    container.innerHTML = '<div class="page-title"><div><h2>Compliance</h2><p class="text-muted">Document register, expiry reminders, and assignment compliance checks.</p></div><div class="js-actions"></div></div>';
    const actions = container.querySelector('.js-actions');
    actions.appendChild(button('Export CSV', 'secondary', exportRegister));
    if (App.can('compliance.manage')) actions.appendChild(button('Add Document', '', () => openForm(null, () => render(container))));
    container.appendChild(App.el('<div class="grid cols-4 mb-1">' +
      stat(s.total, 'Documents tracked', '') +
      stat(s.expiring, 'Expiring within 90 days', 'warn') +
      stat(s.expired, 'Expired documents', 'danger') +
      stat(s.vehNC + s.drvNC, 'Non-compliant owners', s.vehNC + s.drvNC ? 'danger' : 'ok') +
      '</div>'));
    container.appendChild(tabs(container));
    if (state.tab === 'reminders') renderReminders(container);
    else if (state.tab === 'licenses') renderLicenses(container);
    else renderRegister(container);
  }
  function stat(value, label, cls) {
    return '<div class="card stat ' + cls + '"><div class="stat-value">' + App.esc(value) + '</div><div class="stat-label">' + App.esc(label) + '</div></div>';
  }
  function button(label, cls, fn) {
    const b = App.el('<button class="btn ' + (cls || '') + '">' + App.esc(label) + '</button>');
    b.addEventListener('click', fn);
    return b;
  }
  function tabs(container) {
    const el = App.el('<div class="tabs"></div>');
    [['register', 'Document Register'], ['reminders', 'Reminders'], ['licenses', 'Driver Licenses']].forEach(t => {
      const b = App.el('<button class="' + (state.tab === t[0] ? 'active' : '') + '">' + App.esc(t[1]) + '</button>');
      b.addEventListener('click', () => { state.tab = t[0]; render(container); });
      el.appendChild(b);
    });
    return el;
  }
  function renderRegister(container) {
    const filters = App.form([
      { name: 'owner', label: 'Owner', type: 'select', options: [{ value: 'vehicle', label: 'Vehicle documents' }, { value: 'driver', label: 'Driver documents' }] },
      { name: 'status', label: 'Status', type: 'select', options: ['valid', 'expiring soon', 'expired', 'renewed', 'not applicable'] },
      { name: 'query', label: 'Search', type: 'text' }
    ], state);
    const bar = App.el('<div class="filter-bar"></div>');
    bar.appendChild(filters.el);
    const apply = button('Apply', 'secondary', () => { Object.assign(state, filters.read()); render(container); });
    const clear = button('Clear', 'ghost', () => { state.owner = ''; state.status = ''; state.query = ''; render(container); });
    bar.appendChild(apply); bar.appendChild(clear); container.appendChild(bar);
    const rows = currentRows();
    container.appendChild(App.table({ columns: columns(container), rows, empty: 'No compliance documents found.' }));
  }
  function columns(container) {
    const cols = [
      { key: 'docType', label: 'Document', render: d => App.esc(d.docType) + (isCritical(d) ? ' ' + App.badge('critical', 'critical') : '') },
      { key: 'owner', label: 'Vehicle / Driver', render: ownerLink },
      { key: 'docNo', label: 'Doc No.' },
      { key: 'authority', label: 'Authority' },
      { key: 'issueDate', label: 'Issue Date', render: d => App.fmtDate(d.issueDate) },
      { key: 'expiryDate', label: 'Expiry', render: d => App.fmtDate(d.expiryDate) + '<br><span class="text-muted">' + App.esc(daysText(d.expiryDate)) + '</span>' },
      { key: 'status', label: 'Status', render: d => { const s = docStatus(d); return App.badge(s.label, s.cls); } }
    ];
    if (App.can('compliance.manage')) {
      cols.push({ key: 'actions', label: 'Actions', render: d => actionButtons(d, container) });
    }
    return cols;
  }
  function actionButtons(d, container) {
    setTimeout(() => {
      const edit = document.querySelector('[data-edit-doc="' + d.id + '"]');
      const del = document.querySelector('[data-del-doc="' + d.id + '"]');
      if (edit) edit.onclick = () => openForm(d, () => render(container));
      if (del) del.onclick = () => confirmDelete(d, () => render(container));
    }, 0);
    return '<button class="btn small secondary" data-edit-doc="' + App.esc(d.id) + '">Edit</button> <button class="btn small danger" data-del-doc="' + App.esc(d.id) + '">Delete</button>';
  }
  function isCritical(d) {
    return (d.vehicleId && CRITICAL_VEHICLE_DOCS.includes(d.docType)) || (d.driverId && CRITICAL_DRIVER_DOCS.includes(d.docType));
  }
  function renderReminders(container) {
    const rows = docs().filter(d => App.daysUntil(d.expiryDate) != null && App.daysUntil(d.expiryDate) <= 90 && d.status !== 'renewed' && d.status !== 'not applicable');
    const grid = App.el('<div class="grid cols-2"></div>');
    BUCKETS.forEach(b => {
      const bucketRows = rows.filter(d => {
        const days = App.daysUntil(d.expiryDate);
        return b.overdue ? days < 0 : days >= b.min && days <= b.max;
      });
      const card = App.el('<div class="card"><h3>' + App.esc(b.label) + ' (' + bucketRows.length + ')</h3></div>');
      card.appendChild(App.table({ columns: reminderColumns(), rows: bucketRows, empty: 'No reminders in this bucket.' }));
      grid.appendChild(card);
    });
    container.appendChild(grid);
  }
  function reminderColumns() {
    return [
      { key: 'docType', label: 'Document' },
      { key: 'owner', label: 'Owner', render: ownerLink },
      { key: 'expiryDate', label: 'Expiry', render: d => App.fmtDate(d.expiryDate) },
      { key: 'days', label: 'Due', render: d => daysText(d.expiryDate) },
      { key: 'status', label: 'Status', render: d => { const s = docStatus(d); return App.badge(s.label, s.cls); } }
    ];
  }
  function renderLicenses(container) {
    const rows = drivers().map(d => {
      const licDoc = docs().filter(x => x.driverId === d.id && x.docType === 'Driver license').sort((a, b) => String(a.expiryDate || '').localeCompare(String(b.expiryDate || '')))[0];
      return Object.assign({}, d, { docExpiry: licDoc ? licDoc.expiryDate : d.licenseExpiry, docNo: licDoc ? licDoc.docNo : d.licenseNo, docStatus: licDoc ? docStatus(licDoc) : App.docStatus(d.licenseExpiry), compliant: isDriverCompliant(d.id) });
    }).sort((a, b) => String(a.docExpiry || '').localeCompare(String(b.docExpiry || '')));
    const wrap = App.el('<div></div>');
    wrap.appendChild(button('Export Driver License CSV', 'secondary', () => exportLicenses(rows)));
    wrap.appendChild(App.table({
      columns: [
        { key: 'driverId', label: 'Driver ID' },
        { key: 'name', label: 'Driver' },
        { key: 'licenseNo', label: 'License No.', render: r => esc(r.docNo || r.licenseNo) },
        { key: 'licenseClass', label: 'Class' },
        { key: 'licenseExpiry', label: 'Expiry', render: r => App.fmtDate(r.docExpiry) + '<br><span class="text-muted">' + App.esc(daysText(r.docExpiry)) + '</span>' },
        { key: 'status', label: 'Status', render: r => App.badge(r.docStatus.label, r.docStatus.cls) },
        { key: 'compliant', label: 'Compliance', render: r => r.compliant ? App.badge('compliant', 'valid') : App.badge('non-compliant', 'expired') }
      ],
      rows,
      empty: 'No drivers found.'
    }));
    container.appendChild(wrap);
  }
  function openForm(record, afterSave) {
    const vehicleOptions = vehicles().map(v => ({ value: v.id, label: v.regNo + ' (' + v.assetCode + ')' }));
    const driverOptions = drivers().map(d => ({ value: d.id, label: d.name + ' (' + d.driverId + ')' }));
    const values = Object.assign({ ownerKind: record && record.driverId ? 'driver' : 'vehicle' }, record || {});
    const form = App.form([
      { name: 'docType', label: 'Document type', type: 'select', options: DOC_TYPES, required: true },
      { name: 'ownerKind', label: 'Owner type', type: 'select', options: [{ value: 'vehicle', label: 'Vehicle' }, { value: 'driver', label: 'Driver' }], required: true },
      { name: 'vehicleId', label: 'Vehicle', type: 'select', options: vehicleOptions },
      { name: 'driverId', label: 'Driver', type: 'select', options: driverOptions },
      { name: 'docNo', label: 'Document number', type: 'text', required: true },
      { name: 'authority', label: 'Issuing authority', type: 'text' },
      { name: 'issueDate', label: 'Issue date', type: 'date' },
      { name: 'expiryDate', label: 'Expiry date', type: 'date', required: true },
      { name: 'reminderThresholds', label: 'Reminder thresholds', type: 'text', hint: 'Comma separated days, default 90,60,30,7,0' },
      { name: 'attachment', label: 'Attachment reference', type: 'text' },
      { name: 'status', label: 'Manual status', type: 'select', options: ['valid', 'expiring soon', 'expired', 'renewed', 'not applicable'] },
      { name: 'remarks', label: 'Remarks', type: 'textarea', full: true }
    ], Object.assign({}, values, { reminderThresholds: Array.isArray(values.reminderThresholds) ? values.reminderThresholds.join(',') : values.reminderThresholds }));
    const close = App.modal({
      title: record ? 'Edit Document' : 'Add Document',
      body: form.el,
      actions: [
        { label: 'Cancel', cls: 'ghost' },
        { label: 'Save', onClick: c => {
          if (!App.can('compliance.manage')) return App.toast('You do not have permission to manage compliance documents.', true);
          if (!form.validate()) return;
          const data = form.read();
          if (!data.vehicleId && !data.driverId) return App.toast('Select a vehicle or driver.', true);
          if (data.vehicleId && data.driverId) return App.toast('Select only one owner: vehicle or driver.', true);
          if (data.ownerKind === 'vehicle') data.driverId = null;
          if (data.ownerKind === 'driver') data.vehicleId = null;
          if (!data.vehicleId && !data.driverId) return App.toast('Select the matching owner for the owner type.', true);
          delete data.ownerKind;
          data.reminderThresholds = parseThresholds(data.reminderThresholds);
          data.status = docStatus(data).label;
          if (record) DB.update('documents', record.id, data);
          else DB.insert('documents', data);
          syncComplianceFlags();
          App.toast(record ? 'Document updated.' : 'Document added.');
          c(); afterSave();
        } }
      ]
    });
    const ownerSelect = form.inputs.ownerKind.input;
    const vehicleWrap = form.inputs.vehicleId.wrap;
    const driverWrap = form.inputs.driverId.wrap;
    function toggleOwner() {
      const isDriver = ownerSelect.value === 'driver';
      vehicleWrap.style.display = isDriver ? 'none' : '';
      driverWrap.style.display = isDriver ? '' : 'none';
      if (isDriver) form.inputs.vehicleId.input.value = '';
      else form.inputs.driverId.input.value = '';
    }
    ownerSelect.addEventListener('change', toggleOwner);
    toggleOwner();
    return close;
  }
  function parseThresholds(v) {
    if (!v) return (DB.getSettings().reminderThresholds || [90, 60, 30, 7, 0]);
    return String(v).split(',').map(x => Number(x.trim())).filter(x => !isNaN(x));
  }
  function confirmDelete(record, afterDelete) {
    App.modal({
      title: 'Delete Document',
      body: '<p>Delete <strong>' + App.esc(record.docType) + '</strong> for ' + App.esc(ownerLabel(record)) + '?</p>',
      actions: [
        { label: 'Cancel', cls: 'ghost' },
        { label: 'Delete', cls: 'danger', onClick: close => {
          if (!App.can('compliance.manage')) return App.toast('You do not have permission to delete compliance documents.', true);
          DB.softDelete('documents', record.id);
          syncComplianceFlags();
          App.toast('Document deleted.');
          close(); afterDelete();
        } }
      ]
    });
  }
  function exportRegister() {
    const rows = currentRows().map(d => [d.docType, ownerType(d), ownerLabel(d), d.docNo, d.authority, d.issueDate, d.expiryDate, docStatus(d).label, daysText(d.expiryDate), d.attachment, d.remarks]);
    App.exportCSV('compliance-documents.csv', ['Document type', 'Owner type', 'Owner', 'Document number', 'Authority', 'Issue date', 'Expiry date', 'Status', 'Due', 'Attachment', 'Remarks'], rows);
  }
  function exportLicenses(rows) {
    App.exportCSV('driver-license-expiry.csv', ['Driver ID', 'Driver', 'License number', 'Class', 'Expiry date', 'Status', 'Compliance'], rows.map(r => [r.driverId, r.name, r.docNo || r.licenseNo, r.licenseClass, r.docExpiry, r.docStatus.label, r.compliant ? 'compliant' : 'non-compliant']));
  }

  window.Compliance = {
    isVehicleCompliant: isVehicleCompliant,
    isDriverCompliant: isDriverCompliant
  };

  App.registerModule({ id: 'compliance', title: 'Compliance', order: 6, render: render });
}());
