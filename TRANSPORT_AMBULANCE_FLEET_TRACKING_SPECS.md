# Transport and Ambulance Fleet Tracking Specification

## 1. Purpose

Build a fleet tracking module for hospital transport and ambulance operations that records vehicle master data, trips, ambulance readiness, fuel consumption, preventive maintenance, breakdowns, repair costs, statutory compliance, documents, reminders, and management reports.

The module should support both day-to-day transport operations and long-term cost control, with a clear audit trail for every vehicle.

## 2. Scope

### In Scope

- Vehicle master register for ambulances, patient transport vehicles, staff vehicles, utility vehicles, and other hospital-owned or hospital-operated fleet assets.
- Driver and attendant assignment tracking.
- Trip booking, dispatch, trip completion, and trip cost capture.
- Ambulance-specific readiness checks, oxygen/equipment checks, emergency response trips, and patient handover details.
- Fueling logs with odometer, fuel quantity, amount, vendor, bill number, and fuel efficiency calculations.
- Preventive maintenance schedules based on date, odometer, engine hours, or custom intervals.
- Breakdown tickets and repair records.
- Maintenance cost tracking by vehicle, category, vendor, part, labor, and period.
- Insurance, fitness certificate, pollution certificate, permit, registration, tax, calibration, and other compliance reminders.
- Document upload and expiry tracking.
- Reports, dashboards, and CSV exports.
- QR label per vehicle for quick mobile access.
- Role-based access for transport staff, ambulance staff, drivers, maintenance users, vendors, finance, and management.

### Out of Scope for Phase 1

- Live GPS tracking hardware integration.
- Automated fuel card integration.
- Payroll processing for drivers.
- Full ambulance clinical record or EMR replacement.
- Route optimization engine.
- Automatic toll integration.

These can be added later through APIs or third-party integrations.

## 3. User Roles and Permissions

### Fleet Administrator

- Full access to vehicle records, masters, settings, users, reports, imports, and exports.
- Can create, edit, archive, and restore fleet records.

### Transport Manager

- Manages vehicle availability, trips, drivers, fuel logs, maintenance requests, documents, and reports.
- Can approve high-value maintenance and fuel entries if approval workflow is enabled.

### Ambulance Coordinator

- Manages ambulance availability, emergency dispatch, readiness checks, oxygen/equipment checks, ambulance trips, and handover records.
- Can view ambulance maintenance and compliance status.

### Driver

- Can view assigned trips.
- Can start and close trips.
- Can enter odometer readings, fuel entries, basic defects, and daily vehicle checklists.
- Cannot edit approved financial values unless allowed by policy.

### Maintenance Team

- Can create and update preventive maintenance, breakdowns, repair records, parts, labor, vendor assignment, and cost details.
- Can mark vehicles as under maintenance or fit for service.

### Finance User

- Can review and export fuel costs, maintenance costs, vendor bills, trip billing, and approval status.
- Can mark bills as verified or paid if enabled.

### Vendor

- Can update only assigned maintenance jobs.
- Can add service notes, parts used, labor, estimated cost, final cost, invoice number, and job completion status.

### Management Viewer

- Read-only dashboard and reports.
- Can view cost trends, utilization, compliance risks, ambulance readiness, downtime, and fleet KPIs.

## 4. Core Data Masters

### 4.1 Vehicle Master

Required fields:

- Vehicle ID / asset code
- Registration number
- Vehicle type: ambulance, patient transport, staff transport, utility, goods, other
- Ambulance category where applicable: BLS, ALS, neonatal, cardiac, mortuary, other
- Make
- Model
- Year of manufacture
- Chassis number
- Engine number
- Fuel type: petrol, diesel, CNG, electric, hybrid, other
- Ownership type: owned, leased, rented, donated, outsourced
- Department / cost center
- Base location
- Current status: available, on trip, under maintenance, off road, standby, retired
- Current odometer
- Purchase date
- Purchase cost
- Vendor / dealer
- Seating capacity
- Load capacity where applicable
- Notes

Optional fields:

- GPS device ID
- FASTag ID
- Fuel card number
- Insurance provider
- Ambulance call sign
- Emergency contact number displayed on vehicle
- Pollution category / emission standard
- Expected mileage benchmark
- Expected monthly utilization
- Depreciation method

### 4.2 Driver Master

- Driver ID
- Name
- Mobile number
- Alternate contact
- License number
- License class
- License expiry date
- Badge number if applicable
- Employee type: employee, contract, vendor
- Assigned vehicle
- Shift
- Active/inactive status
- Emergency contact
- Documents

### 4.3 Vendor Master

- Vendor name
- Vendor type: fuel station, workshop, dealer, insurance, towing, certification, rental agency, other
- Contact person
- Phone
- Email
- Address
- GST/tax number if applicable
- Contract terms
- Payment terms
- Active/inactive status

### 4.4 Fuel Station Master

Fuel stations may be stored as vendors with type `fuel station`, or as a separate master if detailed fuel controls are needed.

Fields:

- Station name
- Location
- Fuel types supplied
- Contact number
- Credit facility: yes/no
- Monthly billing enabled: yes/no
- Active/inactive status

### 4.5 Maintenance Category Master

Examples:

- Preventive maintenance
- Breakdown repair
- Accident repair
- Tyre replacement
- Battery replacement
- Oil and lubricant
- AC repair
- Electrical repair
- Body work
- Ambulance medical equipment support
- Oxygen system support
- Cleaning and disinfection
- Certification / inspection

## 5. Functional Requirements

## 5.1 Dashboard

The dashboard should show:

- Total vehicles by type and status.
- Ambulances available now.
- Ambulances under maintenance.
- Vehicles on trip.
- Vehicles due for preventive maintenance.
- Vehicles overdue for preventive maintenance.
- Compliance documents expiring in 90, 60, 30, 7, and 0 days.
- Monthly fuel cost.
- Monthly maintenance cost.
- Cost per kilometer by vehicle.
- Fuel efficiency by vehicle.
- Top 10 high-cost vehicles.
- Vehicle downtime.
- Open breakdowns.
- Ambulance readiness failures.

Dashboard filters:

- Date range
- Vehicle type
- Department / cost center
- Base location
- Vehicle status
- Vendor

## 5.2 Vehicle Detail Page

Each vehicle detail page should include:

- Master profile.
- Current availability and last known odometer.
- Assigned driver.
- Active trip if any.
- Fuel history.
- Maintenance history.
- Preventive maintenance schedule.
- Breakdown history.
- Compliance documents and expiry dates.
- Cost summary.
- Uploaded documents.
- Audit trail.
- QR code label link.

## 5.3 Trip Management

Trip records should support:

- Trip request number.
- Request source: department, emergency, patient transfer, staff transport, utility, other.
- Requesting department.
- Requested by.
- Requested date and time.
- Pickup location.
- Drop location.
- Patient name / ID when applicable, subject to privacy rules.
- Attendant / nurse / paramedic if applicable.
- Priority: routine, urgent, emergency.
- Assigned vehicle.
- Assigned driver.
- Assigned ambulance staff where applicable.
- Start date and time.
- Start odometer.
- End date and time.
- End odometer.
- Distance traveled.
- Waiting time.
- Toll / parking / other expense.
- Trip purpose.
- Trip status: requested, approved, assigned, started, completed, cancelled, rejected.
- Cancellation reason.
- Trip notes.

System behavior:

- A vehicle cannot be assigned to overlapping trips unless an authorized user overrides it.
- A driver cannot be assigned to overlapping trips unless an authorized user overrides it.
- Start odometer cannot be lower than the previous vehicle odometer.
- End odometer cannot be lower than start odometer.
- Completing a trip updates the vehicle's current odometer.
- Vehicles under maintenance, off road, or retired cannot be assigned unless an authorized user overrides the status.

## 5.4 Ambulance Operations

Ambulance records should extend trip management with emergency readiness fields:

- Emergency call received time.
- Dispatch time.
- Arrival at pickup time.
- Departure from pickup time.
- Arrival at destination time.
- Handover time.
- Response time.
- Transport time.
- Case type: emergency, inter-facility transfer, discharge, event standby, other.
- Patient condition category: stable, critical, deceased, other.
- Oxygen used: yes/no.
- Oxygen cylinder level before trip.
- Oxygen cylinder level after trip.
- Critical equipment used.
- Disinfection required: yes/no.
- Disinfection completed: yes/no.
- Handover remarks.

Readiness checklist:

- Vehicle clean.
- Fuel above minimum threshold.
- Oxygen cylinders available and adequate.
- Stretcher functional.
- Suction functional.
- Monitor/defibrillator available where applicable.
- First-aid kit available.
- Emergency drugs kit checked where applicable.
- Siren and lights functional.
- Communication device functional.
- PPE available.
- Biomedical waste bag available.
- Fire extinguisher valid.

System behavior:

- Ambulance status should become unavailable if a critical readiness check fails.
- Failed readiness checks should create a corrective action task or breakdown ticket.
- Ambulance can be returned to available status only after failed critical checks are resolved.

## 5.5 Fueling Management

Fuel log fields:

- Fuel log number.
- Vehicle.
- Date and time.
- Driver.
- Fuel station / vendor.
- Fuel type.
- Quantity.
- Rate per unit.
- Total amount.
- Bill / receipt number.
- Bill image upload.
- Odometer at fueling.
- Tank full: yes/no.
- Payment mode: cash, credit, fuel card, account, other.
- Entered by.
- Verified by.
- Verification status: draft, submitted, verified, rejected.
- Remarks.

System calculations:

- Fuel amount = quantity x rate, with manual override only for authorized users.
- Distance since previous fueling.
- Fuel efficiency based on full-tank-to-full-tank method where possible.
- Average fuel cost per kilometer.
- Fuel variance against expected mileage benchmark.

Validation:

- Fuel quantity must be positive.
- Fuel rate must be positive.
- Odometer cannot be lower than the previous odometer.
- Duplicate bill number for the same vendor should warn or block based on settings.
- Abnormally high fuel quantity or cost should require approval.

Alerts:

- Fuel efficiency below threshold.
- Fuel quantity exceeds tank capacity.
- Odometer jump outside configured tolerance.
- Fuel entry without receipt attachment if attachment is mandatory.

## 5.6 Preventive Maintenance

Preventive maintenance schedules should support:

- Vehicle.
- Maintenance type.
- Checklist template.
- Frequency by days.
- Frequency by kilometers.
- Frequency by engine hours, optional.
- Last service date.
- Last service odometer.
- Next due date.
- Next due odometer.
- Assigned user/team/vendor.
- Estimated cost.
- Priority.
- Status: active, paused, retired.

Preventive maintenance record fields:

- Schedule reference.
- Vehicle.
- Service date.
- Service odometer.
- Vendor / workshop.
- Work performed.
- Checklist results.
- Parts used.
- Labor cost.
- Parts cost.
- Other cost.
- Taxes.
- Discount.
- Total cost.
- Invoice number.
- Invoice upload.
- Next due date.
- Next due odometer.
- Downtime start.
- Downtime end.
- Vehicle fitness after service: fit, fit with observation, unfit.
- Remarks.

System behavior:

- Preventive maintenance becomes due based on whichever threshold is reached first: date, odometer, or engine hours.
- Completion updates next due values.
- Completion updates current vehicle odometer if service odometer is greater.
- Overdue maintenance should show on dashboard and reminders.
- Vehicle may optionally be marked unavailable while PM is open.

## 5.7 Breakdown and Repair Tracking

Breakdown ticket fields:

- Ticket number.
- Vehicle.
- Reported by.
- Reported date and time.
- Current odometer.
- Location.
- Issue category.
- Issue description.
- Severity: low, medium, high, critical.
- Safety impact: yes/no.
- Ambulance readiness impact: yes/no.
- Vehicle status impact: available, restricted use, under maintenance, off road.
- Assigned maintenance user/team.
- Assigned vendor.
- Target response date/time.
- Target resolution date/time.
- Status: open, assigned, in progress, waiting for parts, waiting for approval, resolved, closed, cancelled.
- Root cause.
- Corrective action.
- Parts used.
- Labor cost.
- Parts cost.
- Towing cost.
- Other cost.
- Taxes.
- Total repair cost.
- Invoice number.
- Invoice upload.
- Downtime start.
- Downtime end.
- Closure notes.

System behavior:

- Critical safety issues should automatically mark the vehicle unavailable.
- Ambulance readiness-impacting issues should block ambulance availability until resolved.
- Closing a ticket should require root cause, corrective action, and final vehicle status.
- Total cost should be calculated from cost components.

## 5.8 Cost Tracking

Costs should be captured across:

- Fuel.
- Preventive maintenance.
- Breakdown repairs.
- Accident repairs.
- Tyres.
- Batteries.
- Insurance.
- Permits.
- Taxes.
- Fitness certification.
- Pollution certification.
- Cleaning and disinfection.
- Rental/lease charges.
- Towing.
- Ambulance equipment support.

Cost dimensions:

- Vehicle.
- Vehicle type.
- Department / cost center.
- Vendor.
- Cost category.
- Date.
- Odometer.
- Trip reference where applicable.
- Bill/invoice number.
- Approval status.
- Payment status.

Core KPIs:

- Total cost per vehicle.
- Fuel cost per kilometer.
- Maintenance cost per kilometer.
- Total operating cost per kilometer.
- Cost per trip.
- Cost per ambulance emergency trip.
- Monthly cost by category.
- Vendor-wise spend.
- Downtime cost, optional.
- High-cost vehicle flag.

## 5.9 Compliance and Document Tracking

Document types:

- Registration certificate.
- Insurance.
- Fitness certificate.
- Pollution certificate.
- Road tax.
- Permit.
- Driver license.
- Driver badge.
- Ambulance certification.
- Medical equipment calibration.
- Oxygen cylinder hydrotest / validity.
- Fire extinguisher validity.
- Rental/lease agreement.
- Service contract.

Document fields:

- Document type.
- Vehicle or driver reference.
- Document number.
- Issuing authority.
- Issue date.
- Expiry date.
- Reminder thresholds.
- Attachment.
- Status: valid, expiring soon, expired, renewed, not applicable.
- Remarks.

System behavior:

- Expiring documents should trigger reminders.
- Expired critical documents should mark the vehicle or driver as non-compliant.
- Non-compliant vehicles should be blocked from assignment if configured.
- Non-compliant drivers should be blocked from assignment if configured.

## 5.10 QR Codes

Each vehicle should have a printable QR label.

Scanning the QR code should open the vehicle detail page with role-based visibility:

- Driver: assigned trips, fuel entry, defect reporting, checklist.
- Maintenance team: vehicle details, maintenance, breakdowns, documents.
- Manager: full vehicle profile and reports.
- Unauthorized user: login prompt.

QR label should include:

- Vehicle registration number.
- Vehicle asset code.
- Vehicle type.
- QR code.
- Hospital name or logo if configured.

## 5.11 Notifications and Reminders

Reminder triggers:

- Preventive maintenance due by date.
- Preventive maintenance due by odometer.
- Preventive maintenance overdue.
- Insurance expiry.
- Fitness expiry.
- Pollution certificate expiry.
- Permit expiry.
- Road tax expiry.
- Driver license expiry.
- Ambulance readiness failure.
- Open critical breakdown.
- Vehicle unavailable beyond threshold.
- Fuel efficiency below threshold.
- High-cost repair pending approval.

Default reminder thresholds:

- 90 days
- 60 days
- 30 days
- 7 days
- Due today
- Overdue

Reminder channels:

- In-app notifications.
- Email.
- Optional SMS/WhatsApp integration in later phase.

## 5.12 Reports and Exports

Required reports:

- Vehicle master report.
- Vehicle availability report.
- Trip register.
- Ambulance emergency response report.
- Ambulance readiness failure report.
- Fuel consumption report.
- Fuel efficiency report.
- Fuel vendor spend report.
- Preventive maintenance due report.
- Preventive maintenance history report.
- Breakdown report.
- Vehicle downtime report.
- Maintenance cost report.
- Vehicle total cost report.
- Cost per kilometer report.
- Compliance expiry report.
- Driver license expiry report.
- Vendor performance report.
- High-cost vehicle report.

Each report should support:

- Date range filters.
- Vehicle filters.
- Vehicle type filters.
- Department filters.
- Vendor filters where applicable.
- CSV export.
- Print-friendly view.

## 5.13 Imports

CSV imports should be provided for:

- Vehicle master.
- Driver master.
- Vendor master.
- Fuel opening balances or historical fuel entries.
- Maintenance schedules.
- Compliance documents.
- Historical maintenance records.

Import behavior:

- Match vehicles by registration number or asset code.
- Match drivers by driver ID or license number.
- Match vendors by vendor name.
- Validate each row independently.
- Report row-level errors.
- Support update or skip mode.
- Prevent duplicate vehicle registrations.

## 5.14 Audit Trail

Audit log should capture:

- Record created.
- Record edited.
- Status changed.
- Cost changed.
- Document uploaded.
- Document deleted.
- Approval action.
- Vehicle marked unavailable/available.
- Trip started/completed/cancelled.
- Fuel entry verified/rejected.
- Maintenance ticket closed.

Audit fields:

- User.
- Timestamp.
- Action.
- Entity type.
- Entity ID.
- Old value.
- New value.
- IP address if available.

## 6. Data Model Summary

Recommended tables/entities:

- Vehicles
- Drivers
- Vehicle-driver assignments
- Fleet vendors
- Trips
- Ambulance trip details
- Daily vehicle checklists
- Ambulance readiness checks
- Fuel logs
- Maintenance schedules
- Maintenance records
- Breakdown tickets
- Repair parts
- Vehicle documents
- Compliance reminders
- Cost ledger
- Notifications
- Audit log
- Settings

The cost ledger can either be a generated reporting view from operational tables or a stored normalized table populated when fuel, maintenance, repair, compliance, or trip expenses are approved.

## 7. Business Rules

- Registration number must be unique for active vehicles.
- Vehicle asset code must be unique.
- Retired vehicles cannot be assigned to trips.
- Vehicles under maintenance cannot be assigned to trips unless override permission is granted.
- Ambulances with failed critical readiness checks cannot be dispatched.
- Driver license must be valid for assignment if compliance blocking is enabled.
- Fuel, maintenance, and repair costs should require verification above configurable thresholds.
- Odometer values must move forward, except corrections by authorized users with audit reason.
- Preventive maintenance due status should be recalculated when odometer or service records change.
- Deleting operational records should be soft delete only.
- Attachments should remain linked to their source record and included in backups.

## 8. Settings

Configurable settings:

- Reminder thresholds.
- Fuel efficiency warning threshold by vehicle type.
- Minimum ambulance fuel level.
- Tank capacity by vehicle.
- Odometer jump tolerance.
- Mandatory receipt upload for fuel: yes/no.
- Mandatory invoice upload for maintenance above amount.
- Approval threshold for fuel.
- Approval threshold for maintenance.
- Compliance blocking rules.
- Ambulance critical checklist items.
- Default trip approval requirement.
- Default vehicle availability status after trip.
- Notification email recipients.
- CSV import row limit.

## 9. Non-Functional Requirements

### Security

- Role-based access control.
- Authentication required for all operational pages.
- Sensitive patient details in ambulance trips should be minimized and access restricted.
- Uploaded documents should not be publicly accessible.
- All create/update/delete actions should be capability checked.

### Privacy

- Patient-identifying fields should be optional and limited.
- Reports for general transport users should avoid patient details.
- Audit logs should record access and edits to sensitive ambulance trip fields where feasible.

### Reliability

- Reminder jobs should tolerate missed cron runs and catch up on the next run.
- Cost calculations should be deterministic and exportable.
- Imports should not partially corrupt existing records.

### Performance

- Dashboard and report queries should be indexed by vehicle, date, status, vendor, and department.
- CSV exports should support large date ranges without timing out where possible.

### Backup

- Vehicle documents, fuel receipts, invoices, and compliance attachments must be included in full-site backups.
- Operational tables must be included in database backups.

## 10. Suggested Phases

### Phase 1: Fleet Register, Fuel, Maintenance, and Compliance

- Vehicle master.
- Driver master.
- Vendor master.
- Fuel logs.
- Preventive maintenance schedules and records.
- Breakdown tickets.
- Maintenance cost tracking.
- Compliance documents and reminders.
- Dashboard and core reports.
- CSV imports and exports.
- QR labels.

### Phase 2: Trip and Ambulance Operations

- Trip requests and dispatch.
- Ambulance emergency trip fields.
- Ambulance readiness checklist.
- Daily driver checklist.
- Downtime analytics.
- Cost per trip.

### Phase 3: Integrations and Automation

- GPS integration.
- Fuel card import.
- SMS/WhatsApp alerts.
- Finance/accounting export.
- Maps and route distance validation.
- Advanced vendor performance analytics.

## 11. Acceptance Criteria

- Users can create and edit vehicles with unique asset codes and registration numbers.
- Users can record fuel entries and see fuel cost, fuel efficiency, and cost per kilometer.
- Users can create preventive maintenance schedules and receive due/overdue reminders.
- Users can record maintenance completion with parts, labor, invoice, downtime, and total cost.
- Users can raise and close breakdown tickets with root cause, corrective action, cost, and downtime.
- Ambulance readiness failures can mark an ambulance unavailable.
- Compliance documents produce expiry reminders.
- Dashboard shows vehicle status, cost, fuel, maintenance, compliance, and ambulance readiness indicators.
- Reports export correctly to CSV.
- QR code opens the vehicle detail page with role-appropriate actions.
- All financial and status-changing actions are audit logged.

