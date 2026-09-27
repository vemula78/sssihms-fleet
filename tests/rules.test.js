const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
require('../js/rules.js');

test('only verified fuel logs are trusted for financial calculations', () => {
  assert.equal(FleetRules.isTrustedFuelLog({ status: 'verified' }), true);
  for (const status of ['draft', 'submitted', 'rejected', null]) {
    assert.equal(FleetRules.isTrustedFuelLog({ status }), false);
  }
});

test('ambulance readiness must pass on the requested date', () => {
  assert.equal(FleetRules.readinessPassesForDate({ date: '2026-07-18', result: 'pass' }, '2026-07-18'), true);
  assert.equal(FleetRules.readinessPassesForDate({ date: '2026-07-17', result: 'pass' }, '2026-07-18'), false);
  assert.equal(FleetRules.readinessPassesForDate({ date: '2026-07-18', result: 'fail' }, '2026-07-18'), false);
  assert.equal(FleetRules.readinessPassesForDate(null, '2026-07-18'), false);
});

test('profile text joins escape stored markup', () => {
  assert.equal(
    FleetRules.safeTextJoin(['750 kg', '<img src=x onerror=alert(1)>'], ' · '),
    '750 kg · &lt;img src=x onerror=alert(1)&gt;'
  );
  assert.equal(FleetRules.safeTextJoin(['A&B', '"tag"'], ' / '), 'A&amp;B / &quot;tag&quot;');
});

test('vehicle status reconciliation preserves active operational constraints', () => {
  const vehicle = { id: 'v1', status: 'on trip' };
  assert.equal(FleetRules.reconciledVehicleStatus(vehicle, [{ vehicleId: 'v1', status: 'started' }], [], 'available'), 'on trip');
  assert.equal(FleetRules.reconciledVehicleStatus(vehicle, [], [{ vehicleId: 'v1', status: 'open', safetyImpact: true }], 'available'), 'under maintenance');
  assert.equal(FleetRules.reconciledVehicleStatus(vehicle, [], [], 'off road'), 'off road');
  assert.equal(FleetRules.reconciledVehicleStatus(vehicle, [], [], 'available'), 'available');
});
