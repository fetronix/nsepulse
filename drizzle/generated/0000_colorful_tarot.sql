CREATE TABLE "alert_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"observed_value" jsonb NOT NULL,
	"reason" text NOT NULL,
	"source" text,
	"observed_at" timestamp with time zone,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"security_id" uuid,
	"rule_type" varchar(48) NOT NULL,
	"configuration" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cooldown_minutes" integer DEFAULT 60 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" varchar(80) NOT NULL,
	"target_type" varchar(64),
	"target_id" text,
	"request_id" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"security_id" uuid NOT NULL,
	"description" text,
	"shares_outstanding" bigint,
	"share_count_as_of" timestamp with time zone,
	"source" text,
	"published_at" timestamp with time zone,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corporate_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"security_id" uuid NOT NULL,
	"action_type" varchar(48) NOT NULL,
	"status" varchar(24) NOT NULL,
	"announcement_date" timestamp with time zone,
	"effective_date" timestamp with time zone,
	"source_url" text NOT NULL,
	"source" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_provider_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(64) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"public_config" jsonb,
	"secret_ref" text,
	"last_status" varchar(24) DEFAULT 'UNCONFIGURED' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dividend_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"security_id" uuid NOT NULL,
	"amount_per_share" numeric(20, 8),
	"currency" varchar(3) DEFAULT 'KES' NOT NULL,
	"classification" varchar(24) NOT NULL,
	"declaration_date" timestamp with time zone,
	"record_date" timestamp with time zone,
	"ex_dividend_date" timestamp with time zone,
	"payment_date" timestamp with time zone,
	"status" varchar(24) NOT NULL,
	"source_url" text NOT NULL,
	"source" text NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"metric" varchar(80) NOT NULL,
	"value" numeric(28, 8),
	"unit" varchar(32) NOT NULL,
	"is_calculated" boolean DEFAULT false NOT NULL,
	"formula" text,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"security_id" uuid NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"report_type" varchar(32) NOT NULL,
	"currency" varchar(3) DEFAULT 'KES' NOT NULL,
	"unit" varchar(32) DEFAULT 'KES' NOT NULL,
	"source_url" text NOT NULL,
	"restates_report_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "historical_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"security_id" uuid NOT NULL,
	"session_date" timestamp with time zone NOT NULL,
	"open" numeric(20, 6),
	"high" numeric(20, 6),
	"low" numeric(20, 6),
	"close" numeric(20, 6) NOT NULL,
	"volume" bigint,
	"source" text NOT NULL,
	"data_mode" varchar(16) DEFAULT 'END_OF_DAY' NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"adjusted_for_corporate_actions" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"provider" varchar(64),
	"code" varchar(80),
	"message" text NOT NULL,
	"context" jsonb,
	"retryable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_type" varchar(64) NOT NULL,
	"provider" varchar(64),
	"status" varchar(24) NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"attempt" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exchange" varchar(16) DEFAULT 'NSE' NOT NULL,
	"session_date" timestamp with time zone NOT NULL,
	"is_trading_day" boolean NOT NULL,
	"open_at" timestamp with time zone,
	"close_at" timestamp with time zone,
	"source" text NOT NULL,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "market_indices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" text NOT NULL,
	"value" numeric(20, 6) NOT NULL,
	"change" numeric(20, 6),
	"change_percent" numeric(12, 6),
	"source" text NOT NULL,
	"market_event_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data_mode" varchar(16) DEFAULT 'UNKNOWN' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"security_id" uuid NOT NULL,
	"price" numeric(20, 6) NOT NULL,
	"open" numeric(20, 6),
	"high" numeric(20, 6),
	"low" numeric(20, 6),
	"previous_close" numeric(20, 6),
	"volume" bigint,
	"turnover" numeric(24, 4),
	"currency" varchar(3) DEFAULT 'KES' NOT NULL,
	"source" text NOT NULL,
	"market_event_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data_mode" varchar(16) DEFAULT 'UNKNOWN' NOT NULL,
	"validation_status" varchar(16) DEFAULT 'UNVERIFIED' NOT NULL,
	"validation_notes" jsonb,
	"revision_of" uuid,
	"raw_payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "news_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"original_url" text NOT NULL,
	"title" text NOT NULL,
	"publisher" text NOT NULL,
	"published_at" timestamp with time zone,
	"summary" text,
	"classification" varchar(48),
	"materiality" varchar(24),
	"sentiment" varchar(16),
	"summary_model" text,
	"verified" boolean DEFAULT false NOT NULL,
	"duplicate_of" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_security_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"security_id" uuid NOT NULL,
	"confidence" numeric(5, 4),
	"reviewed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"source_type" varchar(32) NOT NULL,
	"feed_url" text,
	"terms_url" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_event_id" uuid,
	"user_id" uuid NOT NULL,
	"channel" varchar(24) NOT NULL,
	"status" varchar(24) DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"security_id" uuid NOT NULL,
	"quantity" numeric(22, 6) NOT NULL,
	"average_cost" numeric(20, 6),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"currency" varchar(3) DEFAULT 'KES' NOT NULL,
	"cost_assumptions" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"security_id" uuid NOT NULL,
	"side" varchar(8) NOT NULL,
	"quantity" numeric(22, 6) NOT NULL,
	"price" numeric(20, 6) NOT NULL,
	"fees" numeric(20, 6) DEFAULT '0' NOT NULL,
	"traded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"security_id" uuid NOT NULL,
	"components" jsonb NOT NULL,
	"weights" jsonb NOT NULL,
	"total" numeric(7, 3),
	"methodology_version" varchar(32) NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data_completeness" numeric(5, 4)
);
--> statement-breakpoint
CREATE TABLE "securities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"name" text NOT NULL,
	"exchange" varchar(16) DEFAULT 'NSE' NOT NULL,
	"listing_status" varchar(24) DEFAULT 'UNKNOWN' NOT NULL,
	"instrument_type" varchar(32) DEFAULT 'UNKNOWN' NOT NULL,
	"sector" text,
	"industry" text,
	"currency" varchar(3) DEFAULT 'KES' NOT NULL,
	"listed_at" timestamp with time zone,
	"delisted_at" timestamp with time zone,
	"source" text,
	"source_verified_at" timestamp with time zone,
	"review_required" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_identifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"security_id" uuid NOT NULL,
	"scheme" varchar(40) NOT NULL,
	"value" varchar(128) NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"source" text,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "technical_indicators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"security_id" uuid NOT NULL,
	"name" varchar(32) NOT NULL,
	"period" integer NOT NULL,
	"value" numeric(24, 10),
	"input_through" timestamp with time zone,
	"methodology" text NOT NULL,
	"source" text NOT NULL,
	"reliability" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"telegram_user_id" varchar(32) NOT NULL,
	"chat_id" varchar(32) NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"timezone" varchar(80) DEFAULT 'Africa/Nairobi' NOT NULL,
	"currency" varchar(3) DEFAULT 'KES' NOT NULL,
	"quiet_hours" jsonb,
	"notifications_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"password_hash" text,
	"role" varchar(24) DEFAULT 'USER' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "watchlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"watchlist_id" uuid NOT NULL,
	"security_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_rule_id_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_profiles" ADD CONSTRAINT "company_profiles_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_actions" ADD CONSTRAINT "corporate_actions_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dividend_events" ADD CONSTRAINT "dividend_events_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_metrics" ADD CONSTRAINT "financial_metrics_report_id_financial_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."financial_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_reports" ADD CONSTRAINT "financial_reports_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historical_prices" ADD CONSTRAINT "historical_prices_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_errors" ADD CONSTRAINT "ingestion_errors_job_id_ingestion_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ingestion_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_observations" ADD CONSTRAINT "market_observations_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_articles" ADD CONSTRAINT "news_articles_source_id_news_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."news_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_security_links" ADD CONSTRAINT "news_security_links_article_id_news_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."news_articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_security_links" ADD CONSTRAINT "news_security_links_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_alert_event_id_alert_events_id_fk" FOREIGN KEY ("alert_event_id") REFERENCES "public"."alert_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_holdings" ADD CONSTRAINT "paper_holdings_portfolio_id_paper_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."paper_portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_holdings" ADD CONSTRAINT "paper_holdings_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_portfolios" ADD CONSTRAINT "paper_portfolios_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_transactions" ADD CONSTRAINT "paper_transactions_portfolio_id_paper_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."paper_portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_transactions" ADD CONSTRAINT "paper_transactions_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_scores" ADD CONSTRAINT "research_scores_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_identifiers" ADD CONSTRAINT "security_identifiers_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technical_indicators" ADD CONSTRAINT "technical_indicators_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_accounts" ADD CONSTRAINT "telegram_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_watchlist_id_watchlists_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."watchlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlists" ADD CONSTRAINT "watchlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_event_dedupe_uq" ON "alert_events" USING btree ("rule_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "alert_events_created_idx" ON "alert_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "alert_rules_user_enabled_idx" ON "alert_rules" USING btree ("user_id","enabled");--> statement-breakpoint
CREATE INDEX "audit_actor_time_idx" ON "audit_logs" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "company_profiles_security_idx" ON "company_profiles" USING btree ("security_id");--> statement-breakpoint
CREATE INDEX "corporate_security_date_idx" ON "corporate_actions" USING btree ("security_id","effective_date");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_config_provider_uq" ON "data_provider_configs" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "dividend_security_payment_idx" ON "dividend_events" USING btree ("security_id","payment_date");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_metric_report_name_uq" ON "financial_metrics" USING btree ("report_id","metric");--> statement-breakpoint
CREATE INDEX "financial_reports_security_period_idx" ON "financial_reports" USING btree ("security_id","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "historical_security_day_source_uq" ON "historical_prices" USING btree ("security_id","session_date","source");--> statement-breakpoint
CREATE INDEX "historical_security_date_idx" ON "historical_prices" USING btree ("security_id","session_date");--> statement-breakpoint
CREATE INDEX "ingestion_errors_created_idx" ON "ingestion_errors" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ingestion_jobs_status_created_idx" ON "ingestion_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "market_calendar_exchange_day_uq" ON "market_calendars" USING btree ("exchange","session_date");--> statement-breakpoint
CREATE INDEX "market_indices_code_time_idx" ON "market_indices" USING btree ("code","market_event_at");--> statement-breakpoint
CREATE INDEX "market_obs_security_event_idx" ON "market_observations" USING btree ("security_id","market_event_at");--> statement-breakpoint
CREATE INDEX "market_obs_ingested_idx" ON "market_observations" USING btree ("ingested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "market_obs_dedupe_uq" ON "market_observations" USING btree ("security_id","source","market_event_at","price");--> statement-breakpoint
CREATE UNIQUE INDEX "news_original_url_uq" ON "news_articles" USING btree ("original_url");--> statement-breakpoint
CREATE INDEX "news_published_idx" ON "news_articles" USING btree ("published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "news_link_pair_uq" ON "news_security_links" USING btree ("article_id","security_id");--> statement-breakpoint
CREATE INDEX "notification_delivery_queue_idx" ON "notification_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "paper_holding_portfolio_security_uq" ON "paper_holdings" USING btree ("portfolio_id","security_id");--> statement-breakpoint
CREATE INDEX "paper_portfolio_user_idx" ON "paper_portfolios" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "paper_tx_portfolio_time_idx" ON "paper_transactions" USING btree ("portfolio_id","traded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "securities_exchange_symbol_uq" ON "securities" USING btree ("exchange","symbol");--> statement-breakpoint
CREATE INDEX "securities_status_idx" ON "securities" USING btree ("listing_status");--> statement-breakpoint
CREATE UNIQUE INDEX "security_identifiers_scheme_value_uq" ON "security_identifiers" USING btree ("scheme","value");--> statement-breakpoint
CREATE INDEX "security_identifiers_security_idx" ON "security_identifiers" USING btree ("security_id");--> statement-breakpoint
CREATE INDEX "technical_security_name_time_idx" ON "technical_indicators" USING btree ("security_id","name","input_through");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_accounts_user_uq" ON "telegram_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_accounts_tg_uq" ON "telegram_accounts" USING btree ("telegram_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_security_uq" ON "watchlist_items" USING btree ("watchlist_id","security_id");--> statement-breakpoint
CREATE INDEX "watchlists_user_idx" ON "watchlists" USING btree ("user_id");