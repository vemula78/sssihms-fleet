<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') exit("CLI only\n");
require_once dirname(__DIR__) . '/lib.php';

$options = getopt('', ['admin-user:', 'admin-password::', 'admin-password-file::', 'admin-name::', 'seed::']);
$username = strtolower(trim((string)($options['admin-user'] ?? '')));
$password = (string)($options['admin-password'] ?? '');
if ($password === '' && !empty($options['admin-password-file'])) {
    $password = trim((string)file_get_contents((string)$options['admin-password-file']));
}
$name = trim((string)($options['admin-name'] ?? 'Fleet Administrator'));
$seedPath = (string)($options['seed'] ?? dirname(__DIR__) . '/seed.json');
if ($username === '' || strlen($password) < 14) {
    fwrite(STDERR, "Usage: php install.php --admin-user=NAME (--admin-password='14+ chars' | --admin-password-file=/protected/file) [--admin-name='Name'] [--seed=path]\n");
    exit(2);
}

$pdo = fleet_db();
$sql = file_get_contents(dirname(__DIR__) . '/install.sql');
if ($sql === false) throw new RuntimeException('Cannot read install.sql');
foreach (array_filter(array_map('trim', preg_split('/;\s*(?:\r?\n|$)/', $sql))) as $statement) $pdo->exec($statement);

$now = date('Y-m-d H:i:s.u');
$stmt = $pdo->prepare('INSERT INTO fleet_users (username, password_hash, display_name, role, active, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), display_name = VALUES(display_name), role = VALUES(role), active = 1, must_change_password = 1, updated_at = VALUES(updated_at)');
$stmt->execute([$username, password_hash($password, PASSWORD_DEFAULT), $name, 'Fleet Administrator', $now, $now]);

$count = (int)$pdo->query('SELECT COUNT(*) FROM fleet_records')->fetchColumn();
if ($count === 0 && is_file($seedPath)) {
    $seed = json_decode((string)file_get_contents($seedPath), true, 128, JSON_THROW_ON_ERROR);
    $pdo->beginTransaction();
    $insert = $pdo->prepare('INSERT INTO fleet_records (collection_name, record_id, data_json, created_at, updated_at, deleted_at) VALUES (?, ?, ?, NOW(6), NOW(6), NULL)');
    foreach (FLEET_COLLECTIONS as $collection) {
        if ($collection === 'auditLog') continue;
        foreach (($seed[$collection] ?? []) as $record) {
            $insert->execute([$collection, $record['id'], json_encode($record, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
        }
    }
    $settings = $seed['settings'] ?? [];
    $pdo->prepare('INSERT INTO fleet_settings (settings_id, data_json, updated_at) VALUES (1, ?, NOW(6)) ON DUPLICATE KEY UPDATE data_json = VALUES(data_json), updated_at = NOW(6)')->execute([json_encode($settings, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
    foreach (($seed['counters'] ?? []) as $key => $value) {
        $pdo->prepare('INSERT INTO fleet_counters (counter_name, counter_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE counter_value = GREATEST(counter_value, VALUES(counter_value))')->execute([$key, (int)$value]);
    }
    $pdo->commit();
}

echo "Fleet database installed.\n";
