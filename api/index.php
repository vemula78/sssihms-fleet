<?php
declare(strict_types=1);

require_once __DIR__ . '/lib.php';
fleet_headers();

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$route = trim((string)($_GET['route'] ?? $_SERVER['PATH_INFO'] ?? ''), '/');

if ($method === 'OPTIONS') fleet_json([], 204);

try {
    if ($route === 'health' && $method === 'GET') {
        fleet_db()->query('SELECT 1');
        fleet_json(['ok' => true, 'service' => 'sssihms-fleet-api']);
    }

    if ($route === 'auth/login' && $method === 'POST') {
        $input = fleet_input();
        $username = strtolower(trim((string)($input['username'] ?? '')));
        $password = (string)($input['password'] ?? '');
        if ($username === '' || $password === '') fleet_error('Username and password are required.', 422, 'validation_failed');
        $key = hash('sha256', substr((string)($_SERVER['REMOTE_ADDR'] ?? ''), 0, 64) . '|' . $username);
        $attempt = fleet_db()->prepare('SELECT attempts, blocked_until FROM fleet_login_attempts WHERE attempt_key = ?');
        $attempt->execute([$key]);
        $state = $attempt->fetch();
        if ($state && $state['blocked_until'] && strtotime($state['blocked_until']) > time()) {
            fleet_error('Too many login attempts. Try again later.', 429, 'rate_limited');
        }
        $stmt = fleet_db()->prepare('SELECT * FROM fleet_users WHERE username = ? AND active = 1 LIMIT 1');
        $stmt->execute([$username]);
        $user = $stmt->fetch();
        if (!$user || !password_verify($password, $user['password_hash'])) {
            $attempts = (int)($state['attempts'] ?? 0) + 1;
            $blocked = $attempts >= 5 ? date('Y-m-d H:i:s.u', time() + 900) : null;
            $up = fleet_db()->prepare('INSERT INTO fleet_login_attempts (attempt_key, attempts, last_attempt, blocked_until) VALUES (?, ?, NOW(6), ?) ON DUPLICATE KEY UPDATE attempts = VALUES(attempts), last_attempt = NOW(6), blocked_until = VALUES(blocked_until)');
            $up->execute([$key, $attempts, $blocked]);
            usleep(250000);
            fleet_error('Invalid username or password.', 401, 'invalid_credentials');
        }
        fleet_db()->prepare('DELETE FROM fleet_login_attempts WHERE attempt_key = ?')->execute([$key]);
        fleet_session_start();
        session_regenerate_id(true);
        $_SESSION['fleet_user_id'] = (int)$user['id'];
        $_SESSION['fleet_csrf'] = bin2hex(random_bytes(32));
        fleet_json(['user' => fleet_public_user($user), 'csrfToken' => fleet_csrf()]);
    }

    if ($route === 'auth/logout' && $method === 'POST') {
        fleet_user();
        fleet_require_csrf();
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $p = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'] ?? '', (bool)$p['secure'], (bool)$p['httponly']);
        }
        session_destroy();
        fleet_json(['ok' => true]);
    }

    if ($route === 'auth/me' && $method === 'GET') {
        $user = fleet_user(false);
        fleet_json($user ? ['user' => fleet_public_user($user), 'csrfToken' => fleet_csrf()] : ['user' => null], $user ? 200 : 401);
    }

    $user = fleet_user();

    if ($route === 'auth/change-password' && $method === 'POST') {
        fleet_require_csrf();
        $input = fleet_input();
        $current = (string)($input['currentPassword'] ?? '');
        $next = (string)($input['newPassword'] ?? '');
        if (strlen($next) < 14 || !preg_match('/[A-Za-z]/', $next) || !preg_match('/\d/', $next)) {
            fleet_error('New password must be at least 14 characters and include letters and numbers.', 422, 'weak_password');
        }
        $stmt = fleet_db()->prepare('SELECT password_hash FROM fleet_users WHERE id = ?');
        $stmt->execute([(int)$user['id']]);
        if (!password_verify($current, (string)$stmt->fetchColumn())) fleet_error('Current password is incorrect.', 401, 'invalid_credentials');
        fleet_db()->prepare('UPDATE fleet_users SET password_hash = ?, must_change_password = 0, updated_at = NOW(6) WHERE id = ?')->execute([password_hash($next, PASSWORD_DEFAULT), (int)$user['id']]);
        fleet_audit($user, 'password changed', 'users', (string)$user['id'], null, null);
        fleet_json(['ok' => true]);
    }

    if ((bool)($user['must_change_password'] ?? false) && !in_array($method, ['GET', 'HEAD'], true)) {
        fleet_error('Change your temporary password before making changes.', 403, 'password_change_required');
    }

    if ($route === 'bootstrap' && $method === 'GET') {
        $store = [];
        foreach (FLEET_COLLECTIONS as $collection) $store[$collection] = [];
        $stmt = fleet_db()->query('SELECT collection_name, data_json FROM fleet_records WHERE deleted_at IS NULL ORDER BY collection_name, created_at');
        foreach ($stmt as $row) {
            $record = json_decode($row['data_json'], true, 128, JSON_THROW_ON_ERROR);
            if (fleet_filter_visible($user, $row['collection_name'], $record)) {
                $store[$row['collection_name']][] = fleet_sanitize_visible($user, $row['collection_name'], $record);
            }
        }
        if ($user['role'] !== 'Vendor' && $user['role'] !== 'Driver') {
            $auditSql = 'SELECT id, username AS user, created_at AS timestamp, action_name AS action, collection_name AS entityType, record_id AS entityId, old_json AS oldValue, new_json AS newValue FROM fleet_audit';
            if ($user['role'] !== 'Fleet Administrator') $auditSql .= " WHERE collection_name <> 'users'";
            $audit = fleet_db()->query($auditSql . ' ORDER BY id DESC LIMIT 2000');
            $store['auditLog'] = $audit->fetchAll();
        }
        $settingsRow = fleet_db()->query('SELECT data_json FROM fleet_settings WHERE settings_id = 1')->fetch();
        $store['settings'] = $settingsRow ? json_decode($settingsRow['data_json'], true, 64, JSON_THROW_ON_ERROR) : [];
        fleet_json(['store' => $store, 'user' => fleet_public_user($user), 'csrfToken' => fleet_csrf()]);
    }

    if ($route === 'next-number' && $method === 'POST') {
        fleet_require_csrf();
        $input = fleet_input();
        $name = preg_replace('/[^a-zA-Z0-9_-]/', '', (string)($input['key'] ?? ''));
        $prefix = preg_replace('/[^A-Z0-9-]/', '', strtoupper((string)($input['prefix'] ?? '')));
        if ($name === '' || $prefix === '') fleet_error('Counter key and prefix are required.', 422, 'validation_failed');
        $pdo = fleet_db();
        $pdo->beginTransaction();
        $pdo->prepare('INSERT INTO fleet_counters (counter_name, counter_value) VALUES (?, 0) ON DUPLICATE KEY UPDATE counter_name = counter_name')->execute([$name]);
        $stmt = $pdo->prepare('SELECT counter_value FROM fleet_counters WHERE counter_name = ? FOR UPDATE');
        $stmt->execute([$name]);
        $next = (int)$stmt->fetchColumn() + 1;
        $pdo->prepare('UPDATE fleet_counters SET counter_value = ? WHERE counter_name = ?')->execute([$next, $name]);
        $pdo->commit();
        fleet_json(['number' => $prefix . '-' . str_pad((string)$next, 4, '0', STR_PAD_LEFT)]);
    }

    if ($route === 'settings' && $method === 'PATCH') {
        fleet_require_csrf();
        if ($user['role'] !== 'Fleet Administrator') fleet_error('Not authorized.', 403, 'forbidden');
        $patch = fleet_input();
        $row = fleet_db()->query('SELECT data_json FROM fleet_settings WHERE settings_id = 1')->fetch();
        $old = $row ? json_decode($row['data_json'], true, 64, JSON_THROW_ON_ERROR) : [];
        $new = array_replace($old, $patch);
        fleet_db()->prepare('INSERT INTO fleet_settings (settings_id, data_json, updated_at) VALUES (1, ?, NOW(6)) ON DUPLICATE KEY UPDATE data_json = VALUES(data_json), updated_at = NOW(6)')->execute([json_encode($new, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
        fleet_audit($user, 'edited', 'settings', '1', $old, $new);
        fleet_json(['settings' => $new]);
    }

    if ($route === 'users' && $method === 'GET') {
        fleet_require_admin($user);
        $rows = fleet_db()->query('SELECT id, username, display_name, email, role, actor_id, vendor_id, active, must_change_password, created_at, updated_at FROM fleet_users ORDER BY active DESC, display_name, username')->fetchAll();
        fleet_json(['users' => array_map('fleet_public_managed_user', $rows)]);
    }

    if ($route === 'users' && $method === 'POST') {
        fleet_require_csrf();
        fleet_require_admin($user);
        $data = fleet_validate_managed_user(fleet_input());
        $temporaryPassword = fleet_temporary_password();
        $stmt = fleet_db()->prepare('INSERT INTO fleet_users (username, password_hash, display_name, email, role, actor_id, vendor_id, active, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(6), NOW(6))');
        $stmt->execute([
            $data['username'], password_hash($temporaryPassword, PASSWORD_DEFAULT), $data['displayName'],
            $data['email'], $data['role'], $data['actorId'], $data['vendorId'], $data['active'] ? 1 : 0,
        ]);
        $created = fleet_managed_user((int)fleet_db()->lastInsertId());
        $public = fleet_public_managed_user($created);
        fleet_audit($user, 'user created', 'users', (string)$created['id'], null, $public);
        fleet_json(['user' => $public, 'temporaryPassword' => $temporaryPassword], 201);
    }

    if (preg_match('#^users/(\d+)(?:/(reset-password))?$#', $route, $match)) {
        fleet_require_admin($user);
        $targetId = (int)$match[1];
        $target = fleet_managed_user($targetId);
        if (!$target) fleet_error('User not found.', 404, 'not_found');

        if ($method === 'PATCH' && empty($match[2])) {
            fleet_require_csrf();
            $input = fleet_input();
            $merged = [
                'username' => $target['username'],
                'displayName' => $input['displayName'] ?? $target['display_name'],
                'email' => array_key_exists('email', $input) ? $input['email'] : $target['email'],
                'role' => $input['role'] ?? $target['role'],
                'actorId' => array_key_exists('actorId', $input) ? $input['actorId'] : $target['actor_id'],
                'vendorId' => array_key_exists('vendorId', $input) ? $input['vendorId'] : $target['vendor_id'],
                'active' => array_key_exists('active', $input) ? $input['active'] : (bool)$target['active'],
            ];
            $data = fleet_validate_managed_user($merged, $targetId);
            if ($targetId === (int)$user['id'] && (!$data['active'] || $data['role'] !== 'Fleet Administrator')) {
                fleet_error('You cannot disable or remove administrator access from your own account.', 409, 'self_lockout_prevented');
            }
            $old = fleet_public_managed_user($target);
            fleet_db()->prepare('UPDATE fleet_users SET display_name = ?, email = ?, role = ?, actor_id = ?, vendor_id = ?, active = ?, updated_at = NOW(6) WHERE id = ?')->execute([
                $data['displayName'], $data['email'], $data['role'], $data['actorId'], $data['vendorId'], $data['active'] ? 1 : 0, $targetId,
            ]);
            $updated = fleet_public_managed_user(fleet_managed_user($targetId));
            fleet_audit($user, 'user updated', 'users', (string)$targetId, $old, $updated);
            fleet_json(['user' => $updated]);
        }

        if ($method === 'POST' && ($match[2] ?? '') === 'reset-password') {
            fleet_require_csrf();
            if ($targetId === (int)$user['id']) fleet_error('Use Change password for your own account.', 409, 'self_reset_prevented');
            $temporaryPassword = fleet_temporary_password();
            fleet_db()->prepare('UPDATE fleet_users SET password_hash = ?, must_change_password = 1, updated_at = NOW(6) WHERE id = ?')->execute([
                password_hash($temporaryPassword, PASSWORD_DEFAULT), $targetId,
            ]);
            fleet_audit($user, 'password reset', 'users', (string)$targetId, null, null);
            fleet_json(['user' => fleet_public_managed_user(fleet_managed_user($targetId)), 'temporaryPassword' => $temporaryPassword]);
        }
    }

    if (preg_match('#^records/([A-Za-z]+)/?([A-Za-z0-9_-]+)?$#', $route, $m)) {
        $collection = fleet_collection($m[1]);
        $id = $m[2] ?? null;
        if ($method === 'POST' && !$id) {
            fleet_require_csrf();
            $data = fleet_input();
            if (!fleet_can_write($user, $collection, 'create', null, $data)) fleet_error('Not authorized.', 403, 'forbidden');
            $id = preg_replace('/[^A-Za-z0-9_-]/', '', (string)($data['id'] ?? '')) ?: bin2hex(random_bytes(12));
            $now = gmdate('Y-m-d\TH:i:s.v\Z');
            $record = array_replace($data, ['id' => $id, 'createdAt' => $now, 'updatedAt' => $now, 'deleted' => false]);
            $stmt = fleet_db()->prepare('INSERT INTO fleet_records (collection_name, record_id, data_json, created_at, updated_at, deleted_at) VALUES (?, ?, ?, NOW(6), NOW(6), NULL)');
            $stmt->execute([$collection, $id, json_encode($record, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
            fleet_audit($user, 'created', $collection, $id, null, $record);
            fleet_json(['record' => $record], 201);
        }
        if ($method === 'PATCH' && $id) {
            fleet_require_csrf();
            $old = fleet_record($collection, $id);
            if (!$old) fleet_error('Record not found.', 404, 'not_found');
            $patch = fleet_input();
            unset($patch['id'], $patch['createdAt'], $patch['deleted']);
            if (!fleet_can_write($user, $collection, 'update', $old, $patch)) fleet_error('Not authorized.', 403, 'forbidden');
            $new = array_replace($old, $patch, ['updatedAt' => gmdate('Y-m-d\TH:i:s.v\Z')]);
            fleet_db()->prepare('UPDATE fleet_records SET data_json = ?, updated_at = NOW(6) WHERE collection_name = ? AND record_id = ? AND deleted_at IS NULL')->execute([json_encode($new, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $collection, $id]);
            fleet_audit($user, 'edited', $collection, $id, $old, $new);
            fleet_json(['record' => $new]);
        }
        if ($method === 'DELETE' && $id) {
            fleet_require_csrf();
            $old = fleet_record($collection, $id);
            if (!$old) fleet_error('Record not found.', 404, 'not_found');
            if (!fleet_can_write($user, $collection, 'delete', $old, [])) fleet_error('Not authorized.', 403, 'forbidden');
            $new = array_replace($old, ['deleted' => true, 'updatedAt' => gmdate('Y-m-d\TH:i:s.v\Z')]);
            fleet_db()->prepare('UPDATE fleet_records SET data_json = ?, updated_at = NOW(6), deleted_at = NOW(6) WHERE collection_name = ? AND record_id = ?')->execute([json_encode($new, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $collection, $id]);
            fleet_audit($user, 'deleted', $collection, $id, $old, null);
            fleet_json(['ok' => true]);
        }
    }

    fleet_error('Endpoint not found.', 404, 'not_found');
} catch (PDOException $e) {
    error_log('Fleet API database error: ' . $e->getMessage());
    try { $db = fleet_db(); if ($db->inTransaction()) $db->rollBack(); } catch (Throwable) { /* connection unavailable */ }
    fleet_error('Database operation failed.', 500, 'database_error');
} catch (Throwable $e) {
    error_log('Fleet API error: ' . $e->getMessage());
    fleet_error('Unexpected server error.', 500, 'server_error');
}
