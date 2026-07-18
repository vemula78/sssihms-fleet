CREATE TABLE IF NOT EXISTS fleet_users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(80) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(160) NOT NULL,
  role VARCHAR(80) NOT NULL,
  actor_id VARCHAR(64) NULL,
  vendor_id VARCHAR(64) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY fleet_users_username_uq (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fleet_records (
  collection_name VARCHAR(40) NOT NULL,
  record_id VARCHAR(64) NOT NULL,
  data_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  deleted_at DATETIME(6) NULL,
  PRIMARY KEY (collection_name, record_id),
  KEY fleet_records_live_idx (collection_name, deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fleet_settings (
  settings_id TINYINT UNSIGNED NOT NULL,
  data_json JSON NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (settings_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fleet_counters (
  counter_name VARCHAR(40) NOT NULL,
  counter_value BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (counter_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fleet_audit (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NULL,
  username VARCHAR(80) NOT NULL,
  action_name VARCHAR(40) NOT NULL,
  collection_name VARCHAR(40) NOT NULL,
  record_id VARCHAR(64) NOT NULL,
  old_json JSON NULL,
  new_json JSON NULL,
  ip_address VARCHAR(64) NULL,
  created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  KEY fleet_audit_record_idx (collection_name, record_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fleet_login_attempts (
  attempt_key CHAR(64) NOT NULL,
  attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  last_attempt DATETIME(6) NOT NULL,
  blocked_until DATETIME(6) NULL,
  PRIMARY KEY (attempt_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
