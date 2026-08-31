# Canonical delivery spine — production structure and row counts

Project `zrdxlrlqxdslqpnoqmus`, read-only, captured 2026-08-31.

NO CUSTOMER DATA. Structure and counts only — no address, recipient name, phone or email
value is reproduced anywhere in this file.

## Row counts

| table | rows |
|---|---|
| `couranr_deliveries` | 26 |
| `couranr_delivery_assignments` | 20 |
| `couranr_delivery_events` | 68 |
| `couranr_delivery_request_events` | 550 |
| `couranr_delivery_requests` | 128 |
| `couranr_payment_events` | 325 |
| `couranr_payment_obligations` | 90 |
| `couranr_service_plans` | 51 |

## Foreign keys between spine tables

- `couranr_deliveries.couranr_dlv_obligation_fk` → `couranr_payment_obligations` — FOREIGN KEY (payment_obligation_id) REFERENCES couranr_payment_obligations(id) ON UPDATE CASCADE ON DELETE RESTRICT
- `couranr_deliveries.couranr_dlv_plan_fk` → `couranr_service_plans` — FOREIGN KEY (service_plan_id) REFERENCES couranr_service_plans(id) ON UPDATE CASCADE ON DELETE RESTRICT
- `couranr_deliveries.couranr_dlv_request_fk` → `couranr_delivery_requests` — FOREIGN KEY (request_id) REFERENCES couranr_delivery_requests(id) ON UPDATE CASCADE ON DELETE RESTRICT
- `couranr_delivery_assignments.couranr_asg_delivery_fk` → `couranr_deliveries` — FOREIGN KEY (delivery_id) REFERENCES couranr_deliveries(id) ON UPDATE CASCADE ON DELETE RESTRICT
- `couranr_delivery_events.couranr_dlve_delivery_fk` → `couranr_deliveries` — FOREIGN KEY (delivery_id) REFERENCES couranr_deliveries(id) ON UPDATE CASCADE ON DELETE RESTRICT
- `couranr_delivery_request_events.couranr_dre_request_fk` → `couranr_delivery_requests` — FOREIGN KEY (request_id) REFERENCES couranr_delivery_requests(id) ON UPDATE CASCADE ON DELETE RESTRICT
- `couranr_payment_events.couranr_pe_obligation_fk` → `couranr_payment_obligations` — FOREIGN KEY (obligation_id) REFERENCES couranr_payment_obligations(id) ON UPDATE CASCADE ON DELETE RESTRICT
- `couranr_payment_events.couranr_pe_request_fk` → `couranr_delivery_requests` — FOREIGN KEY (request_id) REFERENCES couranr_delivery_requests(id) ON UPDATE CASCADE ON DELETE RESTRICT
- `couranr_payment_obligations.couranr_po_request_fk` → `couranr_delivery_requests` — FOREIGN KEY (request_id) REFERENCES couranr_delivery_requests(id) ON UPDATE CASCADE ON DELETE RESTRICT
- `couranr_service_plans.couranr_sp_obligation_fk` → `couranr_payment_obligations` — FOREIGN KEY (payment_obligation_id) REFERENCES couranr_payment_obligations(id) ON UPDATE CASCADE ON DELETE RESTRICT
- `couranr_service_plans.couranr_sp_request_fk` → `couranr_delivery_requests` — FOREIGN KEY (request_id) REFERENCES couranr_delivery_requests(id) ON UPDATE CASCADE ON DELETE RESTRICT

## Structure per table

### `public.couranr_deliveries` — 26 rows

#### Columns

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `request_id` uuid NOT NULL
- `business_account_id` uuid NOT NULL
- `payment_obligation_id` uuid NOT NULL
- `service_plan_id` uuid NOT NULL
- `request_version` integer NOT NULL
- `pricing_policy_version` text NOT NULL
- `captured_amount_cents` integer NOT NULL
- `currency` text NOT NULL
- `pickup_address` jsonb NOT NULL
- `dropoff_address` jsonb NOT NULL
- `recipient` jsonb NOT NULL
- `shipment` jsonb NOT NULL
- `service_level` text NOT NULL
- `signature_required` boolean NOT NULL
- `proof_method` text NOT NULL
- `scheduled_pickup_start` timestamp with time zone NOT NULL
- `scheduled_pickup_end` timestamp with time zone NOT NULL
- `timezone` text NOT NULL
- `vehicle_id` uuid NULL
- `vehicle_requirement` jsonb NOT NULL
- `fulfillment_state` text NOT NULL DEFAULT 'scheduled'::text
- `version` integer NOT NULL DEFAULT 1
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

#### Constraints (PK / UNIQUE / CHECK / FK incl. ON UPDATE / ON DELETE)

- **CHECK** `couranr_dlv_amount_chk` — CHECK ((captured_amount_cents > 0))
- **CHECK** `couranr_dlv_currency_chk` — CHECK ((currency = 'usd'::text))
- **CHECK** `couranr_dlv_dropoff_obj_chk` — CHECK ((jsonb_typeof(dropoff_address) = 'object'::text))
- **CHECK** `couranr_dlv_fulfillment_chk` — CHECK ((fulfillment_state = ANY (ARRAY['scheduled'::text, 'assigned'::text, 'en_route_to_pickup'::text, 'at_pickup'::text, 'picked_up'::text, 'in_transit'::text, 'at_dropoff'::text, 'delivered'::text, 'could_not_deliver'::text, 'cancelled'::text])))
- **CHECK** `couranr_dlv_pickup_obj_chk` — CHECK ((jsonb_typeof(pickup_address) = 'object'::text))
- **CHECK** `couranr_dlv_proof_chk` — CHECK ((proof_method = ANY (ARRAY['photo_or_pin'::text, 'signature'::text, 'leave_at_door'::text])))
- **CHECK** `couranr_dlv_recipient_obj_chk` — CHECK ((jsonb_typeof(recipient) = 'object'::text))
- **CHECK** `couranr_dlv_requirement_obj_chk` — CHECK ((jsonb_typeof(vehicle_requirement) = 'object'::text))
- **CHECK** `couranr_dlv_service_level_chk` — CHECK ((service_level = ANY (ARRAY['standard'::text, 'priority'::text, 'rush'::text])))
- **CHECK** `couranr_dlv_shipment_obj_chk` — CHECK ((jsonb_typeof(shipment) = 'object'::text))
- **CHECK** `couranr_dlv_version_chk` — CHECK ((version >= 1))
- **CHECK** `couranr_dlv_window_chk` — CHECK ((scheduled_pickup_end > scheduled_pickup_start))
- **FOREIGN KEY** `couranr_dlv_business_fk` — FOREIGN KEY (business_account_id) REFERENCES business_accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT
- **FOREIGN KEY** `couranr_dlv_dispatch_vehicle_fk` — FOREIGN KEY (vehicle_id) REFERENCES couranr_dispatch_vehicles(id) ON UPDATE CASCADE ON DELETE RESTRICT
- **FOREIGN KEY** `couranr_dlv_obligation_fk` — FOREIGN KEY (payment_obligation_id) REFERENCES couranr_payment_obligations(id) ON UPDATE CASCADE ON DELETE RESTRICT
- **FOREIGN KEY** `couranr_dlv_plan_fk` — FOREIGN KEY (service_plan_id) REFERENCES couranr_service_plans(id) ON UPDATE CASCADE ON DELETE RESTRICT
- **FOREIGN KEY** `couranr_dlv_request_fk` — FOREIGN KEY (request_id) REFERENCES couranr_delivery_requests(id) ON UPDATE CASCADE ON DELETE RESTRICT
- **PRIMARY KEY** `couranr_deliveries_pkey` — PRIMARY KEY (id)
- **UNIQUE** `couranr_dlv_request_uniq` — UNIQUE (request_id)

#### Triggers

(none)

------------------------------------------------------------------------------------------

### `public.couranr_delivery_assignments` — 20 rows

#### Columns

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `delivery_id` uuid NOT NULL
- `driver_id` uuid NOT NULL
- `vehicle_id` uuid NOT NULL
- `assignment_state` text NOT NULL DEFAULT 'active'::text
- `assigned_by` uuid NOT NULL
- `assigned_at` timestamp with time zone NOT NULL DEFAULT now()
- `ended_at` timestamp with time zone NULL
- `end_reason` text NULL
- `idempotency_key` text NULL
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `version` integer NOT NULL DEFAULT 1

#### Constraints (PK / UNIQUE / CHECK / FK incl. ON UPDATE / ON DELETE)

- **CHECK** `couranr_asg_ended_stamp_chk` — CHECK (((assignment_state = 'active'::text) OR (ended_at IS NOT NULL)))
- **CHECK** `couranr_asg_state_chk` — CHECK ((assignment_state = ANY (ARRAY['active'::text, 'completed'::text, 'replaced'::text, 'cancelled'::text])))
- **CHECK** `couranr_asg_version_chk` — CHECK ((version >= 1))
- **FOREIGN KEY** `couranr_asg_assigned_by_fk` — FOREIGN KEY (assigned_by) REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE RESTRICT
- **FOREIGN KEY** `couranr_asg_delivery_fk` — FOREIGN KEY (delivery_id) REFERENCES couranr_deliveries(id) ON UPDATE CASCADE ON DELETE RESTRICT
- **FOREIGN KEY** `couranr_asg_driver_fk` — FOREIGN KEY (driver_id) REFERENCES couranr_drivers(id) ON UPDATE CASCADE ON DELETE RESTRICT
- **FOREIGN KEY** `couranr_asg_vehicle_fk` — FOREIGN KEY (vehicle_id) REFERENCES couranr_dispatch_vehicles(id) ON UPDATE CASCADE ON DELETE RESTRICT
- **PRIMARY KEY** `couranr_delivery_assignments_pkey` — PRIMARY KEY (id)

#### Triggers

(none)

------------------------------------------------------------------------------------------

### `public.couranr_delivery_events` — 68 rows

#### Columns

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `delivery_id` uuid NOT NULL
- `actor_user_id` uuid NULL
- `actor_type` text NOT NULL
- `command` text NOT NULL
- `from_state` text NULL
- `to_state` text NULL
- `metadata` jsonb NOT NULL DEFAULT '{}'::jsonb
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

#### Constraints (PK / UNIQUE / CHECK / FK incl. ON UPDATE / ON DELETE)

- **CHECK** `couranr_dlve_actor_present_chk` — CHECK ((((actor_type = 'system'::text) AND (actor_user_id IS NULL)) OR ((actor_type <> 'system'::text) AND (actor_user_id IS NOT NULL))))
- **CHECK** `couranr_dlve_actor_type_chk` — CHECK ((actor_type = ANY (ARRAY['merchant'::text, 'customer'::text, 'driver'::text, 'operations'::text, 'system'::text])))
- **CHECK** `couranr_dlve_command_chk` — CHECK ((command = ANY (ARRAY['create_delivery_from_capture'::text, 'assign_delivery'::text, 'unassign_delivery_before_pickup'::text, 'start_route_to_pickup'::text, 'arrive_at_pickup'::text, 'report_pickup_discrepancy'::text, 'resolve_pickup_discrepancy_safe_to_continue'::text, 'complete_pickup'::text, 'start_route_to_dropoff'::text, 'arrive_at_dropoff'::text, 'complete_direct_handoff_delivery'::text, 'complete_signature_delivery'::text, 'complete_leave_at_door_delivery'::text])))
- **CHECK** `couranr_dlve_metadata_obj_chk` — CHECK ((jsonb_typeof(metadata) = 'object'::text))
- **FOREIGN KEY** `couranr_dlve_delivery_fk` — FOREIGN KEY (delivery_id) REFERENCES couranr_deliveries(id) ON UPDATE CASCADE ON DELETE RESTRICT
- **PRIMARY KEY** `couranr_delivery_events_pkey` — PRIMARY KEY (id)

#### Triggers

(none)

------------------------------------------------------------------------------------------

### `public.couranr_delivery_request_events` — 550 rows

#### Columns

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `request_id` uuid NOT NULL
- `actor_user_id` uuid NULL
- `actor_type` text NOT NULL
- `command` text NOT NULL
- `from_state` text NULL
- `to_state` text NULL
- `metadata` jsonb NOT NULL DEFAULT '{}'::jsonb
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

#### Constraints (PK / UNIQUE / CHECK / FK incl. ON UPDATE / ON DELETE)

- **CHECK** `couranr_dre_actor_present_chk` — CHECK ((((actor_type = 'system'::text) AND (actor_user_id IS NULL)) OR ((actor_type <> 'system'::text) AND (actor_user_id IS NOT NULL))))
- **CHECK** `couranr_dre_actor_type_chk` — CHECK ((actor_type = ANY (ARRAY['merchant'::text, 'customer'::text, 'driver'::text, 'operations'::text, 'system'::text])))
- **CHECK** `couranr_dre_command_chk` — CHECK ((command = ANY (ARRAY['create_delivery_request_draft'::text, 'calculate_delivery_request_estimate'::text, 'submit_delivery_request'::text, 'begin_delivery_request_review'::text, 'accept_delivery_request_as_quoted'::text, 'requote_delivery_request'::text, 'decline_delivery_request'::text, 'record_payer_quote_approval'::text, 'begin_delivery_preparation'::text, 'mark_delivery_ready'::text, 'mark_delivery_not_ready'::text, 'mark_delivery_unavailable'::text])))
- **CHECK** `couranr_dre_metadata_is_object_chk` — CHECK ((jsonb_typeof(metadata) = 'object'::text))
- **FOREIGN KEY** `couranr_dre_request_fk` — FOREIGN KEY (request_id) REFERENCES couranr_delivery_requests(id) ON UPDATE CASCADE ON DELETE RESTRICT
- **PRIMARY KEY** `couranr_delivery_request_events_pkey` — PRIMARY KEY (id)

#### Triggers

(none)

------------------------------------------------------------------------------------------

### `public.couranr_delivery_requests` — 128 rows

#### Columns

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `business_account_id` uuid NOT NULL
- `created_by` uuid NOT NULL
- `idempotency_key` text NOT NULL
- `source` text NOT NULL DEFAULT 'merchant_portal'::text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `submitted_at` timestamp with time zone NULL
- `version` integer NOT NULL DEFAULT 1
- `request_state` text NOT NULL DEFAULT 'draft'::text
- `readiness_state` text NOT NULL DEFAULT 'not_confirmed'::text
- `review_state` text NOT NULL DEFAULT 'not_required'::text
- `service_area_review_state` text NOT NULL DEFAULT 'pending'::text
- `payer_type` text NOT NULL DEFAULT 'merchant'::text
- `quote_status` text NOT NULL DEFAULT 'not_quoted'::text
- `recipient_name` text NULL
- `recipient_phone` text NULL
- `recipient_email` text NULL
- `loaded_miles` numeric(8,3) NULL
- `weight_lb` numeric(8,2) NULL
- `additional_stops` integer NOT NULL DEFAULT 0
- `service_level` text NOT NULL DEFAULT 'standard'::text
- `signature_required` boolean NOT NULL DEFAULT false
- `proof_method` text NOT NULL DEFAULT 'photo_or_pin'::text
- `pricing_policy_version` text NULL
- `delivery_subtotal_cents` integer NULL
- `included_loaded_miles` integer NULL
- `billable_loaded_miles` numeric(8,3) NULL
- `rounding_applied` boolean NOT NULL DEFAULT false
- `tax_included` boolean NOT NULL DEFAULT false
- `payment_due_cents` integer NULL
- `quote_line_items` jsonb NOT NULL DEFAULT '[]'::jsonb
- `review_reasons` jsonb NOT NULL DEFAULT '[]'::jsonb
- `pickup_address` jsonb NULL
- `dropoff_address` jsonb NULL
- `normalized_request_payload` jsonb NOT NULL DEFAULT '{}'::jsonb
- `preset_id` uuid NULL
- `preset_version` integer NULL
- `preset_snapshot` jsonb NULL
- `preset_source` text NULL

#### Constraints (PK / UNIQUE / CHECK / FK incl. ON UPDATE / ON DELETE)

- **CHECK** `couranr_dr_billable_miles_nonneg_chk` — CHECK (((billable_loaded_miles IS NULL) OR (billable_loaded_miles >= (0)::numeric)))
- **CHECK** `couranr_dr_dropoff_is_object_chk` — CHECK (((dropoff_address IS NULL) OR (jsonb_typeof(dropoff_address) = 'object'::text)))
- **CHECK** `couranr_dr_estimate_completeness_chk` — CHECK ((((quote_status = 'estimated'::text) AND (delivery_subtotal_cents IS NOT NULL) AND (pricing_policy_version IS NOT NULL)) OR (quote_status <> 'estimated'::text)))
- **CHECK** `couranr_dr_included_miles_nonneg_chk` — CHECK (((included_loaded_miles IS NULL) OR (included_loaded_miles >= 0)))
- **CHECK** `couranr_dr_line_items_is_array_chk` — CHECK ((jsonb_typeof(quote_line_items) = 'array'::text))
- **CHECK** `couranr_dr_manual_review_chk` — CHECK (((quote_status <> 'manual_review_required'::text) OR (delivery_subtotal_cents IS NULL)))
- **CHECK** `couranr_dr_miles_nonneg_chk` — CHECK (((loaded_miles IS NULL) OR (loaded_miles >= (0)::numeric)))
- **CHECK** `couranr_dr_no_payment_due_chk` — CHECK ((payment_due_cents IS NULL))
- **CHECK** `couranr_dr_no_rounding_chk` — CHECK ((rounding_applied = false))
- **CHECK** `couranr_dr_no_tax_chk` — CHECK ((tax_included = false))
- **CHECK** `couranr_dr_normalized_is_object_chk` — CHECK ((jsonb_typeof(normalized_request_payload) = 'object'::text))
- **CHECK** `couranr_dr_payer_type_chk` — CHECK ((payer_type = ANY (ARRAY['merchant'::text, 'customer'::text])))
- **CHECK** `couranr_dr_payment_due_nonneg_chk` — CHECK (((payment_due_cents IS NULL) OR (payment_due_cents >= 0)))
- **CHECK** `couranr_dr_pickup_is_object_chk` — CHECK (((pickup_address IS NULL) OR (jsonb_typeof(pickup_address) = 'object'::text)))
- **CHECK** `couranr_dr_preset_body_chk` — CHECK (couranr_preset_body_is_clean(preset_snapshot))
- **CHECK** `couranr_dr_preset_pair_chk` — CHECK ((((preset_id IS NULL) AND (preset_version IS NULL) AND (preset_snapshot IS NULL) AND (preset_source IS NULL)) OR ((preset_id IS NOT NULL) AND (preset_version >= 1) AND (preset_snapshot IS NOT NULL) AND (preset_source IS NOT NULL))))
- **CHECK** `couranr_dr_preset_source_chk` — CHECK (((preset_source IS NULL) OR (preset_source = ANY (ARRAY['couranr_global'::text, 'merchant'::text]))))
- **CHECK** `couranr_dr_proof_method_chk` — CHECK ((proof_method = ANY (ARRAY['photo_or_pin'::text, 'signature'::text, 'leave_at_door'::text])))
- **CHECK** `couranr_dr_quote_status_chk` — CHECK ((quote_status = ANY (ARRAY['not_quoted'::text, 'estimated'::text, 'manual_review_required'::text, 'invalid'::text])))
- **CHECK** `couranr_dr_readiness_state_chk` — CHECK ((readiness_state = ANY (ARRAY['not_confirmed'::text, 'preparing'::text, 'ready'::text, 'not_ready'::text, 'unavailable'::text])))
- **CHECK** `couranr_dr_request_state_chk` — CHECK ((request_state = ANY (ARRAY['draft'::text, 'awaiting_merchant_confirmation'::text, 'awaiting_quote_acceptance'::text, 'pending_couranr_review'::text, 'quote_revision_required'::text, 'confirmed'::text, 'declined'::text, 'cancelled'::text, 'closed'::text])))
- **CHECK** `couranr_dr_review_reasons_is_array_chk` — CHECK ((jsonb_typeof(review_reasons) = 'array'::text))
- **CHECK** `couranr_dr_review_state_chk` — CHECK ((review_state = ANY (ARRAY['not_required'::text, 'pending'::text, 'accepted_as_quoted'::text, 'requoted'::text, 'declined'::text])))
- **CHECK** `couranr_dr_service_area_state_chk` — CHECK ((service_area_review_state = ANY (ARRAY['pending'::text, 'in_area'::text, 'out_of_area_review'::text, 'declined'::text])))
- **CHECK** `couranr_dr_service_level_chk` — CHECK ((service_level = ANY (ARRAY['standard'::text, 'priority'::text, 'rush'::text])))
- **CHECK** `couranr_dr_source_chk` — CHECK ((source = ANY (ARRAY['merchant_portal'::text, 'smart_intake'::text, 'hosted_request'::text, 'operations'::text])))
- **CHECK** `couranr_dr_stops_nonneg_chk` — CHECK ((additional_stops >= 0))
- **CHECK** `couranr_dr_submitted_at_chk` — CHECK ((((request_state = ANY (ARRAY['draft'::text, 'awaiting_merchant_confirmation'::text])) AND (submitted_at IS NULL)) OR ((request_state <> ALL (ARRAY['draft'::text, 'awaiting_merchant_confirmation'::text])) AND (submitted_at IS NOT NULL))))
- **CHECK** `couranr_dr_subtotal_nonneg_chk` — CHECK (((delivery_subtotal_cents IS NULL) OR (delivery_subtotal_cents >= 0)))
- **CHECK** `couranr_dr_version_positive_chk` — CHECK ((version >= 1))
- **CHECK** `couranr_dr_weight_nonneg_chk` — CHECK (((weight_lb IS NULL) OR (weight_lb >= (0)::numeric)))
- **FOREIGN KEY** `couranr_delivery_requests_business_fk` — FOREIGN KEY (business_account_id) REFERENCES business_accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT
- **FOREIGN KEY** `couranr_delivery_requests_created_by_fk` — FOREIGN KEY (created_by) REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE RESTRICT
- **PRIMARY KEY** `couranr_delivery_requests_pkey` — PRIMARY KEY (id)
- **UNIQUE** `couranr_delivery_requests_idempotency_uniq` — UNIQUE (business_account_id, idempotency_key)

#### Triggers

(none)

------------------------------------------------------------------------------------------

### `public.couranr_payment_events` — 325 rows

#### Columns

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `obligation_id` uuid NULL
- `request_id` uuid NULL
- `provider` text NOT NULL DEFAULT 'stripe'::text
- `provider_event_id` text NOT NULL
- `event_type` text NOT NULL
- `payment_state_before` text NULL
- `payment_state_after` text NULL
- `outcome` text NOT NULL
- `detail` jsonb NOT NULL DEFAULT '{}'::jsonb
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

#### Constraints (PK / UNIQUE / CHECK / FK incl. ON UPDATE / ON DELETE)

- **CHECK** `couranr_pe_detail_is_object_chk` — CHECK ((jsonb_typeof(detail) = 'object'::text))
- **CHECK** `couranr_pe_outcome_chk` — CHECK ((outcome = ANY (ARRAY['applied'::text, 'ignored'::text, 'rejected'::text])))
- **CHECK** `couranr_pe_provider_chk` — CHECK ((provider = 'stripe'::text))
- **FOREIGN KEY** `couranr_pe_obligation_fk` — FOREIGN KEY (obligation_id) REFERENCES couranr_payment_obligations(id) ON UPDATE CASCADE ON DELETE RESTRICT
- **FOREIGN KEY** `couranr_pe_request_fk` — FOREIGN KEY (request_id) REFERENCES couranr_delivery_requests(id) ON UPDATE CASCADE ON DELETE RESTRICT
- **PRIMARY KEY** `couranr_payment_events_pkey` — PRIMARY KEY (id)
- **UNIQUE** `couranr_pe_provider_event_uniq` — UNIQUE (provider, provider_event_id)

#### Triggers

(none)

------------------------------------------------------------------------------------------

### `public.couranr_payment_obligations` — 90 rows

#### Columns

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `request_id` uuid NOT NULL
- `business_account_id` uuid NOT NULL
- `payer_type` text NOT NULL
- `request_version` integer NOT NULL
- `pricing_policy_version` text NOT NULL
- `amount_cents` integer NOT NULL
- `currency` text NOT NULL DEFAULT 'usd'::text
- `payment_state` text NOT NULL DEFAULT 'not_started'::text
- `provider` text NOT NULL DEFAULT 'stripe'::text
- `provider_payment_intent_id` text NULL
- `idempotency_key` text NOT NULL
- `version` integer NOT NULL DEFAULT 1
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `authorized_at` timestamp with time zone NULL
- `failed_at` timestamp with time zone NULL
- `cancelled_at` timestamp with time zone NULL
- `captured_at` timestamp with time zone NULL
- `captured_amount_cents` integer NULL
- `capture_requested_at` timestamp with time zone NULL

#### Constraints (PK / UNIQUE / CHECK / FK incl. ON UPDATE / ON DELETE)

- **CHECK** `couranr_po_amount_positive_chk` — CHECK ((amount_cents > 0))
- **CHECK** `couranr_po_authorized_needs_intent_chk` — CHECK (((payment_state <> 'authorized'::text) OR (provider_payment_intent_id IS NOT NULL)))
- **CHECK** `couranr_po_authorized_stamp_chk` — CHECK (((payment_state <> ALL (ARRAY['authorized'::text, 'capture_pending'::text, 'captured'::text, 'refunded'::text])) OR (authorized_at IS NOT NULL)))
- **CHECK** `couranr_po_cancelled_stamp_chk` — CHECK (((payment_state = 'cancelled'::text) = (cancelled_at IS NOT NULL)))
- **CHECK** `couranr_po_captured_amount_chk` — CHECK (((captured_amount_cents IS NULL) OR (captured_amount_cents = amount_cents)))
- **CHECK** `couranr_po_captured_stamp_chk` — CHECK (((payment_state <> ALL (ARRAY['captured'::text, 'refunded'::text])) OR ((captured_at IS NOT NULL) AND (captured_amount_cents IS NOT NULL))))
- **CHECK** `couranr_po_currency_chk` — CHECK ((currency = 'usd'::text))
- **CHECK** `couranr_po_failed_stamp_chk` — CHECK (((payment_state <> 'failed'::text) OR (failed_at IS NOT NULL)))
- **CHECK** `couranr_po_payer_type_chk` — CHECK ((payer_type = ANY (ARRAY['merchant'::text, 'customer'::text])))
- **CHECK** `couranr_po_payment_state_chk` — CHECK ((payment_state = ANY (ARRAY['not_started'::text, 'requires_action'::text, 'authorized'::text, 'capture_pending'::text, 'captured'::text, 'failed'::text, 'cancelled'::text, 'refunded'::text, 'partially_refunded'::text, 'payment_method_saved'::text])))
- **CHECK** `couranr_po_provider_chk` — CHECK ((provider = 'stripe'::text))
- **CHECK** `couranr_po_request_version_chk` — CHECK ((request_version >= 1))
- **CHECK** `couranr_po_version_chk` — CHECK ((version >= 1))
- **FOREIGN KEY** `couranr_po_business_fk` — FOREIGN KEY (business_account_id) REFERENCES business_accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT
- **FOREIGN KEY** `couranr_po_request_fk` — FOREIGN KEY (request_id) REFERENCES couranr_delivery_requests(id) ON UPDATE CASCADE ON DELETE RESTRICT
- **PRIMARY KEY** `couranr_payment_obligations_pkey` — PRIMARY KEY (id)
- **UNIQUE** `couranr_po_idempotency_uniq` — UNIQUE (request_id, idempotency_key)
- **UNIQUE** `couranr_po_intent_uniq` — UNIQUE (provider_payment_intent_id)

#### Triggers

(none)

------------------------------------------------------------------------------------------

### `public.couranr_service_plans` — 51 rows

#### Columns

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `request_id` uuid NOT NULL
- `business_account_id` uuid NOT NULL
- `payment_obligation_id` uuid NOT NULL
- `request_version` integer NOT NULL
- `scheduled_pickup_start` timestamp with time zone NOT NULL
- `scheduled_pickup_end` timestamp with time zone NOT NULL
- `timezone` text NOT NULL
- `vehicle_id` uuid NULL
- `vehicle_requirement` jsonb NOT NULL
- `plan_state` text NOT NULL DEFAULT 'draft'::text
- `confirmed_by` uuid NULL
- `confirmed_at` timestamp with time zone NULL
- `version` integer NOT NULL DEFAULT 1
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

#### Constraints (PK / UNIQUE / CHECK / FK incl. ON UPDATE / ON DELETE)

- **CHECK** `couranr_sp_confirmed_stamp_chk` — CHECK (((plan_state <> 'confirmed'::text) OR ((confirmed_at IS NOT NULL) AND (confirmed_by IS NOT NULL))))
- **CHECK** `couranr_sp_plan_state_chk` — CHECK ((plan_state = ANY (ARRAY['draft'::text, 'confirmed'::text, 'cancelled'::text])))
- **CHECK** `couranr_sp_requirement_is_object_chk` — CHECK ((jsonb_typeof(vehicle_requirement) = 'object'::text))
- **CHECK** `couranr_sp_timezone_chk` — CHECK ((length(btrim(timezone)) > 0))
- **CHECK** `couranr_sp_version_chk` — CHECK ((version >= 1))
- **CHECK** `couranr_sp_window_chk` — CHECK ((scheduled_pickup_end > scheduled_pickup_start))
- **FOREIGN KEY** `couranr_sp_business_fk` — FOREIGN KEY (business_account_id) REFERENCES business_accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT
- **FOREIGN KEY** `couranr_sp_dispatch_vehicle_fk` — FOREIGN KEY (vehicle_id) REFERENCES couranr_dispatch_vehicles(id) ON UPDATE CASCADE ON DELETE RESTRICT
- **FOREIGN KEY** `couranr_sp_obligation_fk` — FOREIGN KEY (payment_obligation_id) REFERENCES couranr_payment_obligations(id) ON UPDATE CASCADE ON DELETE RESTRICT
- **FOREIGN KEY** `couranr_sp_request_fk` — FOREIGN KEY (request_id) REFERENCES couranr_delivery_requests(id) ON UPDATE CASCADE ON DELETE RESTRICT
- **PRIMARY KEY** `couranr_service_plans_pkey` — PRIMARY KEY (id)

#### Triggers

(none)

## Functions whose body references any spine table

- `public.couranr_accept_delivery_request_as_quoted(p_request_id uuid, p_business_account_id uuid, p_expected_version integer, p_actor_user_id uuid)` — security=invoker
- `public.couranr_apply_payment_intent_state(p_provider_event_id text, p_event_type text, p_payment_intent_id text, p_intent_status text, p_amount integer, p_amount_capturable integer, p_currency text, p_metadata jsonb)` — security=invoker
- `public.couranr_apply_readiness(p_request_id uuid, p_business_account_id uuid, p_expected_version integer, p_actor_user_id uuid, p_command text, p_to text, p_from text[])` — security=invoker
- `public.couranr_arrive_at_dropoff(p_delivery_id uuid, p_expected_version integer, p_actor_user_id uuid, p_latitude numeric, p_longitude numeric, p_accuracy_m numeric)` — security=invoker
- `public.couranr_arrive_at_pickup(p_delivery_id uuid, p_expected_version integer, p_actor_user_id uuid, p_latitude numeric, p_longitude numeric, p_accuracy_m numeric)` — security=invoker
- `public.couranr_assert_dropoff_ready(p_delivery_id uuid, p_actor_user_id uuid, p_proof_method text, p_latitude numeric, p_longitude numeric)` — security=invoker
- `public.couranr_assert_readiness_mutable(p_request_id uuid)` — security=invoker
- `public.couranr_assign_delivery(p_delivery_id uuid, p_expected_version integer, p_actor_user_id uuid, p_driver_id uuid, p_vehicle_id uuid, p_idempotency_key text)` — security=invoker
- `public.couranr_attach_payment_intent(p_obligation_id uuid, p_expected_version integer, p_payment_intent_id text)` — security=invoker
- `public.couranr_begin_delivery_request_review(p_request_id uuid, p_business_account_id uuid, p_expected_version integer, p_actor_user_id uuid)` — security=invoker
- `public.couranr_begin_payment_capture(p_request_id uuid, p_actor_user_id uuid)` — security=invoker
- `public.couranr_begin_payment_release(p_obligation_id uuid, p_actor_user_id uuid, p_expected_version integer, p_reason text)` — security=invoker
- `public.couranr_calculate_delivery_request_estimate(p_request_id uuid, p_business_account_id uuid, p_expected_version integer, p_actor_user_id uuid, p_update_shipment boolean, p_source text, p_readiness_state text, p_payer_type text, p_recipient_name text, p_recipient_phone text, p_recipient_email text, p_loaded_miles numeric, p_weight_lb numeric, p_additional_stops integer, p_service_level text, p_signature_required boolean, p_proof_method text, p_pickup_address jsonb, p_dropoff_address jsonb, p_overnight_requested boolean, p_quote_status text, p_pricing_policy_version text, p_delivery_subtotal_cents integer, p_included_loaded_miles integer, p_billable_loaded_miles numeric, p_quote_line_items jsonb, p_review_reasons jsonb)` — security=invoker
- `public.couranr_cancel_service_plan(p_request_id uuid, p_reason text)` — security=invoker
- `public.couranr_complete_direct_handoff_delivery(p_delivery_id uuid, p_expected_version integer, p_actor_user_id uuid, p_recipient_first_name text, p_latitude numeric, p_longitude numeric, p_accuracy_m numeric)` — security=invoker
- `public.couranr_complete_leave_at_door_delivery(p_delivery_id uuid, p_expected_version integer, p_actor_user_id uuid, p_safe_location boolean, p_weather_suitable boolean, p_latitude numeric, p_longitude numeric, p_accuracy_m numeric)` — security=invoker
- `public.couranr_complete_payment_capture(p_obligation_id uuid, p_provider_event_id text, p_payment_intent_id text, p_intent_status text, p_amount_received integer, p_currency text)` — security=invoker
- `public.couranr_complete_payment_release(p_obligation_id uuid, p_payment_intent_id text, p_intent_status text)` — security=invoker
- `public.couranr_complete_pickup(p_delivery_id uuid, p_expected_version integer, p_actor_user_id uuid, p_observed_package_count integer, p_staff_first_name text, p_confirmed_vehicle_id uuid, p_latitude numeric, p_longitude numeric, p_accuracy_m numeric, p_dimensions jsonb, p_loading_participants text, p_loading_equipment text, p_existing_damage text, p_driver_acknowledged boolean)` — security=invoker
- `public.couranr_complete_signature_delivery(p_delivery_id uuid, p_expected_version integer, p_actor_user_id uuid, p_signer_first_name text, p_latitude numeric, p_longitude numeric, p_accuracy_m numeric)` — security=invoker
- `public.couranr_confirm_service_plan(p_request_id uuid, p_expected_version integer, p_actor_user_id uuid, p_pickup_start timestamp with time zone, p_pickup_end timestamp with time zone, p_timezone text, p_vehicle_id uuid, p_vehicle_requirement jsonb)` — security=invoker
- `public.couranr_create_delivery_from_capture(p_request_id uuid)` — security=invoker
- `public.couranr_create_delivery_request_draft(p_business_account_id uuid, p_created_by uuid, p_idempotency_key text, p_source text, p_readiness_state text, p_payer_type text, p_recipient_name text, p_recipient_phone text, p_recipient_email text, p_loaded_miles numeric, p_weight_lb numeric, p_additional_stops integer, p_service_level text, p_signature_required boolean, p_proof_method text, p_pickup_address jsonb, p_dropoff_address jsonb, p_overnight_requested boolean, p_quote_status text, p_pricing_policy_version text, p_delivery_subtotal_cents integer, p_included_loaded_miles integer, p_billable_loaded_miles numeric, p_quote_line_items jsonb, p_review_reasons jsonb)` — security=invoker
- `public.couranr_create_payment_obligation(p_request_id uuid, p_business_account_id uuid, p_idempotency_key text)` — security=invoker
- `public.couranr_create_proof_upload(p_delivery_id uuid, p_actor_user_id uuid, p_proof_stage text, p_proof_type text, p_storage_bucket text, p_object_path text, p_expected_mime text, p_expected_bytes integer, p_upload_nonce text, p_ttl_minutes integer)` — security=invoker
- `public.couranr_decline_delivery_request(p_request_id uuid, p_business_account_id uuid, p_expected_version integer, p_actor_user_id uuid, p_decline_reason text, p_internal_note text)` — security=invoker
- `public.couranr_driver_assignment_for(p_delivery_id uuid, p_actor_user_id uuid)` — security=invoker
- `public.couranr_driver_completion_receipt(p_actor_user_id uuid)` — security=invoker
- `public.couranr_fail_payment_capture(p_obligation_id uuid, p_provider_event_id text, p_reason text)` — security=invoker
- `public.couranr_finalize_proof_upload(p_upload_id uuid, p_actor_user_id uuid, p_actual_path text, p_actual_bytes integer, p_actual_mime text, p_latitude numeric, p_longitude numeric, p_accuracy_m numeric, p_discrepancy_id uuid, p_metadata jsonb)` — security=invoker
- `public.couranr_finish_delivered(p_delivery_id uuid, p_expected_version integer, p_actor_user_id uuid, p_assignment_id uuid, p_command text, p_metadata jsonb)` — security=invoker
- `public.couranr_issue_delivery_access_token(p_request_id uuid, p_token_hash text, p_ttl_days integer)` — security=invoker
- `public.couranr_issue_handoff_code(p_delivery_id uuid, p_code_kind text, p_code_digest text, p_actor_user_id uuid, p_ttl_minutes integer)` — security=invoker
- `public.couranr_issue_help_token(p_delivery_id uuid, p_token_hash text, p_ttl_days integer)` — security=definer
- `public.couranr_issue_payment_access_token(p_request_id uuid, p_obligation_id uuid, p_token_hash text, p_ttl_days integer)` — security=invoker
- `public.couranr_record_test_delivery(p_business_account_id uuid, p_actor_user_id uuid, p_request_id uuid)` — security=invoker
- `public.couranr_redeem_delivery_access_token(p_token_hash text)` — security=invoker
- `public.couranr_redeem_payment_access_token(p_token_hash text)` — security=invoker
- `public.couranr_replace_delivery_assignment(p_delivery_id uuid, p_expected_assignment_version integer, p_actor_user_id uuid, p_driver_id uuid, p_vehicle_id uuid, p_reason text, p_idempotency_key text)` — security=invoker
- `public.couranr_report_pickup_discrepancy(p_delivery_id uuid, p_actor_user_id uuid, p_reason text, p_notes text)` — security=invoker
- `public.couranr_requote_delivery_request(p_request_id uuid, p_business_account_id uuid, p_expected_version integer, p_actor_user_id uuid, p_pricing_policy_version text, p_delivery_subtotal_cents integer, p_included_loaded_miles integer, p_billable_loaded_miles numeric, p_quote_line_items jsonb, p_requote_reason text)` — security=invoker
- `public.couranr_resolve_pickup_discrepancy_safe_to_continue(p_discrepancy_id uuid, p_expected_version integer, p_actor_user_id uuid, p_note text)` — security=invoker
- `public.couranr_resolve_terminal_capture_failure(p_obligation_id uuid, p_provider_event_id text, p_payment_intent_id text, p_intent_status text, p_amount integer, p_currency text, p_failure_code text)` — security=invoker
- `public.couranr_start_route_to_dropoff(p_delivery_id uuid, p_expected_version integer, p_actor_user_id uuid)` — security=invoker
- `public.couranr_start_route_to_pickup(p_delivery_id uuid, p_expected_version integer, p_actor_user_id uuid)` — security=invoker
- `public.couranr_submit_delivery_request(p_request_id uuid, p_business_account_id uuid, p_expected_version integer, p_actor_user_id uuid, p_quote_status text, p_pricing_policy_version text, p_delivery_subtotal_cents integer, p_included_loaded_miles integer, p_billable_loaded_miles numeric, p_quote_line_items jsonb, p_review_reasons jsonb, p_merchant_acknowledged boolean)` — security=invoker
- `public.couranr_unassign_delivery_before_pickup(p_delivery_id uuid, p_expected_version integer, p_actor_user_id uuid, p_reason text)` — security=invoker
