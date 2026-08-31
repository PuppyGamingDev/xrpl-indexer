CREATE TYPE "public"."gap_state" AS ENUM('pending', 'running', 'done');--> statement-breakpoint
CREATE TYPE "public"."meta_source" AS ENUM('uri', 'bithomp', 'xrplto', 'xrplmeta', 'toml');--> statement-breakpoint
CREATE TYPE "public"."token_type" AS ENUM('XRP', 'IOU', 'MPT');--> statement-breakpoint
CREATE TABLE "indexer_checkpoint" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_ledger_seq" integer NOT NULL,
	"last_ledger_hash" varchar(64) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger" (
	"sequence" integer PRIMARY KEY NOT NULL,
	"hash" varchar(64) NOT NULL,
	"parent_hash" varchar(64) NOT NULL,
	"close_time" timestamp with time zone NOT NULL,
	"txn_count" integer DEFAULT 0 NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_gap" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ledger_gap_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"range_start" integer NOT NULL,
	"range_end" integer NOT NULL,
	"state" "gap_state" DEFAULT 'pending' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "account_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"address" varchar(40) NOT NULL,
	"blackholed" boolean DEFAULT false NOT NULL,
	"pseudo" boolean DEFAULT false NOT NULL,
	"pseudo_source" varchar(16),
	"domain" text,
	"flags" bigint DEFAULT 0 NOT NULL,
	"first_seen_ledger" integer NOT NULL,
	CONSTRAINT "account_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "account_balance" (
	"account_id" bigint NOT NULL,
	"token_id" bigint NOT NULL,
	"ledger_seq" integer NOT NULL,
	"balance" numeric NOT NULL,
	CONSTRAINT "account_balance_account_id_token_id_ledger_seq_pk" PRIMARY KEY("account_id","token_id","ledger_seq")
);
--> statement-breakpoint
CREATE TABLE "token" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "token_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"token_type" "token_type" NOT NULL,
	"currency" varchar(40),
	"issuer_id" bigint,
	"mpt_issuance_id" varchar(48),
	"first_seen_ledger" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_exchange" (
	"tx_hash" varchar(64) NOT NULL,
	"idx" integer NOT NULL,
	"ledger_seq" integer NOT NULL,
	"taker_paid_token_id" bigint NOT NULL,
	"taker_paid_value" numeric NOT NULL,
	"taker_got_token_id" bigint NOT NULL,
	"taker_got_value" numeric NOT NULL,
	"taker_id" bigint,
	"maker_id" bigint,
	CONSTRAINT "token_exchange_tx_hash_idx_pk" PRIMARY KEY("tx_hash","idx")
);
--> statement-breakpoint
CREATE TABLE "token_holders" (
	"token_id" bigint NOT NULL,
	"ledger_seq" integer NOT NULL,
	"value" numeric NOT NULL,
	CONSTRAINT "token_holders_token_id_ledger_seq_pk" PRIMARY KEY("token_id","ledger_seq")
);
--> statement-breakpoint
CREATE TABLE "token_marketcap" (
	"token_id" bigint NOT NULL,
	"ledger_seq" integer NOT NULL,
	"value" numeric NOT NULL,
	CONSTRAINT "token_marketcap_token_id_ledger_seq_pk" PRIMARY KEY("token_id","ledger_seq")
);
--> statement-breakpoint
CREATE TABLE "token_supply" (
	"token_id" bigint NOT NULL,
	"ledger_seq" integer NOT NULL,
	"value" numeric NOT NULL,
	CONSTRAINT "token_supply_token_id_ledger_seq_pk" PRIMARY KEY("token_id","ledger_seq")
);
--> statement-breakpoint
CREATE TABLE "token_trustlines" (
	"token_id" bigint NOT NULL,
	"ledger_seq" integer NOT NULL,
	"value" numeric NOT NULL,
	CONSTRAINT "token_trustlines_token_id_ledger_seq_pk" PRIMARY KEY("token_id","ledger_seq")
);
--> statement-breakpoint
CREATE TABLE "nft" (
	"token_id" varchar(64) PRIMARY KEY NOT NULL,
	"issuer_id" bigint NOT NULL,
	"owner_id" bigint,
	"collection_id" bigint,
	"taxon" bigint NOT NULL,
	"serial" bigint NOT NULL,
	"flags" integer DEFAULT 0 NOT NULL,
	"transfer_fee" integer DEFAULT 0 NOT NULL,
	"uri" text,
	"mint_ledger_seq" integer,
	"burn_ledger_seq" integer,
	"live" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nft_collection" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "nft_collection_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"issuer_id" bigint NOT NULL,
	"taxon" bigint NOT NULL,
	"first_seen_ledger" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nft_exchange" (
	"tx_hash" varchar(64) NOT NULL,
	"idx" integer NOT NULL,
	"nft_token_id" varchar(64) NOT NULL,
	"seller_id" bigint,
	"buyer_id" bigint,
	"amount" jsonb NOT NULL,
	"ledger_seq" integer NOT NULL,
	CONSTRAINT "nft_exchange_tx_hash_idx_pk" PRIMARY KEY("tx_hash","idx")
);
--> statement-breakpoint
CREATE TABLE "nft_offer" (
	"offer_id" varchar(64) PRIMARY KEY NOT NULL,
	"nft_token_id" varchar(64) NOT NULL,
	"account_id" bigint NOT NULL,
	"amount" jsonb NOT NULL,
	"is_sell" boolean NOT NULL,
	"destination_id" bigint,
	"expiration" integer,
	"created_ledger_seq" integer NOT NULL,
	"closed_ledger_seq" integer
);
--> statement-breakpoint
CREATE TABLE "amm" (
	"account_id" bigint PRIMARY KEY NOT NULL,
	"asset1_token_id" bigint NOT NULL,
	"asset2_token_id" bigint NOT NULL,
	"lp_token_currency" varchar(40) NOT NULL,
	"trading_fee" integer DEFAULT 0 NOT NULL,
	"created_ledger_seq" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oracle" (
	"oracle_id" varchar(64) PRIMARY KEY NOT NULL,
	"owner_id" bigint NOT NULL,
	"provider" text,
	"asset_class" text,
	"uri" text,
	"last_update_time" integer,
	"price_data_count" integer,
	"ledger_seq" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault" (
	"vault_id" varchar(64) PRIMARY KEY NOT NULL,
	"owner_id" bigint NOT NULL,
	"pseudo_account_id" bigint,
	"asset_token_id" bigint NOT NULL,
	"share_mpt_id" varchar(48),
	"assets_total" numeric,
	"assets_available" numeric,
	"assets_maximum" numeric,
	"flags" integer DEFAULT 0 NOT NULL,
	"ledger_seq" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboard_snapshot" (
	"ts" timestamp with time zone PRIMARY KEY DEFAULT now() NOT NULL,
	"stats" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issuer_meta" (
	"account_id" bigint PRIMARY KEY NOT NULL,
	"name" text,
	"description" text,
	"icon_uri" text,
	"twitter" text,
	"domain" text,
	"verified" boolean DEFAULT false NOT NULL,
	"source" "meta_source" NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nft_collection_stats" (
	"collection_id" bigint PRIMARY KEY NOT NULL,
	"name" text,
	"image_uri" text,
	"supply" integer DEFAULT 0 NOT NULL,
	"holders" integer DEFAULT 0 NOT NULL,
	"floor" numeric DEFAULT '0' NOT NULL,
	"volume_24h" numeric DEFAULT '0' NOT NULL,
	"volume_7d" numeric DEFAULT '0' NOT NULL,
	"volume_all" numeric DEFAULT '0' NOT NULL,
	"trades_24h" integer DEFAULT 0 NOT NULL,
	"trades_7d" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nft_meta" (
	"nft_token_id" varchar(64) PRIMARY KEY NOT NULL,
	"name" text,
	"description" text,
	"image_uri" text,
	"media_uri" text,
	"media_type" varchar(16),
	"attributes" jsonb,
	"collection_name" text,
	"source" "meta_source" NOT NULL,
	"error" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_meta" (
	"token_id" bigint PRIMARY KEY NOT NULL,
	"name" text,
	"description" text,
	"icon_uri" text,
	"domain" text,
	"links" jsonb,
	"trust_level" integer DEFAULT 0 NOT NULL,
	"source" "meta_source" NOT NULL,
	"raw" jsonb,
	"error" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_stats" (
	"token_id" bigint PRIMARY KEY NOT NULL,
	"holders" integer DEFAULT 0 NOT NULL,
	"trustlines" integer DEFAULT 0 NOT NULL,
	"supply" numeric DEFAULT '0' NOT NULL,
	"marketcap" numeric DEFAULT '0' NOT NULL,
	"price" numeric DEFAULT '0' NOT NULL,
	"volume_24h" numeric DEFAULT '0' NOT NULL,
	"volume_7d" numeric DEFAULT '0' NOT NULL,
	"exchanges_24h" integer DEFAULT 0 NOT NULL,
	"exchanges_7d" integer DEFAULT 0 NOT NULL,
	"takers_24h" integer DEFAULT 0 NOT NULL,
	"takers_7d" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_session" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"admin_user_id" bigint NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "admin_session_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "admin_user" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "admin_user_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"username" varchar(64) NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "admin_user_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "api_key" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "api_key_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"label" text NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"key_prefix" varchar(12) NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"rate_limit" integer DEFAULT 120 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_key_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
ALTER TABLE "account_balance" ADD CONSTRAINT "account_balance_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_balance" ADD CONSTRAINT "account_balance_token_id_token_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."token"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token" ADD CONSTRAINT "token_issuer_id_account_id_fk" FOREIGN KEY ("issuer_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_exchange" ADD CONSTRAINT "token_exchange_taker_paid_token_id_token_id_fk" FOREIGN KEY ("taker_paid_token_id") REFERENCES "public"."token"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_exchange" ADD CONSTRAINT "token_exchange_taker_got_token_id_token_id_fk" FOREIGN KEY ("taker_got_token_id") REFERENCES "public"."token"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_exchange" ADD CONSTRAINT "token_exchange_taker_id_account_id_fk" FOREIGN KEY ("taker_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_exchange" ADD CONSTRAINT "token_exchange_maker_id_account_id_fk" FOREIGN KEY ("maker_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_holders" ADD CONSTRAINT "token_holders_token_id_token_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."token"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_marketcap" ADD CONSTRAINT "token_marketcap_token_id_token_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."token"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_supply" ADD CONSTRAINT "token_supply_token_id_token_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."token"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_trustlines" ADD CONSTRAINT "token_trustlines_token_id_token_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."token"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nft" ADD CONSTRAINT "nft_issuer_id_account_id_fk" FOREIGN KEY ("issuer_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nft" ADD CONSTRAINT "nft_owner_id_account_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nft" ADD CONSTRAINT "nft_collection_id_nft_collection_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."nft_collection"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nft_collection" ADD CONSTRAINT "nft_collection_issuer_id_account_id_fk" FOREIGN KEY ("issuer_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nft_exchange" ADD CONSTRAINT "nft_exchange_nft_token_id_nft_token_id_fk" FOREIGN KEY ("nft_token_id") REFERENCES "public"."nft"("token_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nft_exchange" ADD CONSTRAINT "nft_exchange_seller_id_account_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nft_exchange" ADD CONSTRAINT "nft_exchange_buyer_id_account_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nft_offer" ADD CONSTRAINT "nft_offer_nft_token_id_nft_token_id_fk" FOREIGN KEY ("nft_token_id") REFERENCES "public"."nft"("token_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nft_offer" ADD CONSTRAINT "nft_offer_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nft_offer" ADD CONSTRAINT "nft_offer_destination_id_account_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amm" ADD CONSTRAINT "amm_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amm" ADD CONSTRAINT "amm_asset1_token_id_token_id_fk" FOREIGN KEY ("asset1_token_id") REFERENCES "public"."token"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amm" ADD CONSTRAINT "amm_asset2_token_id_token_id_fk" FOREIGN KEY ("asset2_token_id") REFERENCES "public"."token"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oracle" ADD CONSTRAINT "oracle_owner_id_account_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault" ADD CONSTRAINT "vault_owner_id_account_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault" ADD CONSTRAINT "vault_pseudo_account_id_account_id_fk" FOREIGN KEY ("pseudo_account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault" ADD CONSTRAINT "vault_asset_token_id_token_id_fk" FOREIGN KEY ("asset_token_id") REFERENCES "public"."token"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issuer_meta" ADD CONSTRAINT "issuer_meta_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nft_collection_stats" ADD CONSTRAINT "nft_collection_stats_collection_id_nft_collection_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."nft_collection"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nft_meta" ADD CONSTRAINT "nft_meta_nft_token_id_nft_token_id_fk" FOREIGN KEY ("nft_token_id") REFERENCES "public"."nft"("token_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_meta" ADD CONSTRAINT "token_meta_token_id_token_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."token"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_stats" ADD CONSTRAINT "token_stats_token_id_token_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."token"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_session" ADD CONSTRAINT "admin_session_admin_user_id_admin_user_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_gap_state_idx" ON "ledger_gap" USING btree ("state","range_start");--> statement-breakpoint
CREATE INDEX "account_balance_holders_idx" ON "account_balance" USING btree ("token_id","account_id","ledger_seq" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "account_balance_asof_idx" ON "account_balance" USING btree ("account_id","token_id","ledger_seq" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "token_iou_uq" ON "token" USING btree ("currency","issuer_id") WHERE "token"."token_type" = 'IOU';--> statement-breakpoint
CREATE UNIQUE INDEX "token_mpt_uq" ON "token" USING btree ("mpt_issuance_id") WHERE "token"."token_type" = 'MPT';--> statement-breakpoint
CREATE UNIQUE INDEX "token_xrp_uq" ON "token" USING btree ("token_type") WHERE "token"."token_type" = 'XRP';--> statement-breakpoint
CREATE INDEX "token_issuer_idx" ON "token" USING btree ("issuer_id");--> statement-breakpoint
CREATE INDEX "token_exchange_pair_idx" ON "token_exchange" USING btree ("taker_paid_token_id","taker_got_token_id","ledger_seq");--> statement-breakpoint
CREATE INDEX "token_exchange_ledger_idx" ON "token_exchange" USING btree ("ledger_seq");--> statement-breakpoint
CREATE INDEX "nft_owner_idx" ON "nft" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "nft_collection_idx" ON "nft" USING btree ("collection_id","serial");--> statement-breakpoint
CREATE INDEX "nft_issuer_taxon_idx" ON "nft" USING btree ("issuer_id","taxon");--> statement-breakpoint
CREATE UNIQUE INDEX "nft_collection_uq" ON "nft_collection" USING btree ("issuer_id","taxon");--> statement-breakpoint
CREATE INDEX "nft_exchange_token_idx" ON "nft_exchange" USING btree ("nft_token_id","ledger_seq");--> statement-breakpoint
CREATE INDEX "nft_exchange_ledger_idx" ON "nft_exchange" USING btree ("ledger_seq");--> statement-breakpoint
CREATE INDEX "nft_offer_token_idx" ON "nft_offer" USING btree ("nft_token_id");--> statement-breakpoint
CREATE INDEX "nft_offer_open_idx" ON "nft_offer" USING btree ("nft_token_id","closed_ledger_seq");