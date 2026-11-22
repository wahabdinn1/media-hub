CREATE TABLE `provider_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_connection_id` text NOT NULL,
	`external_id` text NOT NULL,
	`name` text NOT NULL,
	`parent_external_id` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`provider_connection_id`) REFERENCES `provider_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_folders_conn_ext` ON `provider_folders` (`provider_connection_id`,`external_id`);