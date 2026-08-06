-- ---------------------------------------------------------------------
-- ROLLBACK for 20260806200000_couranr_preset_commands
--
-- SAFE. This drops COMMANDS only — no table, no column, no row.
--
-- After running it the preset tables still hold every preset, every version
-- and every delivery snapshot; nothing can WRITE a preset until the commands
-- are restored. That is the intended way to disable the feature, and it is
-- why this file needs no commented-out section: there is nothing here whose
-- removal loses data.
--
-- Order matters only for the shared gate, which the five commands call.
-- ---------------------------------------------------------------------

drop function if exists public.couranr_set_merchant_preset_archived(uuid, uuid, uuid, boolean);
drop function if exists public.couranr_duplicate_merchant_preset(uuid, uuid, uuid, text);
drop function if exists public.couranr_adopt_preset_recommendation(uuid, uuid, uuid, integer);
drop function if exists public.couranr_update_merchant_preset(uuid, uuid, uuid, text, jsonb, integer);
drop function if exists public.couranr_create_merchant_preset(uuid, uuid, text, jsonb, uuid);

-- Dropped last: the five above call it.
drop function if exists public.couranr_require_preset_manager(uuid, uuid);
