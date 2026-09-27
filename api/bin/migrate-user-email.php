<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') exit("CLI only\n");
require_once dirname(__DIR__) . '/lib.php';

$pdo = fleet_db();
$column = $pdo->query("SHOW COLUMNS FROM fleet_users LIKE 'email'")->fetch();
if (!$column) {
    $pdo->exec('ALTER TABLE fleet_users ADD COLUMN email VARCHAR(254) NULL AFTER display_name');
}
$index = $pdo->query("SHOW INDEX FROM fleet_users WHERE Key_name = 'fleet_users_email_uq'")->fetch();
if (!$index) {
    $pdo->exec('ALTER TABLE fleet_users ADD UNIQUE KEY fleet_users_email_uq (email)');
}
echo "Fleet user email migration complete.\n";
