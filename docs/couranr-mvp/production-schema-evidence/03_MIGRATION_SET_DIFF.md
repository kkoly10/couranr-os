# Migration set difference

Production `zrdxlrlqxdslqpnoqmus` vs `supabase/migrations` in this repository.

Set membership is computed on **version**, the value Supabase records in
`supabase_migrations.schema_migrations` and the value that determines whether a
migration counts as applied. Names are carried as a separate observed field.

- production applied: **50**
- repository files: **56**
- present in both (by version): **50**
- production only: **0**
- repository only: **6**

## A. Present in both

| version | production name | repository name | same name |
|---|---|---|---|
| 20260731045417 | couranr_delivery_requests | couranr_delivery_requests | yes |
| 20260731055802 | couranr_request_commands | couranr_request_commands | yes |
| 20260731061356 | couranr_merchant_workspace | couranr_merchant_workspace | yes |
| 20260731180000 | couranr_review_outcomes | couranr_review_outcomes | yes |
| 20260731193000 | couranr_ack_conflict_code | couranr_ack_conflict_code | yes |
| 20260731210000 | couranr_decline_reasons_v1 | couranr_decline_reasons_v1 | yes |
| 20260731230000 | couranr_payment_authorization | couranr_payment_authorization | yes |
| 20260731233000 | couranr_payment_commands | couranr_payment_commands | yes |
| 20260731234500 | couranr_fix_redeem_ambiguity | couranr_fix_redeem_ambiguity | yes |
| 20260801083000 | couranr_service_plan_and_deliveries | couranr_service_plan_and_deliveries | yes |
| 20260801090000 | couranr_merchant_readiness | couranr_merchant_readiness | yes |
| 20260801093000 | couranr_capture_and_conversion | couranr_capture_and_conversion | yes |
| 20260801100000 | couranr_readiness_quote_check_fix | couranr_readiness_quote_check_fix | yes |
| 20260801103000 | couranr_payment_stamp_checks_fix | couranr_payment_stamp_checks_fix | yes |
| 20260801110000 | couranr_payment_vocabulary | couranr_payment_vocabulary | yes |
| 20260801120000 | couranr_terminal_capture_resolution | couranr_terminal_capture_resolution | yes |
| 20260801121000 | couranr_capture_pending_webhook_guard | couranr_capture_pending_webhook_guard | yes |
| 20260801122000 | couranr_obligation_generation_key | couranr_obligation_generation_key | yes |
| 20260801130000 | couranr_obligation_supersede_guard | couranr_obligation_supersede_guard | yes |
| 20260801190000 | couranr_managed_dispatch | couranr_managed_dispatch | yes |
| 20260801193000 | couranr_dispatch_commands | couranr_dispatch_commands | yes |
| 20260801200000 | couranr_dispatch_named_transitions | couranr_dispatch_named_transitions | yes |
| 20260801210000 | couranr_dispatch_event_commands | couranr_dispatch_event_commands | yes |
| 20260802020000 | couranr_dispatch_driver_execution_vocabulary | couranr_dispatch_driver_execution_vocabulary | yes |
| 20260802030000 | couranr_dispatch_driver_execution_tables | couranr_dispatch_driver_execution_tables | yes |
| 20260802040000 | couranr_dispatch_proof_authorization_corrections | couranr_dispatch_proof_authorization_corrections | yes |
| 20260802050000 | couranr_dispatch_driver_execution_commands | couranr_dispatch_driver_execution_commands | yes |
| 20260802060000 | couranr_dispatch_driver_completion_commands | couranr_dispatch_driver_completion_commands | yes |
| 20260802070000 | couranr_dispatch_verify_handoff_code_actor_scope | couranr_dispatch_verify_handoff_code_actor_scope | yes |
| 20260804090000 | couranr_delivery_access_tokens | couranr_delivery_access_tokens | yes |
| 20260804120000 | sec001_profiles_role_privilege | sec001_profiles_role_privilege | yes |
| 20260804150000 | couranr_conversations | couranr_conversations | yes |
| 20260804160000 | couranr_delivery_help | couranr_delivery_help | yes |
| 20260804170000 | couranr_conversation_kind_and_tenure | couranr_conversation_kind_and_tenure | yes |
| 20260804180000 | couranr_conversation_hardening | couranr_conversation_hardening | yes |
| 20260804190000 | couranr_conversation_awaiting_reply | couranr_conversation_awaiting_reply | yes |
| 20260804200000 | couranr_help_hardening | couranr_help_hardening | yes |
| 20260804210000 | couranr_participant_help_token_fk | couranr_participant_help_token_fk | yes |
| 20260806010000 | couranr_operating_hours | couranr_operating_hours | yes |
| 20260806120353 | couranr_private_and_analytics_schemas | couranr_private_and_analytics_schemas | yes |
| 20260806120616 | couranr_team_management | couranr_team_management | yes |
| 20260806120629 | couranr_business_members_rls_hardening | couranr_business_members_rls_hardening | yes |
| 20260806120648 | couranr_website_tool_configs | couranr_website_tool_configs | yes |
| 20260806160353 | couranr_merchant_customers | couranr_merchant_customers | yes |
| 20260806160443 | couranr_business_categories | couranr_business_categories | yes |
| 20260806160522 | couranr_delivery_presets | couranr_delivery_presets | yes |
| 20260806160757 | couranr_workspace_activation | couranr_workspace_activation | yes |
| 20260806160839 | couranr_preset_commands | couranr_preset_commands | yes |
| 20260806195405 | couranr_release_authorization | couranr_release_authorization | yes |
| 20260806195438 | couranr_idempotency_records | couranr_idempotency_records | yes |

## B. Production only

Applied in production; no file with this version exists in the repository.

| version | production name |
|---|---|

## C. Repository only

Present in the repository; this version is not recorded as applied in production.

| version | repository name | git path |
|---|---|---|
| 20260901051549 | fnd_a_m1_universal_requester | supabase/migrations/20260901051549_fnd_a_m1_universal_requester.sql |
| 20260901051555 | fnd_a_m2_immutable_quote_schema | supabase/migrations/20260901051555_fnd_a_m2_immutable_quote_schema.sql |
| 20260901051601 | fnd_a_m3_deterministic_quote_backfill | supabase/migrations/20260901051601_fnd_a_m3_deterministic_quote_backfill.sql |
| 20260901051609 | fnd_a_m4_command_cutover | supabase/migrations/20260901051609_fnd_a_m4_command_cutover.sql |
| 20260901051617 | fnd_a_m5_invariant_cutover | supabase/migrations/20260901051617_fnd_a_m5_invariant_cutover.sql |
| 20260901051627 | fnd_a_m6_single_destination | supabase/migrations/20260901051627_fnd_a_m6_single_destination.sql |

## Observation: names appearing in both B and C

The following migration **names** occur in section B and in section C under
different versions. This is a recorded observation about the name strings only.
**No claim is made that the underlying SQL is the same**; comparing the actual
statements is outside the scope of this evidence pack.

| name | production version | repository version |
|---|---|---|

Names in B with no counterpart in C: (none)

Names in C with no counterpart in B: fnd_a_m1_universal_requester, fnd_a_m2_immutable_quote_schema, fnd_a_m3_deterministic_quote_backfill, fnd_a_m4_command_cutover, fnd_a_m5_invariant_cutover, fnd_a_m6_single_destination
