-- Migration: let a PIC change which duties one person may hold together.
--
-- WHY
-- DUTY_PAIRING in Index.html holds the church's answer -- Reader may also sing
-- or be on Altar Guild, Preacher does nothing else, Liturgist is Communion
-- Assistant 1. Right today, but it is a rule about how this congregation
-- staffs a Sunday, not a fact about software, and it will change before the
-- code does. _dutyPairingOverrides has been reading an override ahead of the
-- built-in list since the rules landed; this is where that override lives.
--
-- SHAPE
-- Reuses roster_duty_settings rather than adding a table, but note the key is
-- different: these rows are keyed by duty CATEGORY (usher, singer, communion),
-- not by role_id, because usher1 and usher2 cannot sensibly disagree about
-- whether an usher may also assist at communion. service_type is always 'all'
-- for them -- the rules do not vary between Traditional and Contemporary.
--
-- Null means "use the built-in list", as with every other column here, so an
-- empty column changes nothing. An empty ARRAY is different and meaningful: it
-- says this duty pairs with nothing, which is how a PIC marks a duty solo.
--
-- Safe to re-run.

ALTER TABLE roster_duty_settings
  ADD COLUMN IF NOT EXISTS may_pair_with JSONB;
