<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') exit("CLI only\n");
$options = getopt('', ['source:', 'output:', 'base-path::']);
$source = (string)($options['source'] ?? '');
$output = (string)($options['output'] ?? '');
$basePath = (string)($options['base-path'] ?? '/fleet');
if ($source === '' || $output === '' || !is_file($source)) {
    fwrite(STDERR, "Usage: php configure-server.php --source=/protected/config.php --output=/release/api/config.php [--base-path=/fleet]\n");
    exit(2);
}

require $source;
foreach (['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASS'] as $name) {
    if (!defined($name)) throw new RuntimeException("Source config is missing {$name}");
}
$dsn = 'mysql:host=' . constant('DB_HOST') . ';dbname=' . constant('DB_NAME') . ';charset=utf8mb4';
$config = "<?php\ndeclare(strict_types=1);\n\n"
    . 'define(\'FLEET_DB_DSN\', ' . var_export($dsn, true) . ");\n"
    . 'define(\'FLEET_DB_USER\', ' . var_export((string)constant('DB_USER'), true) . ");\n"
    . 'define(\'FLEET_DB_PASS\', ' . var_export((string)constant('DB_PASS'), true) . ");\n"
    . 'define(\'FLEET_BASE_PATH\', ' . var_export($basePath, true) . ");\n"
    . "define('FLEET_SESSION_NAME', 'sssihms_fleet_session');\n"
    . "define('FLEET_SESSION_TTL', 28800);\n";
if (file_put_contents($output, $config, LOCK_EX) === false) throw new RuntimeException('Could not write fleet config');
chmod($output, 0640);
echo "Fleet server config created.\n";
