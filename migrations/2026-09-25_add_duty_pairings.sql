-- Migration: who goes with whom.
--
-- WHY
-- Rostering is not only "who is qualified and who is free". A church knows
-- that when Dorine leads, the band that reads her is Edwin or Luke on drums
-- and Esther or Aaron on keys; that Alison sings traditional Sundays with
-- Cynthia or Gina. Auto-Suggest had no way to hold that, so it produced
-- combinations that were individually valid and collectively wrong, and a PIC
-- fixed them by hand every month without the app ever learning why.
--
-- SHAPE
-- One row is one directional rule:
--     when <when_person> is on <when_role>, <then_role> should be one of
--     <then_people>
-- Directional on purpose. "Dorine on Liturgist means Esther or Aaron on keys"
-- does not mean "Esther on keys means Dorine leads" -- the second is a claim
-- nobody made, and inferring it would quietly narrow every Sunday Esther plays.
--
-- service_type is 'all', 'traditional' or 'contemporary', because the second
-- example above is explicitly about traditional Sundays.
--
-- strict says what to do when none of then_people are free:
--   false  prefer them, and fall back to the normal pool rather than leave the
--          cell empty. The right default: a pairing is about who works well
--          together, and a blank drummer is worse than an unfamiliar one.
--   true   only them. For a pairing that is not a preference at all -- a
--          trainee who must not be rostered without their mentor.
--
-- Several rows may name the same when_role/when_person; each carries one
-- then_role, so "Dorine leads" can set both the drummer and the pianist
-- without either row having to know about the other.
--
-- Safe to re-run, and safe to apply while people are using the app: until it
-- lands, getDutyPairings() fails and Auto-Suggest behaves as it does today.

CREATE TABLE IF NOT EXISTS roster_duty_pairings (
  id           BIGSERIAL PRIMARY KEY,
  when_role    TEXT NOT NULL,
  when_person  TEXT NOT NULL,
  service_type TEXT NOT NULL DEFAULT 'all',
  then_role    TEXT NOT NULL,
  then_people  JSONB NOT NULL,
  strict       BOOLEAN NOT NULL DEFAULT false,
  updated_at   TIMESTAMPTZ DEFAULT now(),
  updated_by   TEXT
);

-- Auto-Suggest asks "any rules for THIS duty on THIS service type?" once per
-- cell it fills, which is the one query worth an index here.
CREATE INDEX IF NOT EXISTS roster_duty_pairings_then_idx
  ON roster_duty_pairings (then_role, service_type);

-- The same rule entered twice would double its weight in the preference sort
-- for no reason a PIC could see.
CREATE UNIQUE INDEX IF NOT EXISTS roster_duty_pairings_unique_idx
  ON roster_duty_pairings (when_role, when_person, service_type, then_role);

-- Same open policy as the other roster tables: the app reaches Supabase with
-- the anon key. Without this the table reads as empty through the app and
-- every rule a PIC saves silently does nothing.
ALTER TABLE roster_duty_pairings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roster_duty_pairings_all ON roster_duty_pairings;
CREATE POLICY roster_duty_pairings_all ON roster_duty_pairings
  FOR ALL USING (true) WITH CHECK (true);
