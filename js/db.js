/* =============================================================
 * SSSIHMS Fleet — data layer (localStorage, prototype)
 * =============================================================
 * Collections (arrays of objects, every record gets: id, createdAt,
 * updatedAt, deleted:false — soft delete only):
 *
 *   vehicles, drivers, vendors, trips, fuelLogs, pmSchedules,
 *   pmRecords, breakdowns, documents, readinessChecks, auditLog
 *
 * API:
 *   DB.list(coll, filterFn?)        -> live-filtered copy (excludes deleted)
 *   DB.get(coll, id)                -> record or null
 *   DB.insert(coll, obj)            -> record (id assigned) + audit
 *   DB.update(coll, id, patch)      -> record + audit
 *   DB.softDelete(coll, id)         -> audit'd soft delete
 *   DB.nextNumber(key, prefix)      -> e.g. DB.nextNumber('trip','TR') => 'TR-0001'
 *   DB.audit(action, entityType, entityId, oldVal, newVal)
 *   DB.getSettings() / DB.saveSettings(patch)
 *   DB.reset()                      -> wipe and reseed demo data
 *
 * Conventions:
 *   - Dates stored as ISO strings 'YYYY-MM-DD' (datetimes 'YYYY-MM-DDTHH:mm').
 *   - Money in INR numbers; display via App.fmtINR.
 *   - Vehicle.status: available | on trip | under maintenance | off road | standby | retired
 * ============================================================= */
(function () {
  const LS_KEY = 'sssihms-fleet-v1';
  let store = null;

  const COLLECTIONS = ['vehicles','drivers','vendors','trips','fuelLogs','pmSchedules',
    'pmRecords','breakdowns','documents','readinessChecks','auditLog'];

  function todayISO(offsetDays = 0) {
    const d = new Date(); d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  function defaultSettings() {
    return {
      reminderThresholds: [90, 60, 30, 7, 0],
      fuelEfficiencyWarnPct: 20,        // % below benchmark triggers warning
      minAmbulanceFuelPct: 50,
      odometerJumpTolerance: 1000,      // km jump allowed between entries
      fuelApprovalThreshold: 10000,     // ₹
      maintenanceApprovalThreshold: 25000,
      blockNonCompliantVehicles: true,
      blockNonCompliantDrivers: true,
      duplicateBillAction: 'warn',      // warn | block
      criticalChecklistItems: ['Oxygen cylinders available and adequate','Stretcher functional',
        'Suction functional','Siren and lights functional','Fuel above minimum threshold'],
    };
  }

  function seed() {
    const s = { settings: defaultSettings(), counters: {} };
    COLLECTIONS.forEach(c => s[c] = []);
    let idc = 0;
    const nid = () => 'r' + (++idc).toString(36).padStart(6, '0');
    const stamp = o => Object.assign(o, { id: nid(), createdAt: todayISO(-90), updatedAt: todayISO(), deleted: false });

    // --- Vehicles ---
    const V = (o) => { s.vehicles.push(stamp(o)); return o; };
    V({ assetCode:'FL-AMB-01', regNo:'KA 53 G 1101', type:'ambulance', ambCategory:'ALS', make:'Force', model:'Traveller EMS', year:2022, chassisNo:'MCF23AL2201', engineNo:'F26EN2201', fuelType:'diesel', ownership:'donated', department:'Ambulance Services', baseLocation:'Main Gate Bay 1', status:'available', odometer:48250, purchaseDate:'2022-04-12', purchaseCost:3250000, vendor:'Force Motors Bangalore', seating:2, tankCapacity:70, mileageBenchmark:9, callSign:'AMB-1', emergencyPhone:'080-28411500', notes:'Primary ALS ambulance' });
    V({ assetCode:'FL-AMB-02', regNo:'KA 53 G 1102', type:'ambulance', ambCategory:'BLS', make:'Maruti Suzuki', model:'Eeco Ambulance', year:2021, chassisNo:'MSE21BL1102', engineNo:'G12EN1102', fuelType:'petrol', ownership:'owned', department:'Ambulance Services', baseLocation:'Main Gate Bay 2', status:'available', odometer:61780, purchaseDate:'2021-08-02', purchaseCost:975000, vendor:'Bimal Auto Agency', seating:2, tankCapacity:32, mileageBenchmark:14, callSign:'AMB-2', emergencyPhone:'080-28411500' });
    V({ assetCode:'FL-AMB-03', regNo:'KA 53 G 1103', type:'ambulance', ambCategory:'cardiac', make:'Force', model:'Traveller EMS', year:2023, chassisNo:'MCF23AL3303', engineNo:'F26EN3303', fuelType:'diesel', ownership:'donated', department:'Cardiology', baseLocation:'Emergency Bay', status:'under maintenance', odometer:22140, purchaseDate:'2023-06-20', purchaseCost:3650000, vendor:'Force Motors Bangalore', seating:2, tankCapacity:70, mileageBenchmark:9, callSign:'AMB-3' });
    V({ assetCode:'FL-PTV-01', regNo:'KA 53 F 2201', type:'patient transport', make:'Tata', model:'Winger', year:2020, chassisNo:'TW20PT2201', engineNo:'T22EN2201', fuelType:'diesel', ownership:'owned', department:'Transport', baseLocation:'Transport Yard', status:'available', odometer:88950, purchaseDate:'2020-02-15', purchaseCost:1450000, vendor:'Concorde Motors', seating:13, tankCapacity:60, mileageBenchmark:11 });
    V({ assetCode:'FL-STF-01', regNo:'KA 53 F 3301', type:'staff transport', make:'Ashok Leyland', model:'Lynx Smart', year:2019, chassisNo:'AL19ST3301', engineNo:'AL33EN01', fuelType:'diesel', ownership:'owned', department:'Transport', baseLocation:'Transport Yard', status:'on trip', odometer:132400, purchaseDate:'2019-05-10', purchaseCost:2280000, vendor:'Ashok Leyland Dealer', seating:32, tankCapacity:90, mileageBenchmark:6 });
    V({ assetCode:'FL-STF-02', regNo:'KA 53 F 3302', type:'staff transport', make:'Maruti Suzuki', model:'Ertiga', year:2022, chassisNo:'MSE22ST3302', engineNo:'K15EN3302', fuelType:'CNG', ownership:'owned', department:'Administration', baseLocation:'Admin Block', status:'available', odometer:34560, purchaseDate:'2022-11-25', purchaseCost:1180000, vendor:'Bimal Auto Agency', seating:7, tankCapacity:60, mileageBenchmark:20 });
    V({ assetCode:'FL-UTL-01', regNo:'KA 53 F 4401', type:'utility', make:'Tata', model:'Ace Gold', year:2018, chassisNo:'TA18UT4401', engineNo:'TA44EN01', fuelType:'diesel', ownership:'owned', department:'Stores', baseLocation:'Stores Yard', status:'available', odometer:76890, purchaseDate:'2018-09-03', purchaseCost:520000, vendor:'Concorde Motors', seating:2, loadCapacity:'750 kg', tankCapacity:30, mileageBenchmark:16 });
    V({ assetCode:'FL-UTL-02', regNo:'KA 53 F 4402', type:'goods', make:'Mahindra', model:'Bolero Pickup', year:2017, chassisNo:'MB17GD4402', engineNo:'MB44EN02', fuelType:'diesel', ownership:'owned', department:'Maintenance', baseLocation:'Maintenance Yard', status:'off road', odometer:145200, purchaseDate:'2017-03-18', purchaseCost:715000, vendor:'India Garage', seating:2, loadCapacity:'1250 kg', tankCapacity:57, mileageBenchmark:14, notes:'Gearbox issue — awaiting decision on major repair' });
    V({ assetCode:'FL-AMB-04', regNo:'KA 53 G 1104', type:'ambulance', ambCategory:'mortuary', make:'Maruti Suzuki', model:'Eeco', year:2019, chassisNo:'MSE19MT1104', engineNo:'G12EN1104', fuelType:'petrol', ownership:'owned', department:'Ambulance Services', baseLocation:'Mortuary Bay', status:'standby', odometer:41230, purchaseDate:'2019-12-01', purchaseCost:650000, vendor:'Bimal Auto Agency', seating:2, tankCapacity:32, mileageBenchmark:15, callSign:'AMB-4' });
    V({ assetCode:'FL-STF-03', regNo:'KA 05 D 9910', type:'staff transport', make:'Toyota', model:'Innova Crysta', year:2016, chassisNo:'TY16ST9910', engineNo:'TY99EN10', fuelType:'diesel', ownership:'owned', department:'Administration', baseLocation:'Admin Block', status:'retired', odometer:248900, purchaseDate:'2016-01-20', purchaseCost:1850000, vendor:'Nandi Toyota', seating:7, tankCapacity:55, mileageBenchmark:12, notes:'Retired Mar-2026; disposal pending' });

    const vid = code => s.vehicles.find(v => v.assetCode === code).id;

    // --- Drivers ---
    const D = (o) => { s.drivers.push(stamp(o)); return o; };
    D({ driverId:'DRV-01', name:'Manjunath R', mobile:'98450 11223', licenseNo:'KA5320190001234', licenseClass:'LMV, Transport', licenseExpiry:todayISO(420), employeeType:'employee', assignedVehicleId:vid('FL-AMB-01'), shift:'Day', active:true, emergencyContact:'98450 99887' });
    D({ driverId:'DRV-02', name:'Shivakumar B', mobile:'98861 22334', licenseNo:'KA5320180005678', licenseClass:'LMV, Transport', licenseExpiry:todayISO(25), employeeType:'employee', assignedVehicleId:vid('FL-AMB-02'), shift:'Night', active:true });
    D({ driverId:'DRV-03', name:'Ravi Prasad', mobile:'99001 33445', licenseNo:'KA5320200009012', licenseClass:'HMV', licenseExpiry:todayISO(700), employeeType:'employee', assignedVehicleId:vid('FL-STF-01'), shift:'Day', active:true });
    D({ driverId:'DRV-04', name:'Anand Kumar', mobile:'97411 44556', licenseNo:'KA5320170003456', licenseClass:'LMV', licenseExpiry:todayISO(-12), employeeType:'contract', assignedVehicleId:vid('FL-PTV-01'), shift:'Day', active:true, notes:'License renewal in progress' });
    D({ driverId:'DRV-05', name:'Syed Imran', mobile:'96860 55667', licenseNo:'KA5320210007890', licenseClass:'LMV, Transport', licenseExpiry:todayISO(180), employeeType:'employee', assignedVehicleId:vid('FL-AMB-03'), shift:'Rotational', active:true });
    D({ driverId:'DRV-06', name:'Krishnappa M', mobile:'95911 66778', licenseNo:'KA5320150002345', licenseClass:'LMV', licenseExpiry:todayISO(60), employeeType:'contract', assignedVehicleId:null, shift:'Day', active:true });
    D({ driverId:'DRV-07', name:'Venkatesh N', mobile:'97401 77889', licenseNo:'KA5320220004567', licenseClass:'HMV', licenseExpiry:todayISO(900), employeeType:'employee', assignedVehicleId:vid('FL-UTL-01'), shift:'Day', active:true });
    D({ driverId:'DRV-08', name:'Peter D', mobile:'98860 88990', licenseNo:'KA5320140006789', licenseClass:'LMV', licenseExpiry:todayISO(300), employeeType:'vendor', assignedVehicleId:null, shift:'Night', active:false, notes:'Contract ended May-2026' });

    // --- Vendors ---
    const VN = (o) => { s.vendors.push(stamp(o)); return o; };
    VN({ name:'Indian Oil — Whitefield Fuel Point', type:'fuel station', contactPerson:'Mr. Gopal', phone:'080-2845 1122', creditFacility:true, monthlyBilling:true, active:true });
    VN({ name:'HP Petrol Bunk — EPIP', type:'fuel station', contactPerson:'Mr. Nagesh', phone:'080-2841 3344', creditFacility:false, monthlyBilling:false, active:true });
    VN({ name:'Sri Auto Works', type:'workshop', contactPerson:'Mr. Farooq', phone:'98450 33221', address:'Hoodi, Bangalore', gst:'29ABCFS1234A1Z5', paymentTerms:'30 days', active:true });
    VN({ name:'Force Motors Service — KR Puram', type:'dealer', contactPerson:'Service Desk', phone:'080-2561 7788', gst:'29AAACF0001B1Z2', paymentTerms:'15 days', active:true });
    VN({ name:'National Insurance Co.', type:'insurance', contactPerson:'Ms. Latha', phone:'080-2222 9900', active:true });
    VN({ name:'Sai Tyre Centre', type:'workshop', contactPerson:'Mr. Ramesh', phone:'99860 44332', paymentTerms:'Cash', active:true });

    const vnid = name => s.vendors.find(v => v.name.startsWith(name)).id;
    const drid = code => s.drivers.find(d => d.driverId === code).id;

    // --- Fuel logs (recent, per vehicle, odometer ascending) ---
    const F = (o) => { s.fuelLogs.push(stamp(o)); return o; };
    F({ logNo:'FL-0001', vehicleId:vid('FL-AMB-01'), date:todayISO(-28), driverId:drid('DRV-01'), vendorId:vnid('Indian Oil'), fuelType:'diesel', qty:52, rate:92.5, amount:4810, billNo:'IO-88121', odometer:47210, tankFull:true, paymentMode:'credit', status:'verified', enteredBy:'Manjunath R', verifiedBy:'Transport Manager' });
    F({ logNo:'FL-0002', vehicleId:vid('FL-AMB-01'), date:todayISO(-12), driverId:drid('DRV-01'), vendorId:vnid('Indian Oil'), fuelType:'diesel', qty:48, rate:92.5, amount:4440, billNo:'IO-88467', odometer:47690, tankFull:true, paymentMode:'credit', status:'verified', enteredBy:'Manjunath R', verifiedBy:'Transport Manager' });
    F({ logNo:'FL-0003', vehicleId:vid('FL-AMB-01'), date:todayISO(-2), driverId:drid('DRV-01'), vendorId:vnid('Indian Oil'), fuelType:'diesel', qty:55, rate:93.1, amount:5120.5, billNo:'IO-88801', odometer:48250, tankFull:true, paymentMode:'credit', status:'submitted', enteredBy:'Manjunath R' });
    F({ logNo:'FL-0004', vehicleId:vid('FL-AMB-02'), date:todayISO(-20), driverId:drid('DRV-02'), vendorId:vnid('HP Petrol'), fuelType:'petrol', qty:28, rate:102.8, amount:2878.4, billNo:'HP-33210', odometer:60890, tankFull:true, paymentMode:'cash', status:'verified', enteredBy:'Shivakumar B', verifiedBy:'Transport Manager' });
    F({ logNo:'FL-0005', vehicleId:vid('FL-AMB-02'), date:todayISO(-5), driverId:drid('DRV-02'), vendorId:vnid('HP Petrol'), fuelType:'petrol', qty:26, rate:102.8, amount:2672.8, billNo:'HP-33544', odometer:61780, tankFull:true, paymentMode:'cash', status:'submitted', enteredBy:'Shivakumar B' });
    F({ logNo:'FL-0006', vehicleId:vid('FL-STF-01'), date:todayISO(-15), driverId:drid('DRV-03'), vendorId:vnid('Indian Oil'), fuelType:'diesel', qty:80, rate:92.5, amount:7400, billNo:'IO-88555', odometer:131400, tankFull:true, paymentMode:'credit', status:'verified', enteredBy:'Ravi Prasad', verifiedBy:'Transport Manager' });
    F({ logNo:'FL-0007', vehicleId:vid('FL-STF-01'), date:todayISO(-3), driverId:drid('DRV-03'), vendorId:vnid('Indian Oil'), fuelType:'diesel', qty:85, rate:93.1, amount:7913.5, billNo:'IO-88790', odometer:132250, tankFull:true, paymentMode:'credit', status:'submitted', enteredBy:'Ravi Prasad' });
    F({ logNo:'FL-0008', vehicleId:vid('FL-PTV-01'), date:todayISO(-8), driverId:drid('DRV-04'), vendorId:vnid('Indian Oil'), fuelType:'diesel', qty:45, rate:93.1, amount:4189.5, billNo:'IO-88650', odometer:88700, tankFull:false, paymentMode:'credit', status:'verified', enteredBy:'Anand Kumar', verifiedBy:'Transport Manager' });
    s.counters.fuel = 8;

    // --- PM schedules ---
    const P = (o) => { s.pmSchedules.push(stamp(o)); return o; };
    P({ vehicleId:vid('FL-AMB-01'), maintenanceType:'Preventive maintenance', freqDays:90, freqKm:5000, lastServiceDate:todayISO(-75), lastServiceOdo:44800, nextDueDate:todayISO(15), nextDueOdo:49800, assignedTo:'Force Motors Service — KR Puram', estCost:8500, priority:'high', status:'active' });
    P({ vehicleId:vid('FL-AMB-02'), maintenanceType:'Preventive maintenance', freqDays:90, freqKm:5000, lastServiceDate:todayISO(-95), lastServiceOdo:57500, nextDueDate:todayISO(-5), nextDueOdo:62500, assignedTo:'Sri Auto Works', estCost:5500, priority:'high', status:'active' });
    P({ vehicleId:vid('FL-STF-01'), maintenanceType:'Preventive maintenance', freqDays:120, freqKm:10000, lastServiceDate:todayISO(-100), lastServiceOdo:124500, nextDueDate:todayISO(20), nextDueOdo:134500, assignedTo:'Sri Auto Works', estCost:12000, priority:'medium', status:'active' });
    P({ vehicleId:vid('FL-PTV-01'), maintenanceType:'Oil and lubricant', freqDays:180, freqKm:10000, lastServiceDate:todayISO(-160), lastServiceOdo:80500, nextDueDate:todayISO(20), nextDueOdo:90500, assignedTo:'Sri Auto Works', estCost:4500, priority:'medium', status:'active' });
    P({ vehicleId:vid('FL-UTL-01'), maintenanceType:'Preventive maintenance', freqDays:180, freqKm:10000, lastServiceDate:todayISO(-200), lastServiceOdo:68000, nextDueDate:todayISO(-20), nextDueOdo:78000, assignedTo:'Sri Auto Works', estCost:4000, priority:'low', status:'active' });

    // --- PM records (history) ---
    const PR = (o) => { s.pmRecords.push(stamp(o)); return o; };
    PR({ vehicleId:vid('FL-AMB-01'), scheduleRef:s.pmSchedules[0].id, serviceDate:todayISO(-75), serviceOdo:44800, vendorId:vnid('Force Motors'), workPerformed:'20k service — oil, filters, brake check, coolant', partsCost:5200, laborCost:2400, otherCost:0, taxes:1368, discount:0, totalCost:8968, invoiceNo:'FMS-20481', downtimeStart:todayISO(-75), downtimeEnd:todayISO(-74), fitness:'fit', remarks:'' });
    PR({ vehicleId:vid('FL-AMB-02'), scheduleRef:s.pmSchedules[1].id, serviceDate:todayISO(-95), serviceOdo:57500, vendorId:vnid('Sri Auto'), workPerformed:'General service, AC gas top-up', partsCost:2800, laborCost:1500, otherCost:0, taxes:774, discount:0, totalCost:5074, invoiceNo:'SAW-1122', downtimeStart:todayISO(-95), downtimeEnd:todayISO(-95), fitness:'fit', remarks:'' });
    PR({ vehicleId:vid('FL-STF-01'), scheduleRef:s.pmSchedules[2].id, serviceDate:todayISO(-100), serviceOdo:124500, vendorId:vnid('Sri Auto'), workPerformed:'Major service, clutch overhaul', partsCost:14500, laborCost:6000, otherCost:800, taxes:3834, discount:500, totalCost:24634, invoiceNo:'SAW-0988', downtimeStart:todayISO(-101), downtimeEnd:todayISO(-98), fitness:'fit with observation', remarks:'Rear suspension bushes to be watched' });

    // --- Breakdowns ---
    const B = (o) => { s.breakdowns.push(stamp(o)); return o; };
    B({ ticketNo:'BD-0001', vehicleId:vid('FL-AMB-03'), reportedBy:'Syed Imran', reportedAt:todayISO(-4)+'T09:20', odometer:22140, location:'Emergency Bay', issueCategory:'Electrical repair', description:'Siren and beacon not working; battery draining overnight', severity:'high', safetyImpact:true, readinessImpact:true, statusImpact:'under maintenance', assignedVendorId:vnid('Sri Auto'), status:'in progress', downtimeStart:todayISO(-4)+'T09:20', laborCost:0, partsCost:0, towingCost:0, otherCost:0, taxes:0, totalCost:0 });
    B({ ticketNo:'BD-0002', vehicleId:vid('FL-UTL-02'), reportedBy:'Venkatesh N', reportedAt:todayISO(-30)+'T14:00', odometer:145200, location:'Maintenance Yard', issueCategory:'Breakdown repair', description:'Gearbox jammed in 2nd gear', severity:'critical', safetyImpact:true, readinessImpact:false, statusImpact:'off road', assignedVendorId:vnid('Sri Auto'), status:'waiting for approval', downtimeStart:todayISO(-30)+'T14:00', laborCost:8000, partsCost:38500, towingCost:1500, otherCost:0, taxes:8640, totalCost:56640, notes:'Estimate above approval threshold — pending management decision' });
    B({ ticketNo:'BD-0003', vehicleId:vid('FL-PTV-01'), reportedBy:'Anand Kumar', reportedAt:todayISO(-18)+'T08:10', odometer:88400, location:'Transport Yard', issueCategory:'Tyre replacement', description:'Front-left tyre sidewall bulge', severity:'medium', safetyImpact:true, readinessImpact:false, statusImpact:'available', assignedVendorId:vnid('Sai Tyre'), status:'closed', rootCause:'Tyre wear beyond limit', correctiveAction:'Two front tyres replaced, alignment done', laborCost:400, partsCost:11200, towingCost:0, otherCost:300, taxes:2142, totalCost:14042, invoiceNo:'STC-2210', downtimeStart:todayISO(-18)+'T08:10', downtimeEnd:todayISO(-18)+'T13:30', closureNotes:'Vehicle fit for service' });
    s.counters.breakdown = 3;

    // --- Compliance documents ---
    const DOC = (o) => { s.documents.push(stamp(o)); return o; };
    DOC({ docType:'Insurance', vehicleId:vid('FL-AMB-01'), docNo:'NIC-2026-88121', authority:'National Insurance Co.', issueDate:todayISO(-300), expiryDate:todayISO(65), status:'valid' });
    DOC({ docType:'Insurance', vehicleId:vid('FL-AMB-02'), docNo:'NIC-2026-88240', authority:'National Insurance Co.', issueDate:todayISO(-340), expiryDate:todayISO(25), status:'expiring soon' });
    DOC({ docType:'Insurance', vehicleId:vid('FL-STF-01'), docNo:'NIC-2025-71034', authority:'National Insurance Co.', issueDate:todayISO(-400), expiryDate:todayISO(-35), status:'expired' });
    DOC({ docType:'Fitness certificate', vehicleId:vid('FL-AMB-01'), docNo:'FC-KA53-44121', authority:'RTO KR Puram', issueDate:todayISO(-330), expiryDate:todayISO(35), status:'valid' });
    DOC({ docType:'Fitness certificate', vehicleId:vid('FL-PTV-01'), docNo:'FC-KA53-40988', authority:'RTO KR Puram', issueDate:todayISO(-360), expiryDate:todayISO(5), status:'expiring soon' });
    DOC({ docType:'Pollution certificate', vehicleId:vid('FL-AMB-02'), docNo:'PUC-99120', authority:'Authorized PUC Centre', issueDate:todayISO(-170), expiryDate:todayISO(10), status:'expiring soon' });
    DOC({ docType:'Pollution certificate', vehicleId:vid('FL-UTL-01'), docNo:'PUC-97731', authority:'Authorized PUC Centre', issueDate:todayISO(-200), expiryDate:todayISO(-20), status:'expired' });
    DOC({ docType:'Permit', vehicleId:vid('FL-AMB-01'), docNo:'PRM-AMB-2201', authority:'Karnataka Transport Dept', issueDate:todayISO(-700), expiryDate:todayISO(85), status:'valid' });
    DOC({ docType:'Road tax', vehicleId:vid('FL-STF-01'), docNo:'TAX-33019', authority:'RTO KR Puram', issueDate:todayISO(-330), expiryDate:todayISO(45), status:'valid' });
    DOC({ docType:'Oxygen cylinder hydrotest', vehicleId:vid('FL-AMB-01'), docNo:'OXY-HT-1189', authority:'PESO Approved Tester', issueDate:todayISO(-800), expiryDate:todayISO(120), status:'valid' });
    DOC({ docType:'Fire extinguisher validity', vehicleId:vid('FL-AMB-02'), docNo:'FE-2317', authority:'AMC Vendor', issueDate:todayISO(-350), expiryDate:todayISO(15), status:'expiring soon' });
    DOC({ docType:'Driver license', driverId:drid('DRV-04'), docNo:'KA5320170003456', authority:'RTO', issueDate:todayISO(-1800), expiryDate:todayISO(-12), status:'expired' });
    DOC({ docType:'Driver license', driverId:drid('DRV-02'), docNo:'KA5320180005678', authority:'RTO', issueDate:todayISO(-1500), expiryDate:todayISO(25), status:'expiring soon' });

    // --- Trips ---
    const T = (o) => { s.trips.push(stamp(o)); return o; };
    T({ tripNo:'TR-0001', source:'patient transfer', requestingDept:'Cardiology', requestedBy:'Ward 3 Sister-in-charge', requestedAt:todayISO(-1)+'T08:00', pickup:'SSSIHMS Whitefield', drop:'NIMHANS, Bangalore', priority:'urgent', vehicleId:vid('FL-AMB-01'), driverId:drid('DRV-01'), status:'completed', startAt:todayISO(-1)+'T08:40', startOdo:48180, endAt:todayISO(-1)+'T12:10', endOdo:48250, distance:70, waitingMins:45, expenses:120, purpose:'Inter-facility transfer', ambulance:{ callReceivedAt:todayISO(-1)+'T07:55', dispatchAt:todayISO(-1)+'T08:40', arrivePickupAt:todayISO(-1)+'T08:42', departPickupAt:todayISO(-1)+'T09:05', arriveDestAt:todayISO(-1)+'T10:15', handoverAt:todayISO(-1)+'T10:35', caseType:'inter-facility transfer', patientCondition:'stable', oxygenUsed:true, oxygenBefore:'Full (2 cyl)', oxygenAfter:'1.5 cyl', disinfectionRequired:true, disinfectionDone:true, handoverRemarks:'Handed over to NIMHANS emergency' } });
    T({ tripNo:'TR-0002', source:'staff transport', requestingDept:'Administration', requestedBy:'HR Office', requestedAt:todayISO(0)+'T06:00', pickup:'Hoskote pickup point', drop:'SSSIHMS Whitefield', priority:'routine', vehicleId:vid('FL-STF-01'), driverId:drid('DRV-03'), status:'started', startAt:todayISO(0)+'T06:30', startOdo:132400, purpose:'Morning staff shuttle' });
    T({ tripNo:'TR-0003', source:'department', requestingDept:'Stores', requestedBy:'Stores Officer', requestedAt:todayISO(0)+'T10:00', pickup:'SSSIHMS Stores', drop:'Medical gas supplier, Peenya', priority:'routine', status:'requested', purpose:'Oxygen cylinder pickup' });
    T({ tripNo:'TR-0004', source:'emergency', requestingDept:'Emergency', requestedBy:'Casualty Duty Doctor', requestedAt:todayISO(-3)+'T22:15', pickup:'Kadugodi', drop:'SSSIHMS Emergency', priority:'emergency', vehicleId:vid('FL-AMB-02'), driverId:drid('DRV-02'), status:'completed', startAt:todayISO(-3)+'T22:20', startOdo:61600, endAt:todayISO(-3)+'T23:30', endOdo:61640, distance:40, expenses:0, purpose:'Emergency pickup', ambulance:{ callReceivedAt:todayISO(-3)+'T22:12', dispatchAt:todayISO(-3)+'T22:20', arrivePickupAt:todayISO(-3)+'T22:38', departPickupAt:todayISO(-3)+'T22:50', arriveDestAt:todayISO(-3)+'T23:15', handoverAt:todayISO(-3)+'T23:25', caseType:'emergency', patientCondition:'critical', oxygenUsed:true, oxygenBefore:'Full (2 cyl)', oxygenAfter:'1 cyl', disinfectionRequired:true, disinfectionDone:false, handoverRemarks:'Handed to casualty team; disinfection pending' } });
    s.counters.trip = 4;

    // --- Readiness checks ---
    const R = (o) => { s.readinessChecks.push(stamp(o)); return o; };
    const fullChecklist = pass => ({ 'Vehicle clean':true, 'Fuel above minimum threshold':pass, 'Oxygen cylinders available and adequate':pass, 'Stretcher functional':true, 'Suction functional':true, 'Monitor/defibrillator available':true, 'First-aid kit available':true, 'Emergency drugs kit checked':true, 'Siren and lights functional':pass, 'Communication device functional':true, 'PPE available':true, 'Biomedical waste bag available':true, 'Fire extinguisher valid':true });
    R({ vehicleId:vid('FL-AMB-01'), date:todayISO(0), checkedBy:'Manjunath R', items:fullChecklist(true), result:'pass', remarks:'' });
    R({ vehicleId:vid('FL-AMB-02'), date:todayISO(0), checkedBy:'Shivakumar B', items:fullChecklist(true), result:'pass', remarks:'' });
    R({ vehicleId:vid('FL-AMB-03'), date:todayISO(-4), checkedBy:'Syed Imran', items:Object.assign(fullChecklist(true), {'Siren and lights functional':false}), result:'fail', failedItems:['Siren and lights functional'], remarks:'Linked to breakdown BD-0001' });

    s.counters.doc = s.documents.length;
    s.counters.pm = s.pmRecords.length;
    return s;
  }

  function load() {
    if (store) return store;
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) { store = JSON.parse(raw); COLLECTIONS.forEach(c => { if (!store[c]) store[c] = []; }); return store; }
    } catch (e) { console.warn('DB load failed, reseeding', e); }
    store = seed(); persist();
    return store;
  }

  function persist() { localStorage.setItem(LS_KEY, JSON.stringify(store)); }

  let idCounter = 0;
  function newId() { return 'x' + Date.now().toString(36) + (++idCounter).toString(36); }

  const DB = {
    COLLECTIONS,
    todayISO,
    list(coll, filterFn) {
      const rows = load()[coll].filter(r => !r.deleted);
      return filterFn ? rows.filter(filterFn) : rows.slice();
    },
    get(coll, id) { return load()[coll].find(r => r.id === id && !r.deleted) || null; },
    insert(coll, obj) {
      const rec = Object.assign({}, obj, { id: newId(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deleted: false });
      load()[coll].push(rec);
      DB.audit('created', coll, rec.id, null, rec);
      persist(); return rec;
    },
    update(coll, id, patch) {
      const rec = DB.get(coll, id); if (!rec) return null;
      const old = Object.assign({}, rec);
      Object.assign(rec, patch, { updatedAt: new Date().toISOString() });
      DB.audit('edited', coll, id, old, rec);
      persist(); return rec;
    },
    softDelete(coll, id) {
      const rec = DB.get(coll, id); if (!rec) return false;
      rec.deleted = true; rec.updatedAt = new Date().toISOString();
      DB.audit('deleted', coll, id, rec, null);
      persist(); return true;
    },
    nextNumber(key, prefix) {
      const s = load(); s.counters[key] = (s.counters[key] || 0) + 1; persist();
      return prefix + '-' + String(s.counters[key]).padStart(4, '0');
    },
    audit(action, entityType, entityId, oldVal, newVal) {
      const s = load();
      s.auditLog.push({ id: newId(), user: (window.App && App.currentUser()) || 'system', timestamp: new Date().toISOString(),
        action, entityType, entityId,
        oldValue: oldVal ? JSON.stringify(summarize(oldVal)) : null,
        newValue: newVal ? JSON.stringify(summarize(newVal)) : null, deleted: false });
      persist();
    },
    getSettings() { return load().settings; },
    saveSettings(patch) { Object.assign(load().settings, patch); persist(); },
    reset() { localStorage.removeItem(LS_KEY); store = null; load(); },
    persist,
  };

  function summarize(obj) {
    const out = {};
    Object.keys(obj).forEach(k => {
      if (['id','createdAt','updatedAt','deleted'].includes(k)) return;
      const v = obj[k];
      if (v !== null && typeof v === 'object') return;
      out[k] = v;
    });
    return out;
  }

  window.DB = DB;
})();
