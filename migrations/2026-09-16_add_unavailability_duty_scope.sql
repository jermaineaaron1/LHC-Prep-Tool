-- Migration: remember WHICH duties someone is unavailable for.
--
-- WHY
-- The availability form has always offered a scope -- "Music / Band",
-- "Reading", "All duties" and the rest -- but roster_unavailability had no
-- column to put it in, so the scope was accepted and thrown away.
--
-- That is worse than not offering it. _dutyScopeMatches() treats a missing
-- duty as 'all', so someone who said "no music in March" was quietly taken off
-- preaching, reading and ushering for March as well, and Auto-Suggest skipped
-- them everywhere. Nothing in the interface said so.
--
-- DEFAULT 'all' is deliberate: every existing row was written under the old
-- behaviour, where the absence genuinely did cover every duty. Backfilling
-- them to 'all' preserves exactly what the roster has been doing rather than
-- silently widening anyone's availability.
--
-- The app writes duty on the existing name+start+end conflict target, so no
-- new unique constraint is needed and no old one has to be dropped. One
-- period per person per date range, which is what the table already enforced.
--
-- Safe to re-run, and safe to apply while people are using the app: until it
-- lands the app saves the period without its scope rather than failing.

ALTER TABLE roster_unavailability ADD COLUMN IF NOT EXISTS duty TEXT DEFAULT 'all';

UPDATE roster_unavailability SET duty = 'all' WHERE duty IS NULL;
