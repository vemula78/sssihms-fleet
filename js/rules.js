/* Shared, side-effect-free operational rules used by UI modules and tests. */
(function () {
  'use strict';

  const BLOCKED_STATUSES = ['restricted use', 'under maintenance', 'off road'];
  const CLOSED_BREAKDOWN_STATUSES = ['closed', 'cancelled'];

  function isTrustedFuelLog(log) {
    return !!log && log.status === 'verified';
  }

  function readinessPassesForDate(check, date) {
    return !!check && check.date === date && check.result === 'pass';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function safeTextJoin(values, separator) {
    return escapeHtml((values || []).filter(Boolean).join(separator || ''));
  }

  function breakdownVehicleStatus(breakdown) {
    if (!breakdown || CLOSED_BREAKDOWN_STATUSES.includes(breakdown.status)) return null;
    if (BLOCKED_STATUSES.includes(breakdown.statusImpact)) return breakdown.statusImpact;
    if (breakdown.safetyImpact || breakdown.readinessImpact || breakdown.severity === 'critical') return 'under maintenance';
    return null;
  }

  function reconciledVehicleStatus(vehicle, trips, breakdowns, preferredStatus) {
    if (!vehicle) return null;
    if (vehicle.status === 'retired') return 'retired';
    if ((trips || []).some(t => t.vehicleId === vehicle.id && t.status === 'started')) return 'on trip';

    const impact = (breakdowns || [])
      .filter(b => b.vehicleId === vehicle.id)
      .map(breakdownVehicleStatus)
      .filter(Boolean)
      .sort((a, b) => BLOCKED_STATUSES.indexOf(b) - BLOCKED_STATUSES.indexOf(a))[0];
    if (impact) return impact;

    const fallback = preferredStatus || vehicle.status;
    if (fallback === 'on trip' || !fallback) return 'available';
    return fallback;
  }

  window.FleetRules = {
    isTrustedFuelLog,
    readinessPassesForDate,
    reconciledVehicleStatus,
    safeTextJoin,
  };
}());
