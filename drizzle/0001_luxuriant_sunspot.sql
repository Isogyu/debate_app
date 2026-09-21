CREATE TABLE `practice_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`mode` text NOT NULL,
	`opponent_variant_id` text NOT NULL,
	`turns` text NOT NULL,
	`feedback` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`opponent_variant_id`) REFERENCES `case_variants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `practice_project_idx` ON `practice_sessions` (`project_id`,`user_id`);