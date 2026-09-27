(function () {
  const TRIP_STATUSES = ['requested', 'approved', 'assigned', 'started', 'completed', 'cancelled', 'rejected'];
  const SOURCES = ['department', 'emergency', 'patient transfer', 'staff transport', 'utility', 'other'];
  const PRIORITIES = ['routine', 'urgent', 'emergency'];
  const CASE_TYPES = ['emergency', 'inter-facility transfer', 'discharge', 'event standby', 'other'];
  const CONDITIONS = ['stable', 'critical', 'deceased', 'other'];
  const BLOCKED_VEHICLE_STATUSES = ['restricted use', 'under maintenance', 'off road', 'retired'];
  const CHECKLIST_ITEMS = [
    'Vehicle clean',
    'Fuel above minimum threshold',
    'Oxygen cylinders available and adequate',
    'Stretcher functional',
    'Suction functional',
    'Monitor/defibrillator available',
    'First-aid kit available',
    'Emergency drugs kit checked',
    'Siren and lights functional',
    'Communication device functional',
    'PPE available',
    'Biomedical waste bag available',
    'Fire extinguisher valid',
  ];

  function today() { return new Date().toISOString().slice(0, 10); }
  function nowLocal() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }
  function minutesBetween(a, b) {
    if (!a || !b) return null;
    const x = new Date(a), y = new Date(b);
    if (isNaN(x) || isNaN(y)) return null;
    return Math.max(0, Math.round((y - x) / 60000));
  }
  function esc(s) { return App.esc(s == null ? '' : s); }
  function statusBadge(s) { return App.badge(s || 'requested'); }
  function vehicleLink(id) {
    if (!id) return '—';
    return '<a class="rowlink" href="#/vehicles/' + esc(id) + '">' + esc(App.vehicleName(id)) + '</a>';
  }
  function optionRows(rows, labeler) {
    return rows.map(r => ({ value: r.id, label: labeler ? labeler(r) : r.name }));
  }
  function activeWindow(t) {
    const start = t.startAt || t.requestedAt;
    const end = t.endAt || '9999-12-31T23:59';
    return { start, end };
  }
  function overlaps(aStart, aEnd, bStart, bEnd) {
    if (!aStart || !bStart) return false;
    const ae = aEnd || '9999-12-31T23:59';
    const be = bEnd || '9999-12-31T23:59';
    return aStart < be && bStart < ae;
  }
  function findOverlaps(kind, id, startAt, endAt, excludeId) {
    if (!id || !startAt) return [];
    return DB.list('trips', t => {
      if (t.id === excludeId || ['completed', 'cancelled', 'rejected'].includes(t.status)) return false;
      if (t[kind] !== id) return false;
      const w = activeWindow(t);
      return overlaps(startAt, endAt, w.start, w.end);
    });
  }
  function latestReadiness(vehicleId, date) {
    const checks = DB.list('readinessChecks', r => r.vehicleId === vehicleId && (!date || r.date <= date))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
    return checks[0] || null;
  }
  function hasCriticalFailure(check) {
    if (!check || check.result !== 'fail') return false;
    const critical = DB.getSettings().criticalChecklistItems || [];
    return (check.failedItems || []).some(i => critical.includes(i));
  }
  function vehicleDocsCompliant(vehicleId) {
    if (window.Compliance && typeof Compliance.isVehicleCompliant === 'function') return Compliance.isVehicleCompliant(vehicleId);
    const critical = ['Insurance', 'Fitness certificate', 'Permit'];
    return !DB.list('documents', d => d.vehicleId === vehicleId && critical.includes(d.docType))
      .some(d => App.docStatus(d.expiryDate).cls === 'expired');
  }
  function driverDocsCompliant(driverId) {
    if (!driverId) return true;
    if (window.Compliance && typeof Compliance.isDriverCompliant === 'function') return Compliance.isDriverCompliant(driverId);
    const docs = DB.list('documents', d => d.driverId === driverId && d.docType === 'Driver license');
    return !docs.some(d => App.docStatus(d.expiryDate).cls === 'expired');
  }
  function dispatchBlocks(vehicleId, driverId, startAt, endAt, excludeId) {
    const blocks = [];
    const settings = DB.getSettings();
    const v = DB.get('vehicles', vehicleId);
    if (!v) blocks.push('Assigned vehicle is required.');
    if (v && BLOCKED_VEHICLE_STATUSES.includes(v.status)) blocks.push('Vehicle status is ' + v.status + '.');
    if (v && v.type === 'ambulance') {
      const dispatchDate = (startAt || today()).slice(0, 10);
      const check = latestReadiness(vehicleId, dispatchDate);
      if (!check || check.date !== dispatchDate) blocks.push('Ambulance has no readiness checklist for dispatch date.');
      else if (hasCriticalFailure(check)) blocks.push('Ambulance has failed critical readiness items.');
      else if (!FleetRules.readinessPassesForDate(check, dispatchDate)) blocks.push('Ambulance readiness checklist is not passing for dispatch date.');
    }
    if (settings.blockNonCompliantVehicles && vehicleId && !vehicleDocsCompliant(vehicleId)) blocks.push('Vehicle has expired critical compliance document.');
    if (settings.blockNonCompliantDrivers && driverId && !driverDocsCompliant(driverId)) blocks.push('Driver has expired license compliance.');
    findOverlaps('vehicleId', vehicleId, startAt, endAt, excludeId).forEach(t => blocks.push('Vehicle overlaps with ' + t.tripNo + '.'));
    findOverlaps('driverId', driverId, startAt, endAt, excludeId).forEach(t => blocks.push('Driver overlaps with ' + t.tripNo + '.'));
    return blocks;
  }
  function requireOverride(blocks) {
    if (!blocks.length) return false;
    if (App.can('override')) return true;
    App.toast(blocks.join(' '), true);
    return null;
  }
  async function reconcileVehicleStatus(vehicleId, preferredStatus) {
    const vehicle = DB.get('vehicles', vehicleId);
    if (!vehicle) return;
    const status = FleetRules.reconciledVehicleStatus(
      vehicle,
      DB.list('trips', t => t.vehicleId === vehicleId),
      DB.list('breakdowns', b => b.vehicleId === vehicleId),
      preferredStatus
    );
    if (status && status !== vehicle.status) await DB.update('vehicles', vehicleId, { status });
  }
  function computeAmbulance(raw) {
    if (!raw) return null;
    const a = Object.assign({}, raw);
    a.responseMins = minutesBetween(a.callReceivedAt, a.arrivePickupAt);
    a.transportMins = minutesBetween(a.departPickupAt, a.arriveDestAt);
    return a;
  }
  function tripFields(values) {
    const vehicles = DB.list('vehicles').filter(v => v.status !== 'retired');
    const drivers = DB.list('drivers', d => d.active !== false);
    return App.form([
      { name: 'source', label: 'Source', type: 'select', options: SOURCES, required: true },
      { name: 'requestingDept', label: 'Requesting department', required: true },
      { name: 'requestedBy', label: 'Requested by', required: true },
      { name: 'requestedAt', label: 'Requested at', type: 'datetime-local', required: true, value: nowLocal() },
      { name: 'pickup', label: 'Pickup', required: true },
      { name: 'drop', label: 'Drop', required: true },
      { name: 'priority', label: 'Priority', type: 'select', options: PRIORITIES, required: true },
      { name: 'vehicleId', label: 'Vehicle', type: 'select', options: optionRows(vehicles, v => v.regNo + ' (' + v.assetCode + ')') },
      { name: 'driverId', label: 'Driver', type: 'select', options: optionRows(drivers, d => d.name + ' (' + d.driverId + ')') },
      { name: 'ambulanceStaff', label: 'Ambulance staff' },
      { name: 'patientRef', label: 'Patient name / ID' },
      { name: 'attendant', label: 'Attendant / nurse / paramedic' },
      { name: 'purpose', label: 'Purpose', type: 'textarea', full: true },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true },
    ], values || {});
  }
  function ambulanceFields(values) {
    const a = values || {};
    return App.form([
      { name: 'callReceivedAt', label: 'Call received', type: 'datetime-local' },
      { name: 'dispatchAt', label: 'Dispatch', type: 'datetime-local' },
      { name: 'arrivePickupAt', label: 'Arrival at pickup', type: 'datetime-local' },
      { name: 'departPickupAt', label: 'Departure from pickup', type: 'datetime-local' },
      { name: 'arriveDestAt', label: 'Arrival at destination', type: 'datetime-local' },
      { name: 'handoverAt', label: 'Handover', type: 'datetime-local' },
      { name: 'caseType', label: 'Case type', type: 'select', options: CASE_TYPES },
      { name: 'patientCondition', label: 'Patient condition', type: 'select', options: CONDITIONS },
      { name: 'oxygenUsed', label: 'Oxygen used', type: 'checkbox' },
      { name: 'oxygenBefore', label: 'Oxygen before' },
      { name: 'oxygenAfter', label: 'Oxygen after' },
      { name: 'criticalEquipmentUsed', label: 'Critical equipment used' },
      { name: 'disinfectionRequired', label: 'Disinfection required', type: 'checkbox' },
      { name: 'disinfectionDone', label: 'Disinfection completed', type: 'checkbox' },
      { name: 'handoverRemarks', label: 'Handover remarks', type: 'textarea', full: true },
    ], a);
  }
  function openTripModal(existing) {
    if (!App.can('trips.manage')) return App.toast('Not authorized.', true);
    const base = tripFields(existing);
    const amb = ambulanceFields(existing && existing.ambulance);
    const body = App.el('<div></div>');
    body.appendChild(base.el);
    body.appendChild(App.el('<h3 style="margin-top:1rem">Ambulance emergency fields</h3>'));
    body.appendChild(amb.el);
    App.modal({
      title: existing ? 'Edit Trip' : 'New Trip Request',
      body,
      actions: [
        { label: 'Cancel', cls: 'ghost' },
        { label: existing ? 'Save' : 'Create', async onClick(close) {
          if (!base.validate() || !amb.validate()) return;
          const data = base.read();
          const vehicle = data.vehicleId ? DB.get('vehicles', data.vehicleId) : null;
          const ambulance = computeAmbulance(amb.read());
          const hasAmbData = Object.keys(ambulance).some(k => ambulance[k] != null && ambulance[k] !== false);
          data.ambulance = vehicle && vehicle.type === 'ambulance' || hasAmbData ? ambulance : null;
          if (data.vehicleId) {
            const blocks = dispatchBlocks(data.vehicleId, data.driverId, data.requestedAt, null, existing && existing.id);
            const override = requireOverride(blocks);
            if (override === null) return;
            if (override) data.overrideReason = 'Override by ' + App.currentUser() + ': ' + blocks.join(' ');
          }
          try {
            if (existing) await DB.update('trips', existing.id, data);
            else {
              const tripNo = await DB.nextNumber('trip', 'TR');
              await DB.insert('trips', Object.assign(data, { tripNo, status: 'requested' }));
            }
            close(); App.toast('Trip saved.'); renderLast();
          } catch (error) { App.toast(error.message, true); }
        } },
      ],
    });
  }
  function transitionTrip(trip, action) {
    if (!App.can(action === 'start' || action === 'complete' ? 'trips.drive' : 'trips.manage')) return App.toast('Not authorized.', true);
    let form;
    const fields = [];
    if (action === 'approve') fields.push({ name: 'notes', label: 'Approval notes', type: 'textarea', full: true });
    if (action === 'assign') {
      fields.push(
        { name: 'vehicleId', label: 'Vehicle', type: 'select', required: true, options: optionRows(DB.list('vehicles').filter(v => v.status !== 'retired'), v => v.regNo + ' (' + v.assetCode + ')') },
        { name: 'driverId', label: 'Driver', type: 'select', required: true, options: optionRows(DB.list('drivers', d => d.active !== false), d => d.name + ' (' + d.driverId + ')') },
        { name: 'ambulanceStaff', label: 'Ambulance staff' }
      );
    }
    if (action === 'start') {
      fields.push(
        { name: 'startAt', label: 'Start at', type: 'datetime-local', required: true, value: nowLocal() },
        { name: 'startOdo', label: 'Start odometer', type: 'number', min: 0, required: true }
      );
    }
    if (action === 'complete') {
      fields.push(
        { name: 'endAt', label: 'End at', type: 'datetime-local', required: true, value: nowLocal() },
        { name: 'endOdo', label: 'End odometer', type: 'number', min: 0, required: true },
        { name: 'waitingMins', label: 'Waiting minutes', type: 'number', min: 0 },
        { name: 'expenses', label: 'Toll / parking / other expense', type: 'number', min: 0 },
        { name: 'notes', label: 'Completion notes', type: 'textarea', full: true }
      );
    }
    if (action === 'cancel') fields.push({ name: 'cancelReason', label: 'Cancellation reason', type: 'textarea', required: true, full: true });
    form = App.form(fields, trip);
    App.modal({
      title: action.charAt(0).toUpperCase() + action.slice(1) + ' ' + trip.tripNo,
      body: form.el,
      actions: [
        { label: 'Cancel', cls: 'ghost' },
        { label: action.charAt(0).toUpperCase() + action.slice(1), async onClick(close) {
          if (!form.validate()) return;
          const data = form.read();
          const patch = {};
          if (action === 'approve') Object.assign(patch, { status: 'approved', notes: data.notes || trip.notes });
          if (action === 'assign') {
            const start = trip.startAt || trip.requestedAt || nowLocal();
            const blocks = dispatchBlocks(data.vehicleId, data.driverId, start, trip.endAt, trip.id);
            const override = requireOverride(blocks);
            if (override === null) return;
            Object.assign(patch, data, { status: 'assigned' });
            if (override) patch.overrideReason = 'Override by ' + App.currentUser() + ': ' + blocks.join(' ');
          }
          let startVehiclePatch = null;
          let reconcileAfter = null;
          if (action === 'start') {
            const v = DB.get('vehicles', trip.vehicleId);
            if (!v || !trip.driverId) return App.toast('Assign vehicle and driver before starting.', true);
            if (Number(data.startOdo) < Number(v.odometer || 0)) return App.toast('Start odometer cannot be below vehicle odometer.', true);
            const blocks = dispatchBlocks(trip.vehicleId, trip.driverId, data.startAt, null, trip.id);
            const override = requireOverride(blocks);
            if (override === null) return;
            Object.assign(patch, data, { status: 'started', preTripVehicleStatus: v.status });
            if (override) patch.overrideReason = 'Override by ' + App.currentUser() + ': ' + blocks.join(' ');
            startVehiclePatch = { status: 'on trip', odometer: Math.max(Number(v.odometer || 0), Number(data.startOdo || 0)) };
          }
          if (action === 'complete') {
            const startOdo = Number(trip.startOdo || 0);
            if (trip.startAt && data.endAt && data.endAt < trip.startAt) return App.toast('End time cannot be before start time.', true);
            if (Number(data.endOdo) < startOdo) return App.toast('End odometer cannot be below start odometer.', true);
            const distance = Number(data.endOdo) - startOdo;
            Object.assign(patch, data, { status: 'completed', distance });
            const v = DB.get('vehicles', trip.vehicleId);
            if (v) patch._vehicleOdometer = Math.max(Number(v.odometer || 0), Number(data.endOdo || 0));
            reconcileAfter = trip.preTripVehicleStatus || 'available';
          }
          if (action === 'cancel') {
            Object.assign(patch, { status: 'cancelled', cancelReason: data.cancelReason });
            if (trip.status === 'started') reconcileAfter = trip.preTripVehicleStatus || 'available';
          }
          const vehicleOdometer = patch._vehicleOdometer; delete patch._vehicleOdometer;
          try {
            await DB.update('trips', trip.id, patch);
            if (vehicleOdometer != null) await DB.update('vehicles', trip.vehicleId, { odometer: vehicleOdometer });
            if (startVehiclePatch) await DB.update('vehicles', trip.vehicleId, startVehiclePatch);
            if (reconcileAfter) await reconcileVehicleStatus(trip.vehicleId, reconcileAfter);
            close(); App.toast('Trip updated.'); renderLast();
          } catch (error) { App.toast(error.message, true); }
        } },
      ],
    });
  }
  function readinessModal(vehicleId) {
    if (!App.can('readiness.check')) return App.toast('Not authorized.', true);
    const vehicles = DB.list('vehicles', v => v.type === 'ambulance' && v.status !== 'retired');
    const body = App.el('<div></div>');
    const meta = App.form([
      { name: 'vehicleId', label: 'Ambulance', type: 'select', required: true, options: optionRows(vehicles, v => v.regNo + ' (' + v.assetCode + ')') },
      { name: 'date', label: 'Date', type: 'date', required: true, value: today() },
      { name: 'checkedBy', label: 'Checked by', required: true, value: App.currentUser() },
      { name: 'remarks', label: 'Remarks', type: 'textarea', full: true },
    ], { vehicleId });
    const list = App.el('<div class="checklist"></div>');
    CHECKLIST_ITEMS.forEach(item => {
      const label = App.el('<label><input type="checkbox" data-item="' + esc(item) + '" checked> ' + esc(item) + '</label>');
      list.appendChild(label);
    });
    body.appendChild(meta.el);
    body.appendChild(App.el('<h3 style="margin-top:1rem">Checklist</h3>'));
    body.appendChild(list);
    App.modal({
      title: 'Daily Ambulance Readiness',
      body,
      actions: [
        { label: 'Cancel', cls: 'ghost' },
        { label: 'Save Check', async onClick(close) {
          if (!meta.validate()) return;
          const data = meta.read();
          if (App.currentRole() === 'Driver') data.checkedByDriverId = App.identity().actorId;
          const items = {};
          list.querySelectorAll('input[type=checkbox]').forEach(i => { items[i.dataset.item] = i.checked; });
          const failedItems = Object.keys(items).filter(k => !items[k]);
          const critical = DB.getSettings().criticalChecklistItems || [];
          const criticalFailed = failedItems.filter(i => critical.includes(i));
          const result = failedItems.length ? 'fail' : 'pass';
          const existing = DB.list('readinessChecks', r => r.vehicleId === data.vehicleId && r.date === data.date)[0];
          try {
            const rec = existing
              ? await DB.update('readinessChecks', existing.id, Object.assign(data, { items, failedItems, result }))
              : await DB.insert('readinessChecks', Object.assign(data, { items, failedItems, result }));
            let breakdownCreated = false;
            if (criticalFailed.length) {
              const v = DB.get('vehicles', data.vehicleId);
              if (v) await DB.update('vehicles', v.id, { status: 'under maintenance' });
              const linkedOpenTicket = DB.list('breakdowns', b => b.readinessCheckId === rec.id && !['closed', 'cancelled'].includes(b.status))[0];
              if (!linkedOpenTicket) {
                const ticketNo = await DB.nextNumber('breakdown', 'BD');
                await DB.insert('breakdowns', {
                ticketNo,
                vehicleId: data.vehicleId,
                reportedBy: data.checkedBy,
                reportedAt: data.date + 'T' + nowLocal().slice(11, 16),
                odometer: v ? v.odometer : null,
                location: v ? v.baseLocation : null,
                issueCategory: 'Ambulance readiness failure',
                description: 'Critical readiness failure: ' + criticalFailed.join(', '),
                severity: 'high',
                safetyImpact: true,
                readinessImpact: true,
                statusImpact: 'under maintenance',
                status: 'open',
                downtimeStart: data.date + 'T' + nowLocal().slice(11, 16),
                readinessCheckId: rec.id,
                laborCost: 0,
                partsCost: 0,
                towingCost: 0,
                otherCost: 0,
                taxes: 0,
                totalCost: 0,
              });
                breakdownCreated = true;
              }
            }
            close();
            App.toast(criticalFailed.length ? (breakdownCreated ? 'Readiness failed; breakdown ticket created.' : 'Readiness failed; existing breakdown ticket retained.') : 'Readiness check saved.');
            renderLast();
          } catch (error) { App.toast(error.message, true); }
        } },
      ],
    });
  }
  let lastContainer = null, lastParams = null;
  function renderLast() { if (lastContainer) render(lastContainer, lastParams || []); }
  function render(container, params) {
    lastContainer = container; lastParams = params;
    const tab = params[0] || 'trips';
    container.innerHTML = '<div class="tabs"><button data-tab="trips">Trips</button><button data-tab="readiness">Ambulance Readiness</button></div><div id="trips-body"></div>';
    container.querySelectorAll('.tabs button').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
      b.addEventListener('click', () => { location.hash = '#/trips/' + b.dataset.tab; });
    });
    if (tab === 'readiness') renderReadiness(container.querySelector('#trips-body'));
    else renderTrips(container.querySelector('#trips-body'));
  }
  function renderTrips(root) {
    const rows = DB.list('trips').sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)));
    const canManage = App.can('trips.manage');
    root.innerHTML = '<div class="card" style="margin-bottom:1rem"><div style="display:flex;gap:.6rem;justify-content:space-between;align-items:center;flex-wrap:wrap"><h3>Trip Register</h3><div><button class="btn" id="new-trip">New Trip</button> <button class="btn secondary" id="export-trips">Export CSV</button></div></div></div>';
    root.querySelector('#new-trip').disabled = !canManage;
    root.querySelector('#new-trip').addEventListener('click', () => openTripModal());
    root.querySelector('#export-trips').addEventListener('click', () => App.exportCSV('trips.csv',
      ['Trip No','Status','Source','Requested At','Pickup','Drop','Vehicle','Driver','Start','End','Distance'],
      rows.map(t => [t.tripNo, t.status, t.source, t.requestedAt, t.pickup, t.drop, App.vehicleName(t.vehicleId), App.driverName(t.driverId), t.startAt, t.endAt, t.distance])));
    root.appendChild(App.table({
      rows,
      empty: 'No trips recorded.',
      columns: [
        { key: 'tripNo', label: 'Trip', render: t => '<strong>' + esc(t.tripNo) + '</strong><br>' + statusBadge(t.status) },
        { key: 'request', label: 'Request', render: t => esc(t.source) + '<br><span class="text-muted">' + esc(App.fmtDateTime(t.requestedAt)) + '</span>' },
        { key: 'route', label: 'Route', render: t => esc(t.pickup) + ' → ' + esc(t.drop) + '<br><span class="text-muted">' + esc(t.priority || '') + '</span>' },
        { key: 'vehicleId', label: 'Vehicle', render: t => vehicleLink(t.vehicleId) + '<br><span class="text-muted">' + esc(App.driverName(t.driverId)) + '</span>' },
        { key: 'times', label: 'Timing', render: t => esc(App.fmtDateTime(t.startAt)) + '<br>' + esc(App.fmtDateTime(t.endAt)) },
        { key: 'odo', label: 'Odometer', num: true, render: t => esc(t.startOdo == null ? '—' : t.startOdo) + ' / ' + esc(t.endOdo == null ? '—' : t.endOdo) + '<br><span class="text-muted">' + esc(t.distance == null ? '—' : t.distance + ' km') + '</span>' },
        { key: 'amb', label: 'Ambulance', render: t => t.ambulance ? 'Response: ' + esc(t.ambulance.responseMins == null ? '—' : t.ambulance.responseMins + ' min') + '<br>Transport: ' + esc(t.ambulance.transportMins == null ? '—' : t.ambulance.transportMins + ' min') : '—' },
        { key: 'actions', label: 'Actions', render: t => actionButtons(t) },
      ],
    }));
    root.querySelectorAll('[data-action]').forEach(b => {
      b.addEventListener('click', () => {
        const t = DB.get('trips', b.dataset.id);
        if (!t) return;
        if (b.dataset.action === 'edit') openTripModal(t);
        else transitionTrip(t, b.dataset.action);
      });
    });
  }
  function actionButtons(t) {
    const buttons = [];
    const ownDriverTrip = App.currentRole() !== 'Driver' || (App.identity().actorId && t.driverId === App.identity().actorId);
    if (App.can('trips.manage')) buttons.push('<button class="btn small ghost" data-action="edit" data-id="' + esc(t.id) + '">Edit</button>');
    if (App.can('trips.manage') && t.status === 'requested') buttons.push('<button class="btn small" data-action="approve" data-id="' + esc(t.id) + '">Approve</button>');
    if (App.can('trips.manage') && ['requested', 'approved'].includes(t.status)) buttons.push('<button class="btn small" data-action="assign" data-id="' + esc(t.id) + '">Assign</button>');
    if (App.can('trips.drive') && ownDriverTrip && ['assigned', 'approved'].includes(t.status)) buttons.push('<button class="btn small" data-action="start" data-id="' + esc(t.id) + '">Start</button>');
    if (App.can('trips.drive') && ownDriverTrip && t.status === 'started') buttons.push('<button class="btn small" data-action="complete" data-id="' + esc(t.id) + '">Complete</button>');
    if (App.can('trips.manage') && !['completed', 'cancelled', 'rejected'].includes(t.status)) buttons.push('<button class="btn small danger" data-action="cancel" data-id="' + esc(t.id) + '">Cancel</button>');
    return buttons.join(' ') || '—';
  }
  function renderReadiness(root) {
    const checks = DB.list('readinessChecks').sort((a, b) => String(b.date).localeCompare(String(a.date)));
    root.innerHTML = '<div class="grid cols-3" style="margin-bottom:1rem">' +
      DB.list('vehicles', v => v.type === 'ambulance').map(v => {
        const c = latestReadiness(v.id, today());
        const cls = c && c.result === 'pass' ? 'ok' : 'danger';
        return '<div class="card stat ' + cls + '"><div class="stat-value">' + esc(v.callSign || v.assetCode) + '</div><div class="stat-label">' + esc(v.regNo) + ' · ' + statusBadge(v.status) + '<br>Readiness: ' + (c ? statusBadge(c.result) : App.badge('missing', 'danger')) + '</div><button class="btn small" data-check="' + esc(v.id) + '" style="margin-top:.6rem">Checklist</button></div>';
      }).join('') + '</div><div class="card" style="margin-bottom:1rem"><h3>Daily Readiness Checks</h3></div>';
    root.querySelectorAll('[data-check]').forEach(b => {
      b.disabled = !App.can('readiness.check');
      b.addEventListener('click', () => readinessModal(b.dataset.check));
    });
    root.appendChild(App.table({
      rows: checks,
      empty: 'No readiness checks recorded.',
      columns: [
        { key: 'date', label: 'Date', render: r => esc(App.fmtDate(r.date)) },
        { key: 'vehicleId', label: 'Ambulance', render: r => vehicleLink(r.vehicleId) },
        { key: 'checkedBy', label: 'Checked by' },
        { key: 'result', label: 'Result', render: r => statusBadge(r.result) },
        { key: 'failedItems', label: 'Failed items', render: r => esc((r.failedItems || []).join(', ') || '—') },
        { key: 'remarks', label: 'Remarks' },
      ],
    }));
  }

  App.registerModule({ id: 'trips', title: 'Trips & Ambulance', order: 3,
    roles: ['Transport Manager','Ambulance Coordinator','Driver','Management Viewer'], render });
})();
