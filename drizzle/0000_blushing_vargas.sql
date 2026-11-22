CREATE TABLE `activity_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`context_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_activity_logs_created_at` ON `activity_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `asset_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`provider_connection_id` text NOT NULL,
	`external_id` text NOT NULL,
	`external_url` text,
	`provider_metadata_json` text DEFAULT '{}' NOT NULL,
	`metadata_schema_version` integer DEFAULT 1 NOT NULL,
	`sync_state` text DEFAULT 'synced' NOT NULL,
	`last_seen_at` text,
	`content_hash` text,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_connection_id`) REFERENCES `provider_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_asset_locations_conn_ext` ON `asset_locations` (`provider_connection_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `idx_asset_locations_asset` ON `asset_locations` (`asset_id`);--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_type` text DEFAULT 'video' NOT NULL,
	`title` text NOT NULL,
	`canonical_status` text DEFAULT 'processing' NOT NULL,
	`size_bytes` integer,
	`duration_seconds` integer,
	`source_url_hash` text,
	`checksum` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_assets_title` ON `assets` (`title`);--> statement-breakpoint
CREATE INDEX `idx_assets_status` ON `assets` (`canonical_status`);--> statement-breakpoint
CREATE INDEX `idx_assets_created_at` ON `assets` (`created_at`);--> statement-breakpoint
CREATE TABLE `batches` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`total_count` integer DEFAULT 0 NOT NULL,
	`completed_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `job_events` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`event_type` text NOT NULL,
	`message` text NOT NULL,
	`data_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_job_events_job_id` ON `job_events` (`job_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text,
	`provider_connection_id` text,
	`job_type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`result_json` text,
	`error_code` text,
	`idempotency_key` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_poll_at` text,
	`scheduled_at` text,
	`started_at` text,
	`finished_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_connection_id`) REFERENCES `provider_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_jobs_idempotency_key` ON `jobs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_jobs_status_created` ON `jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_jobs_batch_id` ON `jobs` (`batch_id`);--> statement-breakpoint
CREATE INDEX `idx_jobs_next_poll_at` ON `jobs` (`next_poll_at`);--> statement-breakpoint
CREATE TABLE `module_settings` (
	`module_key` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider_capabilities` (
	`connection_id` text PRIMARY KEY NOT NULL,
	`descriptor_json` text NOT NULL,
	`descriptor_version` text NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `provider_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `provider_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`service_type` text NOT NULL,
	`provider_key` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`auth_type` text NOT NULL,
	`encrypted_credentials` text NOT NULL,
	`credential_schema_version` integer DEFAULT 1 NOT NULL,
	`key_version` integer DEFAULT 1 NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`last_tested_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_connections_single_default` ON `provider_connections` (`service_type`) WHERE "provider_connections"."is_default" = 1;--> statement-breakpoint
CREATE TABLE `thumbnails` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`source_type` text NOT NULL,
	`r2_object_key` text,
	`source_url` text,
	`is_active` integer DEFAULT false NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_thumbnails_one_active_per_asset` ON `thumbnails` (`asset_id`) WHERE "thumbnails"."is_active" = 1;--> statement-breakpoint
CREATE TABLE `usage_counters` (
	`day` text NOT NULL,
	`metric` text NOT NULL,
	`value` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_usage_counters_day_metric` ON `usage_counters` (`day`,`metric`);