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
    'trips.drive':       ['Driver','Transport Manager','Ambulance Coordinator'],
    'fuel.enter':        ['Driver','Transport Manager'],
    'fuel.verify':       ['Transport Manager','Finance User'],
    'maintenance.manage':['Maintenance Team','Transport Manager'],
    'vendor.update':     ['Vendor','Maintenance Team','Transport Manager'],
    'finance.view':      ['Finance User','Transport Manager','Management Viewer'],
    'compliance.manage': ['Transport Manager','Maintenance Team'],
    'settings.edit':     [],
    'override':          ['Transport Manager'],
    'readiness.check':   ['Ambulance Coordinator','Driver'],
  };

  let currentRole = localStorage.getItem('sssihms-fleet-role') || 'Fleet Administrator';

  const App = {
    registerModule(m) { modules.push(m); },
    currentRole() { return currentRole; },
    currentUser() { return currentRole; }, // prototype: user == role
    can(action) {
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
    start() {
      // role switcher
      const rs = document.getElementById('role-switcher');
      ROLES.forEach(r => rs.appendChild(new Option(r, r)));
      rs.value = currentRole;
      rs.addEventListener('change', () => {
        currentRole = rs.value; localStorage.setItem('sssihms-fleet-role', currentRole);
        render();
      });
      window.addEventListener('hashchange', render);
      render();

      function render() {
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
  };

  window.App = App;
})();
