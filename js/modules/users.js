/* SSSIHMS Fleet — administrator user and role management. */
(function () {
  'use strict';

  const ASSIGNABLE_ROLES = App.roles.slice();
  let users = [];

  function linkedIdentity(user) {
    if (user.role === 'Driver') return App.driverName(user.actorId);
    if (user.role === 'Vendor') return App.vendorName(user.vendorId);
    return '—';
  }

  function showTemporaryPassword(username, password, reason) {
    const body = App.el(
      '<div class="credential-panel">' +
      '<p>' + App.esc(reason) + ' for <strong>' + App.esc(username) + '</strong>.</p>' +
      '<p class="text-danger"><strong>This password is shown only once.</strong> Send it securely and ask the user to change it at first sign-in.</p>' +
      '<div class="temporary-password"><code>' + App.esc(password) + '</code></div>' +
      '</div>'
    );
    App.modal({
      title: 'Temporary password',
      body,
      actions: [
        { label: 'Copy password', cls: 'secondary', onClick: async () => {
          try { await navigator.clipboard.writeText(password); App.toast('Temporary password copied.'); }
          catch (_) { App.toast('Copy failed. Select and copy the password manually.', true); }
        } },
        { label: 'I have saved it' },
      ],
    });
  }

  function userForm(existing) {
    const drivers = DB.list('drivers', d => d.active !== false)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(d => ({ value: d.id, label: d.name + ' (' + d.driverId + ')' }));
    const vendors = DB.list('vendors', v => v.active !== false)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(v => ({ value: v.id, label: v.name }));
    const form = App.form([
      { name: 'username', label: 'Username', required: true, hint: 'Lowercase letters, numbers, dots, underscores or hyphens' },
      { name: 'displayName', label: 'Display name', required: true },
      { name: 'role', label: 'Role', type: 'select', options: ASSIGNABLE_ROLES, required: true },
      { name: 'actorId', label: 'Linked driver', type: 'select', options: drivers },
      { name: 'vendorId', label: 'Linked vendor', type: 'select', options: vendors },
      { name: 'active', label: 'Account active', type: 'checkbox', value: true },
    ], existing || { role: 'Management Viewer', active: true });

    const usernameInput = form.inputs.username.input;
    if (existing) {
      usernameInput.disabled = true;
      form.inputs.username.wrap.querySelector('.hint').textContent = 'Username cannot be changed after creation';
    }
    function showIdentityField() {
      const role = form.inputs.role.input.value;
      form.inputs.actorId.wrap.hidden = role !== 'Driver';
      form.inputs.vendorId.wrap.hidden = role !== 'Vendor';
      if (role !== 'Driver') form.inputs.actorId.input.value = '';
      if (role !== 'Vendor') form.inputs.vendorId.input.value = '';
    }
    form.inputs.role.input.addEventListener('change', showIdentityField);
    showIdentityField();
    return form;
  }

  function openEditor(existing, refresh) {
    const form = userForm(existing);
    App.modal({
      title: existing ? 'Edit user — ' + existing.username : 'Create user',
      body: form.el,
      actions: [
        { label: 'Cancel', cls: 'ghost' },
        { label: existing ? 'Save changes' : 'Create user', onClick: async close => {
          if (!form.validate()) return;
          const values = form.read();
          try {
            if (existing) {
              delete values.username;
              await DB.updateUser(existing.id, values);
              close(); App.toast('User updated.'); await refresh();
            } else {
              const result = await DB.createUser(values);
              close(); await refresh();
              showTemporaryPassword(result.user.username, result.temporaryPassword, 'Account created');
            }
          } catch (error) { App.toast(error.message, true); }
        } },
      ],
    });
  }

  function resetPassword(user, refresh) {
    App.modal({
      title: 'Reset password',
      body: '<p>Generate a new temporary password for <strong>' + App.esc(user.username) + '</strong>?</p><p class="text-muted">Their current password will stop working immediately.</p>',
      actions: [
        { label: 'Cancel', cls: 'ghost' },
        { label: 'Reset password', cls: 'danger', onClick: async close => {
          try {
            const result = await DB.resetUserPassword(user.id);
            close(); await refresh();
            showTemporaryPassword(result.user.username, result.temporaryPassword, 'Password reset');
          } catch (error) { App.toast(error.message, true); }
        } },
      ],
    });
  }

  function render(container) {
    if (App.currentRole() !== 'Fleet Administrator') {
      container.innerHTML = '<div class="card"><h3>Not authorized</h3></div>'; return;
    }
    const root = App.el('<div></div>');
    container.appendChild(root);

    async function refresh() {
      root.innerHTML = '<div class="card loading-card"><p>Loading users…</p></div>';
      try { users = await DB.listUsers(); paint(); }
      catch (error) { root.innerHTML = '<div class="card"><h3>Unable to load users</h3><p class="text-danger">' + App.esc(error.message) + '</p></div>'; }
    }

    function paint() {
      root.innerHTML = '';
      const title = App.el('<div class="page-title"><div><h2>Users &amp; Roles</h2><p class="text-muted">Create accounts, assign operational roles, and manage access.</p></div></div>');
      const create = App.el('<button class="btn">+ Create user</button>');
      create.addEventListener('click', () => openEditor(null, refresh));
      title.appendChild(create); root.appendChild(title);

      const summary = App.el('<div class="grid cols-3 mb-1"></div>');
      summary.innerHTML =
        '<div class="card stat"><div class="stat-value">' + users.length + '</div><div class="stat-label">Total accounts</div></div>' +
        '<div class="card stat ok"><div class="stat-value">' + users.filter(u => u.active).length + '</div><div class="stat-label">Active accounts</div></div>' +
        '<div class="card stat warn"><div class="stat-value">' + users.filter(u => u.mustChangePassword).length + '</div><div class="stat-label">Password change pending</div></div>';
      root.appendChild(summary);

      root.appendChild(App.table({
        rows: users,
        empty: 'No user accounts.',
        columns: [
          { key: 'username', label: 'Username' },
          { key: 'displayName', label: 'Name' },
          { key: 'role', label: 'Role', render: u => App.badge(u.role, 'info') },
          { key: 'identity', label: 'Linked record', render: u => App.esc(linkedIdentity(u)) },
          { key: 'active', label: 'Status', render: u => App.badge(u.active ? 'active' : 'inactive') },
          { key: 'mustChangePassword', label: 'Password', render: u => u.mustChangePassword ? App.badge('change pending', 'warn') : App.badge('set', 'ok') },
          { key: 'updatedAt', label: 'Last updated', render: u => App.fmtDateTime(u.updatedAt) },
          { key: 'actions', label: 'Actions', render: u => {
            const wrap = App.el('<div class="row-actions"></div>');
            const edit = App.el('<button class="btn small ghost">Edit</button>');
            edit.addEventListener('click', () => openEditor(u, refresh));
            wrap.appendChild(edit);
            if (u.id !== App.identity().id) {
              const reset = App.el('<button class="btn small secondary">Reset password</button>');
              reset.addEventListener('click', () => resetPassword(u, refresh));
              wrap.appendChild(reset);
            }
            return wrap;
          } },
        ],
      }));
      root.appendChild(App.el('<p class="text-muted user-help">Driver and Vendor roles must be linked to their matching master record. Other roles have organization-wide access according to their permissions.</p>'));
    }

    refresh();
  }

  App.registerModule({ id: 'users', title: 'Users & Roles', order: 8, roles: [], render });
})();
