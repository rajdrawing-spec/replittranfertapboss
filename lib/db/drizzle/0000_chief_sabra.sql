CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"type" text DEFAULT 'subsidiary' NOT NULL,
	"industry" text,
	"ownership_percent" real DEFAULT 30 NOT NULL,
	"gst_number" text,
	"pan_number" text,
	"address" text,
	"city" text,
	"state" text,
	"status" text DEFAULT 'active' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"logo_url" text,
	"website" text,
	"description" text,
	"category" text,
	"country" text,
	"currency" text DEFAULT 'INR' NOT NULL,
	"timezone" text,
	"work_week" jsonb DEFAULT '[1,2,3,4,5]'::jsonb,
	"weekend_generation" boolean DEFAULT false NOT NULL,
	"generation_time" text,
	"brand_color" text,
	"employee_count" integer DEFAULT 0 NOT NULL,
	"total_revenue" real DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "companies_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"clerk_user_id" text,
	"role" text DEFAULT 'customer_support' NOT NULL,
	"extra_roles" json DEFAULT '[]'::json NOT NULL,
	"department" text,
	"company_ids" json DEFAULT '[]'::json NOT NULL,
	"avatar_url" text,
	"status" text DEFAULT 'invited' NOT NULL,
	"last_login_at" timestamp,
	"last_user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_clerk_user_id_unique" UNIQUE("clerk_user_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"permissions" json DEFAULT '[]'::json NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" text NOT NULL,
	"department" text,
	"company_ids" json DEFAULT '[]'::json NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"invited_by_user_id" integer,
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"user_email" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"description" text,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_number" text NOT NULL,
	"company_id" integer NOT NULL,
	"customer_id" integer,
	"customer_name" text NOT NULL,
	"customer_email" text,
	"customer_phone" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_amount" real DEFAULT 0 NOT NULL,
	"item_count" integer DEFAULT 1 NOT NULL,
	"channel" text DEFAULT 'direct' NOT NULL,
	"shipping_address" text,
	"tracking_number" text,
	"courier_name" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "orders_order_number_unique" UNIQUE("order_number")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"sku" text NOT NULL,
	"barcode" text,
	"category" text NOT NULL,
	"description" text,
	"price" real DEFAULT 0 NOT NULL,
	"cost_price" real DEFAULT 0 NOT NULL,
	"stock_quantity" integer DEFAULT 0 NOT NULL,
	"reorder_level" integer DEFAULT 10 NOT NULL,
	"warehouse_location" text,
	"image_url" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"type" text NOT NULL,
	"category" text NOT NULL,
	"amount" real NOT NULL,
	"description" text NOT NULL,
	"reference_number" text,
	"payment_method" text,
	"status" text DEFAULT 'completed' NOT NULL,
	"date" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fund_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_company_id" integer NOT NULL,
	"to_company_id" integer NOT NULL,
	"amount" real NOT NULL,
	"purpose" text NOT NULL,
	"note" text,
	"equity_change_percent" real,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"approval_id" integer,
	"from_transaction_id" integer,
	"to_transaction_id" integer,
	"requested_by_id" integer,
	"requested_by_name" text NOT NULL,
	"executed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"shareholder_id" integer NOT NULL,
	"company_id" integer NOT NULL,
	"type" text NOT NULL,
	"shares" integer DEFAULT 0 NOT NULL,
	"price_per_share" real DEFAULT 0 NOT NULL,
	"amount" real DEFAULT 0 NOT NULL,
	"date" text NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shareholders" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"type" text DEFAULT 'individual' NOT NULL,
	"role" text DEFAULT 'investor' NOT NULL,
	"shares" integer DEFAULT 0 NOT NULL,
	"share_price" real DEFAULT 0 NOT NULL,
	"investment_amount" real DEFAULT 0 NOT NULL,
	"ownership_percent" real DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"joined_date" text,
	"notes" text,
	"invited_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"department" text NOT NULL,
	"designation" text NOT NULL,
	"employee_code" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"leave_status" text,
	"join_date" text NOT NULL,
	"salary" real DEFAULT 0 NOT NULL,
	"manager_id" integer,
	"avatar_url" text,
	"skill_level" text,
	"working_hours" text,
	"current_project" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"city" text,
	"state" text,
	"status" text DEFAULT 'active' NOT NULL,
	"total_orders" integer DEFAULT 0 NOT NULL,
	"total_spend" real DEFAULT 0 NOT NULL,
	"last_order_date" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"company" text,
	"stage" text DEFAULT 'new' NOT NULL,
	"source" text DEFAULT 'website' NOT NULL,
	"value" real DEFAULT 0 NOT NULL,
	"assigned_to" text,
	"notes" text,
	"expected_close_date" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"gst_number" text,
	"category" text NOT NULL,
	"city" text,
	"state" text,
	"status" text DEFAULT 'active' NOT NULL,
	"total_due" real DEFAULT 0 NOT NULL,
	"rating" real,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"company_id" integer,
	"company_name" text,
	"action_url" text,
	"severity" text DEFAULT 'info' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"requested_by" text NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"total_steps" integer DEFAULT 3 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount" real,
	"approver_note" text,
	"due_date" text,
	"required_approvers" json DEFAULT '[]'::json NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_votes" (
	"id" serial PRIMARY KEY NOT NULL,
	"approval_id" integer NOT NULL,
	"voter_name" text NOT NULL,
	"voter_email" text NOT NULL,
	"voter_role" text DEFAULT 'approver' NOT NULL,
	"decision" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"voted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "approval_votes_approval_voter_uq" UNIQUE("approval_id","voter_email")
);
--> statement-breakpoint
CREATE TABLE "activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"company_id" integer,
	"company_name" text NOT NULL,
	"amount" real,
	"status" text,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platforms" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'marketplace' NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"account_owner" text,
	"account_handle" text,
	"last_sync_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"platform_key" text NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"health" text DEFAULT 'unknown' NOT NULL,
	"auth_type" text,
	"account_handle" text,
	"connected_user_id" integer,
	"connected_user_name" text,
	"connected_user_email" text,
	"secret_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"auto_sync" boolean DEFAULT false NOT NULL,
	"sync_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_sync_at" timestamp,
	"last_sync_status" text,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_error_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"connection_id" integer NOT NULL,
	"company_id" integer NOT NULL,
	"platform_key" text NOT NULL,
	"level" text DEFAULT 'error' NOT NULL,
	"message" text NOT NULL,
	"detail" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_sync_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"connection_id" integer NOT NULL,
	"company_id" integer NOT NULL,
	"platform_key" text NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"status" text NOT NULL,
	"records_synced" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"connection_id" integer NOT NULL,
	"company_id" integer NOT NULL,
	"platform_key" text NOT NULL,
	"env_name" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"iv" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_directory" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"platform" text NOT NULL,
	"platform_url" text,
	"login_email" text,
	"recovery_email" text,
	"phone" text,
	"recovery_phone" text,
	"google_linked" boolean DEFAULT false NOT NULL,
	"microsoft_linked" boolean DEFAULT false NOT NULL,
	"account_owner" text,
	"department" text,
	"notes" text,
	"last_login_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"order_id" integer,
	"order_number" text,
	"courier" text DEFAULT 'Shiprocket' NOT NULL,
	"tracking_number" text,
	"status" text DEFAULT 'processing' NOT NULL,
	"customer_name" text NOT NULL,
	"destination" text,
	"weight_kg" real,
	"shipping_cost" real DEFAULT 0,
	"shipped_at" timestamp,
	"delivered_at" timestamp,
	"return_reason" text,
	"returned_at" timestamp,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"name" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"file_url" text,
	"file_type" text,
	"issuer" text,
	"reference_number" text,
	"expires_at" timestamp,
	"owner" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"channel" text DEFAULT 'meta' NOT NULL,
	"objective" text DEFAULT 'conversions',
	"status" text DEFAULT 'active' NOT NULL,
	"budget" real DEFAULT 0 NOT NULL,
	"spent" real DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"leads" integer DEFAULT 0 NOT NULL,
	"conversions" integer DEFAULT 0 NOT NULL,
	"revenue" real DEFAULT 0 NOT NULL,
	"start_date" timestamp,
	"end_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_creatives" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"campaign_id" integer,
	"name" text NOT NULL,
	"type" text DEFAULT 'image' NOT NULL,
	"format" text,
	"url" text,
	"thumbnail_url" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"campaign_id" integer,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"source" text,
	"status" text DEFAULT 'new' NOT NULL,
	"value" real DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treasury_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"funding_source" text NOT NULL,
	"investor_name" text,
	"amount" real NOT NULL,
	"date" text NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"payment_method" text,
	"reference_number" text,
	"description" text NOT NULL,
	"notes" text,
	"status" text DEFAULT 'approved' NOT NULL,
	"is_reversed" boolean DEFAULT false NOT NULL,
	"reversed_at" timestamp,
	"reversed_by_name" text,
	"reversal_reason" text,
	"created_by_id" integer,
	"created_by_name" text NOT NULL,
	"approved_by_name" text,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_analyses" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"provider" text NOT NULL,
	"strengths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"weaknesses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"opportunities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"threats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"revenue_leaks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cost_opportunities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cash_risks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"growth_opportunities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text,
	"iv" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_config_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "ai_market_analyses" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"provider" text NOT NULL,
	"industry_demand" text,
	"competitor_analysis" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recommendations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_predictions" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"provider" text NOT NULL,
	"predictions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_valuations" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"provider" text NOT NULL,
	"estimated_value" real,
	"enterprise_value" real,
	"shareholder_equity" real,
	"nav" real,
	"growth_score" integer,
	"health_trend" text,
	"revenue_growth_rate" real,
	"profit_growth_rate" real,
	"explanation" text,
	"investor_score" integer,
	"investor_rating" text,
	"asset_valuation" real,
	"revenue_multiple_val" real,
	"ebitda_valuation" real,
	"dcf_valuation" real,
	"scorecard_valuation" real,
	"vc_valuation" real,
	"book_value_per_share" real,
	"estimated_share_price" real,
	"recommendations" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_report_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer,
	"company_id" integer,
	"type" text NOT NULL,
	"period_label" text,
	"status" text NOT NULL,
	"subject" text NOT NULL,
	"html_content" text,
	"ai_summary" text,
	"content_json" jsonb,
	"recipient_count" integer DEFAULT 0,
	"error_message" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_report_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"type" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"recipient_emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generated_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"template_id" integer,
	"generated_date" date NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"source" text DEFAULT 'template' NOT NULL,
	"ai_customizations" jsonb DEFAULT '{}'::jsonb,
	"due_date" date,
	"completed_at" timestamp,
	"approved_by" integer,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_generation_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"run_date" date NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"requester_id" integer,
	"triggered_by" text DEFAULT 'scheduler',
	"provider_used" text,
	"tokens_used" integer,
	"prompt_version" text DEFAULT '1.0',
	"execution_time_ms" integer,
	"batch_size" integer DEFAULT 1,
	"tasks_generated" integer DEFAULT 0,
	"next_run" timestamp,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 1 NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"department" text DEFAULT '*' NOT NULL,
	"role_key" text DEFAULT '*' NOT NULL,
	"title_template" text NOT NULL,
	"description_template" text NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"estimated_minutes" integer,
	"recurrence" text DEFAULT 'daily' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_prompts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"content" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_task_company_holidays" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"is_recurring_yearly" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_task_company_settings" (
	"company_id" integer PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"work_week" jsonb DEFAULT '[1,2,3,4,5]'::jsonb NOT NULL,
	"weekend_generation" boolean DEFAULT false NOT NULL,
	"generation_time" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_task_projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduler_locks" (
	"company_id" integer PRIMARY KEY NOT NULL,
	"locked_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_channel_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"last_read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"type" text DEFAULT 'team' NOT NULL,
	"name" text NOT NULL,
	"department" text,
	"created_by" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_message_reads" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"read_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"display_name" text NOT NULL,
	"content" text NOT NULL,
	"reply_to_id" integer,
	"attachments" jsonb DEFAULT '[]'::jsonb,
	"reactions" jsonb DEFAULT '{}'::jsonb,
	"mentions" jsonb DEFAULT '[]'::jsonb,
	"is_announcement" boolean DEFAULT false NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"edited_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"owner_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_email_pending_uq" ON "invitations" USING btree ("email") WHERE "invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "invitations_status_idx" ON "invitations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invitations_created_at_idx" ON "invitations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "orders_company_id_idx" ON "orders" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "orders_customer_id_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "orders_created_at_idx" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "products_company_id_idx" ON "products" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "products_status_idx" ON "products" USING btree ("status");--> statement-breakpoint
CREATE INDEX "products_sku_idx" ON "products" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "transactions_company_id_idx" ON "transactions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "transactions_date_idx" ON "transactions" USING btree ("date");--> statement-breakpoint
CREATE INDEX "transactions_company_date_idx" ON "transactions" USING btree ("company_id","date");--> statement-breakpoint
CREATE INDEX "transactions_type_idx" ON "transactions" USING btree ("type");--> statement-breakpoint
CREATE INDEX "customers_company_id_idx" ON "customers" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "customers_email_idx" ON "customers" USING btree ("email");--> statement-breakpoint
CREATE INDEX "leads_company_id_idx" ON "leads" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "leads_created_at_idx" ON "leads" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "activity_company_id_idx" ON "activity" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "activity_timestamp_idx" ON "activity" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "activity_company_timestamp_idx" ON "activity" USING btree ("company_id","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_conn_company_platform_uq" ON "integration_connections" USING btree ("company_id","platform_key");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_cred_conn_env_uq" ON "integration_credentials" USING btree ("connection_id","env_name");--> statement-breakpoint
CREATE INDEX "chat_channel_members_channel_user_idx" ON "chat_channel_members" USING btree ("channel_id","user_id");--> statement-breakpoint
CREATE INDEX "chat_channels_company_id_idx" ON "chat_channels" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "chat_channels_type_idx" ON "chat_channels" USING btree ("type");--> statement-breakpoint
CREATE INDEX "chat_message_reads_message_user_idx" ON "chat_message_reads" USING btree ("message_id","user_id");--> statement-breakpoint
CREATE INDEX "chat_messages_channel_id_idx" ON "chat_messages" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "chat_messages_created_at_idx" ON "chat_messages" USING btree ("created_at");