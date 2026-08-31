# Divergence objects — production facts only

Project `zrdxlrlqxdslqpnoqmus`, read-only, captured 2026-08-31.

Each name was searched across EVERY schema in the database, not only `public`. Where a table
exists, its columns, constraints, indexes, triggers, row count and the functions referencing
it are recorded verbatim from the catalog.

**No two tables here are described as equivalent, related or substitutable.** Similarly named
objects are reported separately with their own structures. Deciding whether any pair serves
the same purpose is out of scope for this evidence pack.

------------------------------------------------------------------------------------------

## `couranr_business_categories`

**DOES NOT EXIST** in any schema of this database.

### Functions whose body references this name

(none — this name appears in no function body)

------------------------------------------------------------------------------------------

## `couranr_business_members`

**DOES NOT EXIST** in any schema of this database.

### Functions whose body references this name

(none — this name appears in no function body)

------------------------------------------------------------------------------------------

## `couranr_category_presets`

**EXISTS** — `public.couranr_category_presets` (relkind=r), row count: 0

### Columns

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `business_category` text NOT NULL
- `name` text NOT NULL
- `body` jsonb NOT NULL DEFAULT '{}'::jsonb
- `version` integer NOT NULL DEFAULT 1
- `archived_at` timestamp with time zone NULL
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### Constraints

- **CHECK** `couranr_cp_body_chk` — CHECK (couranr_preset_body_is_clean(body))
- **CHECK** `couranr_cp_category_chk` — CHECK ((business_category = ANY (ARRAY['dry_cleaning_laundry_tailoring'::text, 'printing_signage_promotional'::text, 'boutique_clothing_shoes_accessories'::text, 'florists_gifts_specialty_retail'::text, 'repair_and_electronics'::text, 'auto_parts_and_accessories'::text, 'furniture_and_home_goods'::text, 'event_rentals_and_supplies'::text, 'bakeries_prepared_food_catering'::text, 'books_cards_collectibles_hobby'::text, 'general_local_business'::text])))
- **CHECK** `couranr_cp_name_chk` — CHECK ((btrim(name) <> ''::text))
- **CHECK** `couranr_cp_version_chk` — CHECK ((version >= 1))
- **PRIMARY KEY** `couranr_category_presets_pkey` — PRIMARY KEY (id)

### Indexes

- CREATE UNIQUE INDEX couranr_category_presets_pkey ON public.couranr_category_presets USING btree (id)
- CREATE INDEX couranr_cp_category_idx ON public.couranr_category_presets USING btree (business_category) WHERE (archived_at IS NULL)

### Triggers

(none)

### Functions whose body references this name

- `public.couranr_adopt_preset_recommendation(p_business_account_id uuid, p_actor_user_id uuid, p_preset_id uuid, p_expected_version integer)`
- `public.couranr_create_merchant_preset(p_business_account_id uuid, p_actor_user_id uuid, p_name text, p_body jsonb, p_source_preset_id uuid)`

------------------------------------------------------------------------------------------

## `couranr_delivery_presets`

**DOES NOT EXIST** in any schema of this database.

### Functions whose body references this name

(none — this name appears in no function body)

------------------------------------------------------------------------------------------

## `couranr_idempotency_records`

**DOES NOT EXIST** in any schema of this database.

### Functions whose body references this name

(none — this name appears in no function body)

------------------------------------------------------------------------------------------

## `couranr_merchant_customers`

**DOES NOT EXIST** in any schema of this database.

### Functions whose body references this name

(none — this name appears in no function body)

------------------------------------------------------------------------------------------

## `couranr_merchant_presets`

**EXISTS** — `public.couranr_merchant_presets` (relkind=r), row count: 0

### Columns

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `business_account_id` uuid NOT NULL
- `name` text NOT NULL
- `body` jsonb NOT NULL DEFAULT '{}'::jsonb
- `source_category_preset_id` uuid NULL
- `source_version` integer NULL
- `version` integer NOT NULL DEFAULT 1
- `archived_at` timestamp with time zone NULL
- `created_by` uuid NOT NULL
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### Constraints

- **CHECK** `couranr_mp_body_chk` — CHECK (couranr_preset_body_is_clean(body))
- **CHECK** `couranr_mp_name_chk` — CHECK ((btrim(name) <> ''::text))
- **CHECK** `couranr_mp_source_pair_chk` — CHECK ((((source_category_preset_id IS NULL) AND (source_version IS NULL)) OR ((source_category_preset_id IS NOT NULL) AND (source_version IS NOT NULL) AND (source_version >= 1))))
- **CHECK** `couranr_mp_version_chk` — CHECK ((version >= 1))
- **FOREIGN KEY** `couranr_mp_business_fk` — FOREIGN KEY (business_account_id) REFERENCES business_accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT
- **FOREIGN KEY** `couranr_mp_source_fk` — FOREIGN KEY (source_category_preset_id) REFERENCES couranr_category_presets(id) ON UPDATE CASCADE ON DELETE RESTRICT
- **PRIMARY KEY** `couranr_merchant_presets_pkey` — PRIMARY KEY (id)

### Indexes

- CREATE UNIQUE INDEX couranr_merchant_presets_pkey ON public.couranr_merchant_presets USING btree (id)
- CREATE INDEX couranr_mp_business_idx ON public.couranr_merchant_presets USING btree (business_account_id, updated_at DESC)
- CREATE UNIQUE INDEX couranr_mp_name_uniq ON public.couranr_merchant_presets USING btree (business_account_id, lower(btrim(name))) WHERE (archived_at IS NULL)

### Triggers

(none)

### Functions whose body references this name

- `public.couranr_adopt_preset_recommendation(p_business_account_id uuid, p_actor_user_id uuid, p_preset_id uuid, p_expected_version integer)`
- `public.couranr_create_merchant_preset(p_business_account_id uuid, p_actor_user_id uuid, p_name text, p_body jsonb, p_source_preset_id uuid)`
- `public.couranr_duplicate_merchant_preset(p_business_account_id uuid, p_actor_user_id uuid, p_preset_id uuid, p_new_name text)`
- `public.couranr_set_merchant_preset_archived(p_business_account_id uuid, p_actor_user_id uuid, p_preset_id uuid, p_archived boolean)`
- `public.couranr_update_merchant_preset(p_business_account_id uuid, p_actor_user_id uuid, p_preset_id uuid, p_name text, p_body jsonb, p_expected_version integer)`

------------------------------------------------------------------------------------------

## `couranr_merchant_workspaces`

**EXISTS** — `public.couranr_merchant_workspaces` (relkind=r), row count: 12

### Columns

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `business_account_id` uuid NOT NULL
- `created_by` uuid NOT NULL
- `idempotency_key` text NOT NULL
- `business_category` text NOT NULL
- `pickup_address` jsonb NOT NULL
- `contact_phone` text NOT NULL
- `payer_default` text NOT NULL
- `policies_accepted_at` timestamp with time zone NOT NULL
- `policies_version` text NOT NULL
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `secondary_categories` text[] NOT NULL DEFAULT '{}'::text[]
- `category_registry_version` text NULL

### Constraints

- **CHECK** `couranr_mw_category_chk` — CHECK ((business_category = ANY (ARRAY['dry_cleaning_laundry_tailoring'::text, 'printing_signage_promotional'::text, 'boutique_clothing_shoes_accessories'::text, 'florists_gifts_specialty_retail'::text, 'repair_and_electronics'::text, 'auto_parts_and_accessories'::text, 'furniture_and_home_goods'::text, 'event_rentals_and_supplies'::text, 'bakeries_prepared_food_catering'::text, 'books_cards_collectibles_hobby'::text, 'general_local_business'::text])))
- **CHECK** `couranr_mw_payer_default_chk` — CHECK ((payer_default = ANY (ARRAY['merchant'::text, 'customer'::text])))
- **CHECK** `couranr_mw_phone_present_chk` — CHECK ((length(btrim(contact_phone)) > 0))
- **CHECK** `couranr_mw_pickup_is_object_chk` — CHECK ((jsonb_typeof(pickup_address) = 'object'::text))
- **CHECK** `couranr_mw_policies_version_chk` — CHECK ((length(btrim(policies_version)) > 0))
- **CHECK** `couranr_mw_secondary_count_chk` — CHECK ((cardinality(secondary_categories) <= 3))
- **CHECK** `couranr_mw_secondary_distinct_chk` — CHECK (couranr_text_array_is_distinct(secondary_categories))
- **CHECK** `couranr_mw_secondary_not_primary_chk` — CHECK ((NOT (business_category = ANY (secondary_categories))))
- **CHECK** `couranr_mw_secondary_values_chk` — CHECK ((secondary_categories <@ ARRAY['dry_cleaning_laundry_tailoring'::text, 'printing_signage_promotional'::text, 'boutique_clothing_shoes_accessories'::text, 'florists_gifts_specialty_retail'::text, 'repair_and_electronics'::text, 'auto_parts_and_accessories'::text, 'furniture_and_home_goods'::text, 'event_rentals_and_supplies'::text, 'bakeries_prepared_food_catering'::text, 'books_cards_collectibles_hobby'::text, 'general_local_business'::text]))
- **FOREIGN KEY** `couranr_mw_account_fk` — FOREIGN KEY (business_account_id) REFERENCES business_accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT
- **FOREIGN KEY** `couranr_mw_created_by_fk` — FOREIGN KEY (created_by) REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE RESTRICT
- **PRIMARY KEY** `couranr_merchant_workspaces_pkey` — PRIMARY KEY (id)
- **UNIQUE** `couranr_mw_account_uniq` — UNIQUE (business_account_id)
- **UNIQUE** `couranr_mw_idempotency_uniq` — UNIQUE (created_by, idempotency_key)

### Indexes

- CREATE UNIQUE INDEX couranr_merchant_workspaces_pkey ON public.couranr_merchant_workspaces USING btree (id)
- CREATE UNIQUE INDEX couranr_mw_account_uniq ON public.couranr_merchant_workspaces USING btree (business_account_id)
- CREATE INDEX couranr_mw_created_by_idx ON public.couranr_merchant_workspaces USING btree (created_by)
- CREATE UNIQUE INDEX couranr_mw_idempotency_uniq ON public.couranr_merchant_workspaces USING btree (created_by, idempotency_key)

### Triggers

(none)

### Functions whose body references this name

- `public.couranr_create_merchant_workspace(p_owner_user_id uuid, p_idempotency_key text, p_name text, p_slug_base text, p_business_category text, p_pickup_address jsonb, p_contact_phone text, p_payer_default text, p_policies_version text)`
- `public.couranr_set_business_categories(p_business_account_id uuid, p_actor_user_id uuid, p_primary text, p_secondary text[], p_registry_version text)`
- `public.couranr_update_workspace_profile(p_business_account_id uuid, p_actor_user_id uuid, p_name text, p_business_category text, p_pickup_address jsonb, p_contact_phone text, p_payer_default text)`
- `public.couranr_verify_activation_contact(p_business_account_id uuid, p_actor_user_id uuid)`

------------------------------------------------------------------------------------------

## `couranr_team_events`

**EXISTS** — `public.couranr_team_events` (relkind=r), row count: 0

### Columns

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `business_account_id` uuid NOT NULL
- `member_id` uuid NOT NULL
- `actor_user_id` uuid NULL
- `command` text NOT NULL
- `from_role` text NULL
- `to_role` text NULL
- `from_status` text NULL
- `to_status` text NULL
- `metadata` jsonb NOT NULL DEFAULT '{}'::jsonb
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### Constraints

- **CHECK** `couranr_te_command_chk` — CHECK ((command = ANY (ARRAY['invite_member'::text, 'accept_member_invite'::text, 'change_member_role'::text, 'disable_member'::text, 'reactivate_member'::text])))
- **FOREIGN KEY** `couranr_team_events_business_account_id_fkey` — FOREIGN KEY (business_account_id) REFERENCES business_accounts(id) ON DELETE CASCADE
- **PRIMARY KEY** `couranr_team_events_pkey` — PRIMARY KEY (id)

### Indexes

- CREATE INDEX couranr_te_business_idx ON public.couranr_team_events USING btree (business_account_id, created_at DESC)
- CREATE UNIQUE INDEX couranr_team_events_pkey ON public.couranr_team_events USING btree (id)

### Triggers

(none)

### Functions whose body references this name

- `public.couranr_accept_member_invite(p_business_account_id uuid, p_actor_user_id uuid)`
- `public.couranr_change_member_role(p_business_account_id uuid, p_actor_user_id uuid, p_member_id uuid, p_to_role text)`
- `public.couranr_disable_member(p_business_account_id uuid, p_actor_user_id uuid, p_member_id uuid)`
- `public.couranr_invite_member(p_business_account_id uuid, p_actor_user_id uuid, p_invited_user_id uuid, p_invited_email text, p_role text)`
- `public.couranr_reactivate_member(p_business_account_id uuid, p_actor_user_id uuid, p_member_id uuid)`
