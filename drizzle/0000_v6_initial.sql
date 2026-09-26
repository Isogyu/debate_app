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
CREATE TABLE `case_strategies` (
	`variant_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`data` text NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `case_variants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `case_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`side` text NOT NULL,
	`origin` text NOT NULL,
	`label` text NOT NULL,
	`framework` text DEFAULT '' NOT NULL,
	`approach` text DEFAULT '' NOT NULL,
	`debate_case` text NOT NULL,
	`source_refs` text NOT NULL,
	`length_warning` text,
	`verified` integer DEFAULT false NOT NULL,
	`questions_verified` integer DEFAULT false NOT NULL,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `variants_project_idx` ON `case_variants` (`project_id`,`side`,`origin`);--> statement-breakpoint
CREATE TABLE `closing_templates` (
	`variant_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`own` text NOT NULL,
	`opponent` text NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `case_variants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `cross_exam_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`target_variant_id` text NOT NULL,
	`chain_id` text NOT NULL,
	`chain_order` integer DEFAULT 0 NOT NULL,
	`target_claim_id` text,
	`target_paragraph` text DEFAULT '' NOT NULL,
	`attack_point` text NOT NULL,
	`question` text NOT NULL,
	`purpose` text DEFAULT '' NOT NULL,
	`model_answer` text DEFAULT '' NOT NULL,
	`goal` text,
	`priority` integer DEFAULT 3 NOT NULL,
	`set_order` integer,
	`origin` text DEFAULT 'generated' NOT NULL,
	`stuck_count` integer DEFAULT 0 NOT NULL,
	`category_ids` text NOT NULL,
	`branches` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_variant_id`) REFERENCES `case_variants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cx_variant_idx` ON `cross_exam_nodes` (`target_variant_id`,`chain_id`);--> statement-breakpoint
CREATE INDEX `cx_project_idx` ON `cross_exam_nodes` (`project_id`);--> statement-breakpoint
CREATE TABLE `fetched_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`domain` text NOT NULL,
	`title` text,
	`content_type` text NOT NULL,
	`text` text NOT NULL,
	`page_offsets` text,
	`sha256` text NOT NULL,
	`fetched_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fetched_url_idx` ON `fetched_documents` (`url`);--> statement-breakpoint
CREATE TABLE `generation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`variant_id` text,
	`params` text,
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
CREATE TABLE `number_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`aspect` text NOT NULL,
	`severity` text NOT NULL,
	`location` text NOT NULL,
	`claim_id` text,
	`value` text DEFAULT '' NOT NULL,
	`message` text NOT NULL,
	`resolution` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`variant_id`) REFERENCES `case_variants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `findings_variant_idx` ON `number_findings` (`variant_id`);--> statement-breakpoint
CREATE TABLE `practice_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`mode` text NOT NULL,
	`user_variant_id` text NOT NULL,
	`opponent_variant_id` text NOT NULL,
	`turns` text NOT NULL,
	`feedback` text,
	`reflection` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_variant_id`) REFERENCES `case_variants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`opponent_variant_id`) REFERENCES `case_variants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `practice_project_idx` ON `practice_sessions` (`project_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`resolution` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`review_analysis` integer DEFAULT false NOT NULL,
	`analysis` text,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`archived_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_one_active_idx` ON `projects` (`status`) WHERE status = 'active';--> statement-breakpoint
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
	`status` text DEFAULT 'procedure' NOT NULL,
	`origin` text DEFAULT 'ai_fetched' NOT NULL,
	`citation` text,
	`quote` text,
	`url` text,
	`last_checked_at` text,
	`source_domain` text,
	`within_allowed_sources` integer DEFAULT true NOT NULL,
	`procedure` text,
	`statistic` text,
	`copied_from_material_id` text,
	`is_modified` integer DEFAULT false NOT NULL,
	`modification_note` text,
	`verified_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `materials_project_idx` ON `source_materials` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`variant_id` text,
	`side` text NOT NULL,
	`label` text NOT NULL,
	`case_file_name` text NOT NULL,
	`case_file_path` text NOT NULL,
	`case_text` text NOT NULL,
	`materials_file_name` text,
	`materials_file_path` text,
	`materials_text` text,
	`issues` text NOT NULL,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `uploads_project_idx` ON `uploads` (`project_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
