CREATE TABLE `activity_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`target` text NOT NULL,
	`detail` text,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `logs_project_idx` ON `activity_logs` (`project_id`,`at`);--> statement-breakpoint
CREATE TABLE `api_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`job_id` text,
	`step` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `usage_at_idx` ON `api_usage` (`at`);--> statement-breakpoint
CREATE TABLE `blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`opponent_argument` text NOT NULL,
	`summary` text NOT NULL,
	`category_ids` text NOT NULL,
	`my_rebuttal_ids` text NOT NULL,
	`my_cross_exam_ids` text NOT NULL,
	`my_material_ids` text NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `blocks_project_idx` ON `blocks` (`project_id`);--> statement-breakpoint
CREATE TABLE `case_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`side` text NOT NULL,
	`framework` text NOT NULL,
	`approach` text NOT NULL,
	`debate_case` text NOT NULL,
	`source_refs` text NOT NULL,
	`quality_score` integer,
	`role` text DEFAULT 'candidate' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `variants_project_idx` ON `case_variants` (`project_id`,`side`);--> statement-breakpoint
CREATE TABLE `cross_exam_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`target_variant_id` text,
	`direction` text NOT NULL,
	`target_claim_id` text,
	`question` text NOT NULL,
	`purpose` text DEFAULT '' NOT NULL,
	`category_ids` text NOT NULL,
	`branches` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_variant_id`) REFERENCES `case_variants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cx_project_idx` ON `cross_exam_nodes` (`project_id`,`direction`);--> statement-breakpoint
CREATE TABLE `generation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`variant_id` text,
	`steps` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`started_at` text,
	`finished_at` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `jobs_project_idx` ON `generation_jobs` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `issue_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_project_name_idx` ON `issue_categories` (`project_id`,`name`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`resolution` text NOT NULL,
	`my_side` text NOT NULL,
	`team_name` text,
	`members` text,
	`owner_team_id` text NOT NULL,
	`passcode_hash` text NOT NULL,
	`is_competition_topic` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'analyzing' NOT NULL,
	`analysis` text,
	`comparison` text,
	`adopted_case_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`owner_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `projects_team_idx` ON `projects` (`owner_team_id`);--> statement-breakpoint
CREATE TABLE `rebuttals` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`target_variant_id` text NOT NULL,
	`target_claim_id` text NOT NULL,
	`attack_point` text NOT NULL,
	`argument` text NOT NULL,
	`category_ids` text NOT NULL,
	`source_ref_ids` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_variant_id`) REFERENCES `case_variants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rebuttals_project_idx` ON `rebuttals` (`project_id`);--> statement-breakpoint
CREATE TABLE `revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`snapshot` text NOT NULL,
	`changed_by` text NOT NULL,
	`changed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`origin` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `revisions_entity_idx` ON `revisions` (`project_id`,`entity_id`);--> statement-breakpoint
CREATE TABLE `source_materials` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`proves_what` text NOT NULL,
	`source_type` text NOT NULL,
	`status` text DEFAULT 'needed' NOT NULL,
	`citation` text,
	`quote` text,
	`is_modified` integer DEFAULT false NOT NULL,
	`modification_note` text,
	`verified_by` text,
	`verified_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`verified_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `materials_project_idx` ON `source_materials` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
