CREATE TABLE `subtitles` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`provider_connection_id` text,
	`language` text NOT NULL,
	`format` text NOT NULL,
	`source_url` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_connection_id`) REFERENCES `provider_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_subtitles_asset_id` ON `subtitles` (`asset_id`);--> statement-breakpoint
CREATE TABLE `workflow_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`trigger_source` text DEFAULT 'manual' NOT NULL,
	`step_results_json` text DEFAULT '[]' NOT NULL,
	`error_message` text,
	`started_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_workflow_runs_workflow_started` ON `workflow_runs` (`workflow_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`trigger_type` text DEFAULT 'manual' NOT NULL,
	`steps_json` text DEFAULT '[]' NOT NULL,
	`last_run_at` text,
	`next_run_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
