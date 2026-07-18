<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';

const FLEET_COLLECTIONS = [
    'vehicles', 'drivers', 'vendors', 'trips', 'fuelLogs', 'pmSchedules',
    'pmRecords', 'breakdowns', 'documents', 'readinessChecks', 'auditLog'
];

function fleet_db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) return $pdo;
    $pdo = new PDO(FLEET_DB_DSN, FLEET_DB_USER, FLEET_DB_PASS, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    return $pdo;
}

function fleet_headers(): void
{
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, private');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: same-origin');
    header("Permissions-Policy: camera=(), microphone=(), geolocation=()");
}

function fleet_session_start(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    session_name(FLEET_SESSION_NAME);
    session_set_cookie_params([
        'lifetime' => FLEET_SESSION_TTL,
        'path' => rtrim(FLEET_BASE_PATH, '/') . '/',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.cookie_httponly', '1');
    ini_set('session.cookie_secure', '1');
    session_start();
}

function fleet_json(mixed $data, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    exit;
}

function fleet_error(string $message, int $status, string $code): never
{
    fleet_json(['error' => $message, 'code' => $code], $status);
}

function fleet_input(): array
{
    $length = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($length > 2_000_000) fleet_error('Request body is too large.', 413, 'payload_too_large');
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') return [];
    try {
        $value = json_decode($raw, true, 128, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        fleet_error('Malformed JSON request.', 400, 'invalid_json');
    }
    if (!is_array($value)) fleet_error('JSON object required.', 400, 'invalid_json');
    return $value;
}

function fleet_user(bool $required = true): ?array
{
    fleet_session_start();
    $id = $_SESSION['fleet_user_id'] ?? null;
    if (!$id) {
        if ($required) fleet_error('Authentication required.', 401, 'unauthenticated');
        return null;
    }
    $stmt = fleet_db()->prepare('SELECT id, username, display_name, role, actor_id, vendor_id, active, must_change_password FROM fleet_users WHERE id = ? LIMIT 1');
    $stmt->execute([(int)$id]);
    $user = $stmt->fetch();
    if (!$user || !(int)$user['active']) {
        $_SESSION = [];
        if ($required) fleet_error('Authentication required.', 401, 'unauthenticated');
        return null;
    }
    return $user;
}

function fleet_csrf(): string
{
    fleet_session_start();
    if (empty($_SESSION['fleet_csrf'])) $_SESSION['fleet_csrf'] = bin2hex(random_bytes(32));
    return (string)$_SESSION['fleet_csrf'];
}

function fleet_require_csrf(): void
{
    $provided = (string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
    if ($provided === '' || !hash_equals(fleet_csrf(), $provided)) {
        fleet_error('Invalid request token.', 403, 'csrf_failed');
    }
}

function fleet_collection(string $value): string
{
    if (!in_array($value, FLEET_COLLECTIONS, true) || $value === 'auditLog') {
        fleet_error('Unknown collection.', 404, 'unknown_collection');
    }
    return $value;
}

function fleet_record(string $collection, string $id, bool $includeDeleted = false): ?array
{
    $sql = 'SELECT data_json FROM fleet_records WHERE collection_name = ? AND record_id = ?';
    if (!$includeDeleted) $sql .= ' AND deleted_at IS NULL';
    $stmt = fleet_db()->prepare($sql . ' LIMIT 1');
    $stmt->execute([$collection, $id]);
    $row = $stmt->fetch();
    return $row ? json_decode($row['data_json'], true, 128, JSON_THROW_ON_ERROR) : null;
}

function fleet_can_write(array $user, string $collection, string $action, ?array $old, array $incoming): bool
{
    $role = $user['role'];
    if ($role === 'Fleet Administrator') return true;
    if (in_array($collection, ['vehicles', 'drivers', 'vendors'], true)) return $role === 'Transport Manager';
    if ($collection === 'documents') return in_array($role, ['Transport Manager', 'Maintenance Team'], true);
    if (in_array($collection, ['pmSchedules', 'pmRecords', 'breakdowns'], true)) {
        if (in_array($role, ['Transport Manager', 'Maintenance Team'], true)) return true;
        if ($role === 'Vendor' && $collection === 'breakdowns' && $action === 'update' && $old && $user['vendor_id']) {
            if (($old['assignedVendorId'] ?? null) !== $user['vendor_id']) return false;
            $allowed = ['status', 'laborCost', 'partsCost', 'towingCost', 'otherCost', 'taxes', 'invoiceNo', 'closureNotes'];
            foreach (array_keys($incoming) as $key) if (!in_array($key, $allowed, true)) return false;
            return ($incoming['status'] ?? '') !== 'closed';
        }
        return false;
    }
    if ($collection === 'trips') {
        if (in_array($role, ['Transport Manager', 'Ambulance Coordinator'], true)) return true;
        if ($role === 'Driver' && $action === 'update' && $old && $user['actor_id'] && ($old['driverId'] ?? null) === $user['actor_id']) {
            $allowed = ['status', 'startAt', 'startOdo', 'endAt', 'endOdo', 'distance', 'waitingMins', 'expenses', 'notes'];
            foreach (array_keys($incoming) as $key) if (!in_array($key, $allowed, true)) return false;
            return in_array(($incoming['status'] ?? ''), ['started', 'completed'], true);
        }
        return false;
    }
    if ($collection === 'fuelLogs') {
        if ($role === 'Transport Manager') return true;
        if ($role === 'Finance User' && $action === 'update' && $old) {
            $allowed = ['status', 'verifiedBy', 'remarks'];
            foreach (array_keys($incoming) as $key) if (!in_array($key, $allowed, true)) return false;
            return in_array(($incoming['status'] ?? ''), ['verified', 'rejected'], true);
        }
        if ($role === 'Driver' && $action === 'create' && $user['actor_id']) {
            return ($incoming['driverId'] ?? null) === $user['actor_id'];
        }
        return false;
    }
    if ($collection === 'readinessChecks') {
        if ($role === 'Ambulance Coordinator') return true;
        return $role === 'Driver' && $user['actor_id'] && ($incoming['checkedByDriverId'] ?? null) === $user['actor_id'];
    }
    return false;
}

function fleet_filter_visible(array $user, string $collection, array $record): bool
{
    if ($user['role'] === 'Vendor') {
        if ($collection === 'breakdowns') return $user['vendor_id'] && ($record['assignedVendorId'] ?? null) === $user['vendor_id'];
        if ($collection === 'pmRecords') return $user['vendor_id'] && ($record['vendorId'] ?? null) === $user['vendor_id'];
        if ($collection === 'vendors') return $user['vendor_id'] && ($record['id'] ?? null) === $user['vendor_id'];
        return $collection === 'vehicles';
    }
    if ($user['role'] === 'Driver') {
        if ($collection === 'trips' || $collection === 'fuelLogs') return $user['actor_id'] && ($record['driverId'] ?? null) === $user['actor_id'];
        if ($collection === 'drivers') return $user['actor_id'] && ($record['id'] ?? null) === $user['actor_id'];
        if ($collection === 'readinessChecks') return $user['actor_id'] && ($record['checkedByDriverId'] ?? null) === $user['actor_id'];
        if (in_array($collection, ['pmSchedules', 'pmRecords', 'breakdowns', 'documents'], true)) return false;
    }
    return true;
}

function fleet_sanitize_visible(array $user, string $collection, array $record): array
{
    if ($user['role'] === 'Vendor' && $collection === 'vehicles') {
        return array_intersect_key($record, array_flip(['id', 'assetCode', 'regNo', 'type', 'status', 'odometer']));
    }
    if ($user['role'] === 'Driver' && $collection === 'vehicles') {
        return array_intersect_key($record, array_flip(['id', 'assetCode', 'regNo', 'type', 'status', 'odometer', 'fuelType', 'tankCapacity', 'baseLocation', 'callSign']));
    }
    return $record;
}

function fleet_audit(array $user, string $action, string $collection, string $recordId, ?array $old, ?array $new): void
{
    $stmt = fleet_db()->prepare('INSERT INTO fleet_audit (user_id, username, action_name, collection_name, record_id, old_json, new_json, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(6))');
    $stmt->execute([
        (int)$user['id'], $user['username'], $action, $collection, $recordId,
        $old ? json_encode($old, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null,
        $new ? json_encode($new, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null,
        substr((string)($_SERVER['REMOTE_ADDR'] ?? ''), 0, 64),
    ]);
}

function fleet_public_user(array $user): array
{
    return [
        'id' => (int)$user['id'], 'username' => $user['username'], 'displayName' => $user['display_name'],
        'role' => $user['role'], 'actorId' => $user['actor_id'], 'vendorId' => $user['vendor_id'],
        'mustChangePassword' => (bool)($user['must_change_password'] ?? false),
    ];
}
