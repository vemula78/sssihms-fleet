/* =============================================================
 * SSSIHMS Fleet — app shell, router, roles, shared helpers
 * =============================================================
 * Modules register with:
 *   App.registerModule({ id, title, order, roles?, render(container, params) })
 * Routing: '#/moduleId' or '#/moduleId/param1/param2' -> render(container, [param1, param2])
 * Cross-module links: location.hash = '#/vehicles/' + vehicleId (masters module
 * owns the vehicle detail page at #/vehicles/:id).
 *
 * Helpers available to all modules:
 *   App.fmtDate(iso), App.fmtDateTime(iso), App.fmtINR(n), App.fmtNum(n)
 *   App.daysUntil(iso)  -> integer days (negative = past)
 *   App.badge(text, cls?) -> HTML string
 *   App.el(html)        -> Element from HTML string
 *   App.esc(s)          -> HTML-escape
 *   App.table({ columns:[{key,label,num?,render?(row)}], rows, empty? }) -> Element
 *   App.modal({ title, body(El|html), actions:[{label, cls?, onClick(close)}] }) -> close fn
 *   App.form(fields, values?) -> { el, read(), validate() }   (see below)
 *   App.toast(msg, isError?)
 *   App.exportCSV(filename, headers[], rows[][])
 *   App.can(action)     -> permission check for current role
 *   App.currentRole(), App.currentUser()
 *   App.vehicleName(id), App.driverName(id), App.vendorName(id)
 *   App.docStatus(expiryISO) -> {label, cls} valid/expiring/expired
 *
 * App.form fields: [{ name, label, type: 'text|number|date|datetime-local|select|textarea|checkbox',
 *   options?: ['a','b'] | [{value,label}], required?, min?, step?, hint?, value? }]
 * ============================================================= */
(function () {
  const modules = [];
  const ROLES = ['Fleet Administrator','Transport Manager','Ambulance Coordinator','Driver',
    'Maintenance Team','Finance User','Vendor','Management Viewer'];

  // action -> roles allowed (Fleet Administrator always allowed)
  const PERMS = {
    'masters.edit':      ['Transport Manager'],
    'trips.manage':      ['Transport Manager','Ambulance Coordinator'],
    'trips.drive':       ['Transport Manager','Ambulance Coordinator','Driver'],
    'fuel.enter':        ['Transport Manager','Driver'],
    'fuel.verify':       ['Transport Manager','Finance User'],
    'maintenance.manage':['Maintenance Team','Transport Manager'],
    'vendor.update':     ['Maintenance Team','Transport Manager','Vendor'],
    'finance.view':      ['Finance User','Transport Manager','Management Viewer'],
    'compliance.manage': ['Transport Manager','Maintenance Team'],
    'settings.edit':     [],
    'override':          ['Transport Manager'],
    'readiness.check':   ['Ambulance Coordinator','Driver'],
  };

  let identity = null;

  const App = {
    registerModule(m) { modules.push(m); },
    currentRole() { return identity ? identity.role : null; },
    currentUser() { return identity ? identity.displayName : ''; },
    identity() { return identity; },
    can(action) {
      const currentRole = App.currentRole();
      if (currentRole === 'Fleet Administrator') return true;
      const allowed = PERMS[action];
      return allowed ? allowed.includes(currentRole) : false;
    },
    roles: ROLES,

    // ---------- formatting ----------
    esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },
    fmtDate(iso) {
      if (!iso) return '—';
      const d = new Date(iso.length === 10 ? iso + 'T00:00' : iso);
      if (isNaN(d)) return iso;
      const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
      return String(d.getDate()).padStart(2,'0') + '-' + m + '-' + d.getFullYear();
    },
    fmtDateTime(iso) {
      if (!iso) return '—';
      const d = new Date(iso); if (isNaN(d)) return iso;
      return App.fmtDate(iso) + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
    },
    fmtINR(n) {
      if (n == null || isNaN(n)) return '—';
      return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
    },
    fmtNum(n, dp = 1) { return (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: dp }); },
    daysUntil(iso) {
      if (!iso) return null;
      const d = new Date(iso.slice(0,10) + 'T00:00'); const t = new Date(); t.setHours(0,0,0,0);
      return Math.round((d - t) / 86400000);
    },
    docStatus(expiryISO) {
      const days = App.daysUntil(expiryISO);
      if (days == null) return { label: 'n/a', cls: 'muted' };
      if (days < 0) return { label: 'expired', cls: 'expired' };
      if (days <= 30) return { label: 'expiring soon', cls: 'expiring' };
      return { label: 'valid', cls: 'valid' };
    },
    badge(text, cls) {
      const c = (cls || String(text)).toLowerCase().replace(/\s+/g, '-');
      return '<span class="badge ' + App.esc(c) + '">' + App.esc(text) + '</span>';
    },

    // ---------- lookups ----------
    vehicleName(id) { const v = DB.get('vehicles', id); return v ? v.regNo + ' (' + v.assetCode + ')' : '—'; },
    driverName(id) { const d = DB.get('drivers', id); return d ? d.name : '—'; },
    vendorName(id) { const v = DB.get('vendors', id); return v ? v.name : '—'; },

    // ---------- DOM ----------
    el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; },
    table({ columns, rows, empty }) {
      const wrap = App.el('<div class="table-wrap"></div>');
      if (!rows.length) { wrap.innerHTML = '<p style="padding:1rem" class="text-muted">' + App.esc(empty || 'No records.') + '</p>'; return wrap; }
      const tbl = App.el('<table class="data"></table>');
      tbl.innerHTML = '<thead><tr>' + columns.map(c => '<th class="' + (c.num ? 'num' : '') + '">' + App.esc(c.label) + '</th>').join('') + '</tr></thead>';
      const tbody = document.createElement('tbody');
      rows.forEach(row => {
        const tr = document.createElement('tr');
        columns.forEach(c => {
          const td = document.createElement('td');
          if (c.num) td.className = 'num';
          const val = c.render ? c.render(row) : row[c.key];
          if (val instanceof Element) td.appendChild(val);
          else if (c.render) td.innerHTML = val == null ? '—' : val;   // render() returns trusted HTML
          else td.textContent = val == null || val === '' ? '—' : val;
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      tbl.appendChild(tbody); wrap.appendChild(tbl); return wrap;
    },
    modal({ title, body, actions }) {
      const root = document.getElementById('modal-root');
      const backdrop = App.el('<div class="modal-backdrop"></div>');
      const box = App.el('<div class="modal"><h2>' + App.esc(title) + '</h2><div class="modal-body"></div><div class="modal-actions"></div></div>');
      const bodyEl = box.querySelector('.modal-body');
      if (body instanceof Element) bodyEl.appendChild(body); else bodyEl.innerHTML = body || '';
      const close = () => backdrop.remove();
      const actEl = box.querySelector('.modal-actions');
      (actions || [{ label: 'Close', cls: 'ghost' }]).forEach(a => {
        const b = App.el('<button class="btn ' + (a.cls || '') + '">' + App.esc(a.label) + '</button>');
        b.addEventListener('click', () => a.onClick ? a.onClick(close) : close());
        actEl.appendChild(b);
      });
      backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
      backdrop.appendChild(box); root.appendChild(backdrop);
      return close;
    },
    form(fields, values) {
      values = values || {};
      const el = App.el('<div class="form-grid"></div>');
      const inputs = {};
      fields.forEach(f => {
        const wrap = App.el('<div class="field"' + (f.type === 'textarea' || f.full ? ' style="grid-column:1/-1"' : '') + '></div>');
        wrap.innerHTML = '<label>' + App.esc(f.label) + (f.required ? ' *' : '') + '</label>';
        let input;
        const val = values[f.name] != null ? values[f.name] : (f.value != null ? f.value : '');
        if (f.type === 'select') {
          input = document.createElement('select');
          (f.options || []).forEach(o => {
            const opt = document.createElement('option');
            if (typeof o === 'object') { opt.value = o.value; opt.textContent = o.label; }
            else { opt.value = o; opt.textContent = o; }
            input.appendChild(opt);
          });
          if (!f.required) input.insertBefore(new Option('—', ''), input.firstChild);
          input.value = val;
        } else if (f.type === 'textarea') {
          input = document.createElement('textarea'); input.rows = 2; input.value = val;
        } else if (f.type === 'checkbox') {
          input = document.createElement('input'); input.type = 'checkbox'; input.checked = !!val;
        } else {
          input = document.createElement('input'); input.type = f.type || 'text';
          if (f.min != null) input.min = f.min;
          if (f.step != null) input.step = f.step;
          input.value = val;
        }
        input.name = f.name; inputs[f.name] = { input, field: f, wrap };
        wrap.appendChild(input);
        if (f.hint) wrap.appendChild(App.el('<span class="hint">' + App.esc(f.hint) + '</span>'));
        el.appendChild(wrap);
      });
      return {
        el, inputs,
        read() {
          const out = {};
          Object.values(inputs).forEach(({ input, field }) => {
            if (field.type === 'checkbox') out[field.name] = input.checked;
            else if (field.type === 'number') out[field.name] = input.value === '' ? null : Number(input.value);
            else out[field.name] = input.value || null;
          });
          return out;
        },
        validate() {
          let ok = true;
          Object.values(inputs).forEach(({ input, field, wrap }) => {
            wrap.classList.remove('invalid'); wrap.querySelectorAll('.err').forEach(e => e.remove());
            let err = null;
            if (field.required && (field.type === 'checkbox' ? false : String(input.value).trim() === '')) err = 'Required';
            if (!err && field.type === 'number' && input.value !== '' && field.min != null && Number(input.value) < field.min) err = 'Must be ≥ ' + field.min;
            if (!err && field.validate) err = field.validate(input.value, this.read());
            if (err) { ok = false; wrap.classList.add('invalid'); wrap.appendChild(App.el('<span class="err">' + App.esc(err) + '</span>')); }
          });
          return ok;
        },
      };
    },
    toast(msg, isError) {
      const t = App.el('<div class="toast' + (isError ? ' error' : '') + '">' + App.esc(msg) + '</div>');
      document.getElementById('toast-root').appendChild(t);
      setTimeout(() => t.remove(), 3500);
    },
    exportCSV(filename, headers, rows) {
      const q = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      const csv = [headers.map(q).join(',')].concat(rows.map(r => r.map(q).join(','))).join('\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = filename; a.click();
      URL.revokeObjectURL(a.href);
      App.toast('Exported ' + filename);
    },

    // ---------- shell ----------
    navigate(hash) { location.hash = hash; },
    async start() {
      const main = document.getElementById('app-main');
      main.innerHTML = '<div class="card loading-card"><p>Connecting securely to the fleet server…</p></div>';
      try {
        await DB.init(); identity = DB.currentUser();
      } catch (error) {
        if (error.status === 401) { renderLogin(); return; }
        main.innerHTML = '<div class="card auth-card"><h2>Fleet service unavailable</h2><p class="text-danger">' + App.esc(error.message) + '</p><button class="btn" id="retry-load">Retry</button></div>';
        document.getElementById('retry-load').addEventListener('click', () => location.reload());
        return;
      }
      const who = document.getElementById('signed-in-user');
      who.innerHTML = '<strong>' + App.esc(identity.displayName) + '</strong><span>' + App.esc(identity.role) + '</span>';
      document.getElementById('session-controls').hidden = false;
      document.getElementById('password-button').addEventListener('click', () => passwordModal(false));
      document.getElementById('logout-button').addEventListener('click', async () => {
        try { await DB.logout(); location.hash = ''; location.reload(); }
        catch (error) { App.toast(error.message, true); }
      });
      window.addEventListener('hashchange', render);
      render();
      if (identity.mustChangePassword) passwordModal(true);

      function render() {
        const currentRole = App.currentRole();
        modules.sort((a, b) => (a.order || 99) - (b.order || 99));
        const nav = document.getElementById('app-nav'); nav.innerHTML = '';
        const visible = modules.filter(m => !m.roles || currentRole === 'Fleet Administrator' || m.roles.includes(currentRole));
        const parts = (location.hash || '#/dashboard').slice(2).split('/');
        const activeId = parts[0] || 'dashboard';
        visible.forEach(m => {
          const a = App.el('<a href="#/' + m.id + '"' + (m.id === activeId ? ' class="active"' : '') + '>' + App.esc(m.title) + '</a>');
          nav.appendChild(a);
        });
        const main = document.getElementById('app-main'); main.innerHTML = '';
        const mod = modules.find(m => m.id === activeId) || modules.find(m => m.id === 'dashboard') || visible[0];
        if (!mod) { main.textContent = 'No modules loaded.'; return; }
        if (mod.roles && currentRole !== 'Fleet Administrator' && !mod.roles.includes(currentRole)) {
          main.innerHTML = '<div class="card"><h3>Not authorized</h3><p class="text-muted">The ' + App.esc(currentRole) + ' role does not have access to this page.</p></div>';
          return;
        }
        try { mod.render(main, parts.slice(1)); }
        catch (e) { console.error(e); main.innerHTML = '<div class="card"><h3>Error</h3><pre>' + App.esc(e.stack || e.message) + '</pre></div>'; }
      }
    },
    renderLogin() {
      renderLogin();
    },
  };

  function renderLogin() {
    identity = null;
    document.getElementById('app-nav').innerHTML = '';
    document.getElementById('session-controls').hidden = true;
    const main = document.getElementById('app-main');
    main.innerHTML = '<section class="card auth-card"><h2>Fleet sign in</h2><p class="text-muted">Use your hospital fleet account to continue.</p><form id="login-form"><div class="field"><label for="login-user">Username</label><input id="login-user" name="username" autocomplete="username" required></div><div class="field"><label for="login-password">Password</label><input id="login-password" name="password" type="password" autocomplete="current-password" required></div><p id="login-error" class="text-danger" role="alert"></p><button class="btn" type="submit">Sign in</button></form></section>';
    const form = document.getElementById('login-form');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const button = form.querySelector('button'); const errorBox = document.getElementById('login-error');
      button.disabled = true; errorBox.textContent = '';
      try {
        await DB.login(form.username.value.trim(), form.password.value);
        location.reload();
      } catch (error) {
        errorBox.textContent = error.message; button.disabled = false;
      }
    });
    form.username.focus();
  }

  function passwordModal(required) {
    const form = App.form([
      { name: 'currentPassword', label: 'Current password', type: 'password', required: true },
      { name: 'newPassword', label: 'New password', type: 'password', required: true, hint: 'At least 14 characters, including letters and numbers' },
      { name: 'confirmPassword', label: 'Confirm new password', type: 'password', required: true },
    ]);
    App.modal({
      title: required ? 'Set a new password to secure this account' : 'Change password', body: form.el,
      actions: [
        { label: required ? 'Sign out' : 'Cancel', cls: 'ghost', onClick: async close => {
          if (!required) { close(); return; }
          try { await DB.logout(); location.reload(); } catch (error) { App.toast(error.message, true); }
        } },
        { label: 'Update password', onClick: async close => {
          if (!form.validate()) return;
          const values = form.read();
          if (values.newPassword !== values.confirmPassword) return App.toast('New passwords do not match.', true);
          try { await DB.changePassword(values.currentPassword, values.newPassword); close(); App.toast('Password updated.'); }
          catch (error) { App.toast(error.message, true); }
        } },
      ],
    });
  }

  window.App = App;
})();
