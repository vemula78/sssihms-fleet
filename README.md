# SSSIHMS Fleet

Transport and ambulance fleet management for SSSIHMS Whitefield. The browser application is backed by PHP 8.3 and MySQL 8 on the hospital VM.

## Runtime

- Apache serves the application below `/fleet`.
- `api/index.php` provides authenticated JSON endpoints.
- PHP sessions use secure, HTTP-only, SameSite cookies; state-changing requests require a CSRF token.
- Server-side authorization covers fleet administrators, transport managers, ambulance coordinators, drivers, maintenance, finance, vendors, and management viewers.
- MySQL stores fleet records, settings, counters, users, login throttling, and audit history.

## First installation

1. Copy `api/config.example.php` to the server-only `api/config.php` and set the database connection.
2. Run the installer from the command line:

   ```sh
   php api/bin/install.php \
     --admin-user=fleetadmin \
     --admin-password-file=/path/to/protected/password-file \
     --admin-name='Fleet Administrator' \
     --seed=api/seed.json
   ```

3. Ensure Apache permits `.htaccess` overrides and PHP execution for the deployment directory.
4. Sign in and change the generated administrator password immediately.

`api/config.php` is intentionally ignored by Git and denied by Apache. The installer is CLI-only, and its directory is blocked from web access.

## Validation

```sh
for file in js/*.js js/modules/*.js; do node --check "$file"; done
for file in api/*.php api/bin/*.php; do php -l "$file"; done
node --test tests/rules.test.js
```
