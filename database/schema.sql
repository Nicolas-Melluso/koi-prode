CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(190) NOT NULL,
  username VARCHAR(80) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(120) NOT NULL,
  last_name VARCHAR(120) NOT NULL,
  role ENUM('USER', 'ADMIN') NOT NULL DEFAULT 'USER',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY users_email_unique (email),
  UNIQUE KEY users_username_unique (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_areas (
  user_id BIGINT UNSIGNED NOT NULL,
  area ENUM('LABS', 'TECH', 'ECOSYSTEM', 'GERENCIA') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, area),
  CONSTRAINT user_areas_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teams (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  external_id VARCHAR(80) NULL,
  source VARCHAR(80) NOT NULL DEFAULT 'manual',
  name VARCHAR(160) NOT NULL,
  code VARCHAR(20) NULL,
  group_name VARCHAR(8) NULL,
  flag_url VARCHAR(500) NULL,
  raw_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY teams_source_external_unique (source, external_id),
  KEY teams_code_idx (code),
  KEY teams_group_idx (group_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS matches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  external_id VARCHAR(80) NULL,
  source VARCHAR(80) NOT NULL DEFAULT 'manual',
  match_number INT NULL,
  stage ENUM('group', 'r32', 'r16', 'qf', 'sf', 'third', 'final') NOT NULL,
  group_name VARCHAR(8) NULL,
  home_team_id BIGINT UNSIGNED NULL,
  away_team_id BIGINT UNSIGNED NULL,
  home_placeholder VARCHAR(160) NULL,
  away_placeholder VARCHAR(160) NULL,
  kickoff_at DATETIME NULL,
  api_local_date VARCHAR(80) NULL,
  stadium_name VARCHAR(180) NULL,
  status VARCHAR(60) NOT NULL DEFAULT 'scheduled',
  home_score INT NULL,
  away_score INT NULL,
  finished TINYINT(1) NOT NULL DEFAULT 0,
  prediction_closes_at DATETIME NULL,
  raw_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY matches_source_external_unique (source, external_id),
  KEY matches_stage_idx (stage),
  KEY matches_kickoff_idx (kickoff_at),
  KEY matches_home_team_fk_idx (home_team_id),
  KEY matches_away_team_fk_idx (away_team_id),
  CONSTRAINT matches_home_team_fk FOREIGN KEY (home_team_id) REFERENCES teams(id) ON DELETE SET NULL,
  CONSTRAINT matches_away_team_fk FOREIGN KEY (away_team_id) REFERENCES teams(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS match_predictions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  match_id BIGINT UNSIGNED NOT NULL,
  predicted_home_team_id BIGINT UNSIGNED NULL,
  predicted_away_team_id BIGINT UNSIGNED NULL,
  predicted_home_score INT NOT NULL,
  predicted_away_score INT NOT NULL,
  submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  auto_filled TINYINT(1) NOT NULL DEFAULT 0,
  points INT NOT NULL DEFAULT 0,
  exact_hit TINYINT(1) NOT NULL DEFAULT 0,
  outcome_hit TINYINT(1) NOT NULL DEFAULT 0,
  difference_hit TINYINT(1) NOT NULL DEFAULT 0,
  home_goals_hit TINYINT(1) NOT NULL DEFAULT 0,
  away_goals_hit TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY match_predictions_user_match_unique (user_id, match_id),
  KEY match_predictions_match_idx (match_id),
  KEY match_predictions_predicted_home_team_idx (predicted_home_team_id),
  KEY match_predictions_predicted_away_team_idx (predicted_away_team_id),
  CONSTRAINT match_predictions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT match_predictions_match_fk FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  CONSTRAINT match_predictions_predicted_home_team_fk FOREIGN KEY (predicted_home_team_id) REFERENCES teams(id) ON DELETE SET NULL,
  CONSTRAINT match_predictions_predicted_away_team_fk FOREIGN KEY (predicted_away_team_id) REFERENCES teams(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tournament_predictions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  champion_team_id BIGINT UNSIGNED NOT NULL,
  finalist1_team_id BIGINT UNSIGNED NOT NULL,
  finalist2_team_id BIGINT UNSIGNED NOT NULL,
  lock_tier ENUM('early', 'before_r32', 'before_qf') NOT NULL,
  locked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  champion_hit TINYINT(1) NOT NULL DEFAULT 0,
  finalist_hits INT NOT NULL DEFAULT 0,
  champion_points INT NOT NULL DEFAULT 0,
  finalist_points INT NOT NULL DEFAULT 0,
  points_awarded INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY tournament_predictions_user_unique (user_id),
  KEY tournament_predictions_champion_idx (champion_team_id),
  KEY tournament_predictions_finalist1_idx (finalist1_team_id),
  KEY tournament_predictions_finalist2_idx (finalist2_team_id),
  CONSTRAINT tournament_predictions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT tournament_predictions_champion_fk FOREIGN KEY (champion_team_id) REFERENCES teams(id) ON DELETE RESTRICT,
  CONSTRAINT tournament_predictions_finalist1_fk FOREIGN KEY (finalist1_team_id) REFERENCES teams(id) ON DELETE RESTRICT,
  CONSTRAINT tournament_predictions_finalist2_fk FOREIGN KEY (finalist2_team_id) REFERENCES teams(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scores (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  match_points INT NOT NULL DEFAULT 0,
  streak_bonus_points INT NOT NULL DEFAULT 0,
  tournament_points INT NOT NULL DEFAULT 0,
  total_points INT NOT NULL DEFAULT 0,
  exact_count INT NOT NULL DEFAULT 0,
  outcome_count INT NOT NULL DEFAULT 0,
  max_streak INT NOT NULL DEFAULT 0,
  champion_correct TINYINT(1) NOT NULL DEFAULT 0,
  finalist_correct_count INT NOT NULL DEFAULT 0,
  last_recalculated_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY scores_user_unique (user_id),
  KEY scores_rank_idx (total_points, exact_count, max_streak, outcome_count),
  CONSTRAINT scores_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(160) NOT NULL,
  body TEXT NOT NULL,
  channel ENUM('banner', 'email', 'banner_email') NOT NULL DEFAULT 'banner',
  target_area ENUM('LABS', 'TECH', 'ECOSYSTEM', 'GERENCIA') NULL,
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,
  email_status ENUM('not_requested', 'pending', 'sent', 'failed') NOT NULL DEFAULT 'not_requested',
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY notifications_active_idx (starts_at, ends_at),
  KEY notifications_area_idx (target_area),
  CONSTRAINT notifications_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id BIGINT UNSIGNED NULL,
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(80) NULL,
  payload JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY admin_audit_actor_idx (actor_user_id),
  KEY admin_audit_entity_idx (entity_type, entity_id),
  CONSTRAINT admin_audit_actor_fk FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
