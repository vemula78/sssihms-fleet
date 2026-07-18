<?php
declare(strict_types=1);

// Copy to config.php on the server and keep it outside version control.
define('FLEET_DB_DSN', 'mysql:host=127.0.0.1;dbname=sssihms_master_db;charset=utf8mb4');
define('FLEET_DB_USER', 'CHANGE_ME');
define('FLEET_DB_PASS', 'CHANGE_ME');
define('FLEET_BASE_PATH', '/fleet');
define('FLEET_SESSION_NAME', 'sssihms_fleet_session');
define('FLEET_SESSION_TTL', 28800);
