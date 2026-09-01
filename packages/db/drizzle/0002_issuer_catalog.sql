CREATE TABLE "issuer_catalog" (
	"issuer_id" bigint PRIMARY KEY NOT NULL,
	"pulled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"nft_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issuer_catalog" ADD CONSTRAINT "issuer_catalog_issuer_id_account_id_fk" FOREIGN KEY ("issuer_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;