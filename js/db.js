/* SSSIHMS Fleet — authenticated server data layer. */
(function () {
  const COLLECTIONS = ['vehicles','drivers','vendors','trips','fuelLogs','pmSchedules',
    'pmRecords','breakdowns','documents','readinessChecks','auditLog'];
  let store = null;
  let user = null;
  let csrfToken = null;

  function todayISO(offsetDays = 0) {
    const d = new Date(); d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  async function request(route, options) {
    options = options || {};
    const headers = Object.assign({ 'Accept': 'application/json' }, options.headers || {});
    if (options.body != null) headers['Content-Type'] = 'application/json';
    if (csrfToken && options.method && options.method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
    const response = await fetch('api/index.php?route=' + encodeURIComponent(route), {
      method: options.method || 'GET', credentials: 'same-origin', headers,
      body: options.body == null ? undefined : JSON.stringify(options.body),
    });
    let payload = {};
    try { payload = await response.json(); } catch (_) { /* handled below */ }
    if (!response.ok) {
      const err = new Error(payload.error || 'Server request failed (' + response.status + ').');
      err.status = response.status; err.code = payload.code; throw err;
    }
    return payload;
  }

  function requireStore() {
    if (!store) throw new Error('Fleet data has not been loaded.');
    return store;
  }

  function replaceRecord(collection, record) {
    const rows = requireStore()[collection];
    const index = rows.findIndex(r => r.id === record.id);
    if (index === -1) rows.push(record); else rows[index] = record;
    return record;
  }

  const DB = {
    COLLECTIONS, todayISO,
    async init() {
      const payload = await request('bootstrap');
      store = payload.store; user = payload.user; csrfToken = payload.csrfToken;
      COLLECTIONS.forEach(c => { if (!Array.isArray(store[c])) store[c] = []; });
      if (!store.settings) store.settings = {};
      return payload;
    },
    async login(username, password) {
      const payload = await request('auth/login', { method: 'POST', body: { username, password } });
      user = payload.user; csrfToken = payload.csrfToken;
      return user;
    },
    async logout() {
      await request('auth/logout', { method: 'POST', body: {} });
      store = null; user = null; csrfToken = null;
    },
    async changePassword(currentPassword, newPassword) {
      await request('auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
      if (user) user.mustChangePassword = false;
    },
    currentUser() { return user; },
    list(collection, filterFn) {
      const rows = (requireStore()[collection] || []).filter(r => !r.deleted);
      return filterFn ? rows.filter(filterFn) : rows.slice();
    },
    get(collection, id) {
      return (requireStore()[collection] || []).find(r => r.id === id && !r.deleted) || null;
    },
    async insert(collection, object) {
      const payload = await request('records/' + collection, { method: 'POST', body: object });
      return replaceRecord(collection, payload.record);
    },
    async update(collection, id, patch) {
      const payload = await request('records/' + collection + '/' + encodeURIComponent(id), { method: 'PATCH', body: patch });
      return replaceRecord(collection, payload.record);
    },
    async softDelete(collection, id) {
      await request('records/' + collection + '/' + encodeURIComponent(id), { method: 'DELETE' });
      const row = DB.get(collection, id); if (row) row.deleted = true;
      return true;
    },
    async nextNumber(key, prefix) {
      const payload = await request('next-number', { method: 'POST', body: { key, prefix } });
      return payload.number;
    },
    getSettings() { return requireStore().settings; },
    async saveSettings(patch) {
      const payload = await request('settings', { method: 'PATCH', body: patch });
      store.settings = payload.settings; return store.settings;
    },
  };

  window.DB = DB;
})();
