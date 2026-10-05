-- Migration: one nullable text column on roster_member_meta
-- Run this in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/jypzhumcdifxnazexdcu/sql/new
--
-- WHY A COLUMN IS NEEDED
-- Lay preachers are addressed as "Bro" or "Sis" at LHC; ordained ones carry
-- Rev / Pastor / Bishop in their name already. That form of address has to be
-- stored somewhere, and every column roster_member_meta already has means
-- something else:
--
--   status, suspended_*, inactive_date   rotation and availability
--   note                                 free text a PIC writes
--   joined_date, phone, email            contact and membership
--   team                                 already in use, by the Enablers
--                                        screen's team dropdown
--
-- Putting it in `note` would mean parsing a free-text field a human writes
-- into, which breaks the first time somebody writes a sentence.
--
-- WHY NOT IN THE NAME
-- Because that is what the roster has been doing, and it is how the same
-- person ends up stored several times. "Alwyn Lau" and "Bro Alwyn Lau" were
-- two different people to this database until 2026-10-05: separate duty
-- counts, separate rows, invisible to each other in the statistics. The same
-- had happened to Benedict Muthusamy (four spellings) and Ashley Teter (four).
-- A form of address belongs beside the name, not inside it.
--
-- WHY NOT gender
-- The column records how somebody is addressed, which a PIC sets, rather than
-- a fact about them that software would have to infer. "Bro" and "Sis" are the
-- values LHC uses; nothing reads anything else into them.
--
-- WHAT THIS CHANGES FOR EXISTING BEHAVIOUR
-- Nothing. The column is nullable with no default, so every existing row keeps
-- working unchanged and anything that reads the table today sees exactly what
-- it saw before. Adding a column to an existing table inherits that table's
-- RLS, so this does NOT hit the "new table reads as empty through the anon
-- key" trap that catches tables created in the SQL editor.
--
-- WHERE IT IS USED
-- Only where a PREACHER's name is presented to people -- the WhatsApp service
-- share and the service card. Deliberately not in the roster grid, where the
-- cell value is the stored name the picker matches against, and not for the
-- same person in another role: Alwyn Lau preaches and also plays piano, and
-- "Bro" belongs to the preaching.
--
-- Safe to re-run.

ALTER TABLE roster_member_meta
  ADD COLUMN IF NOT EXISTS address_as text;

COMMENT ON COLUMN roster_member_meta.address_as IS
  'Form of address for a lay preacher: ''Bro'', ''Sis'', or NULL. Shown only when the person is presented as the preacher. Ordained ministers carry Rev/Pastor/Bishop in the name itself and leave this NULL.';

-- ============================================================
-- Done. Then check it, because the failure here would be silent:
--
--   1. node tools/verify-address-as.js
--      Reads the column through the anon key and writes a value back,
--      which is what the app does.
--
--   2. Or in the app: Enablers -> Alwyn Lau -> set the form of address,
--      then share a service he is preaching at and confirm the card
--      reads "Bro Alwyn Lau" while the roster grid still reads
--      "Alwyn Lau".
-- ============================================================
