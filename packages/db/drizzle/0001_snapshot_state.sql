CREATE TABLE "snapshot_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"status" varchar(16) DEFAULT 'none' NOT NULL,
	"snapshot_ledger" integer,
	"cursor_type" varchar(32),
	"cursor_marker" text,
	"completed_passes" text DEFAULT '[]' NOT NULL,
	"entries_processed" bigint DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
