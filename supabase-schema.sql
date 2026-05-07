-- ================================================================
-- LHC WORSHIP PREP — Supabase Schema
-- Run this entire file in: Supabase Dashboard → SQL Editor → New query
-- ================================================================

-- ── SONGS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS songs (
  id          text PRIMARY KEY,
  title       text NOT NULL,
  artist      text DEFAULT '',
  theme       text DEFAULT '',
  key         text DEFAULT '',
  tempo       text DEFAULT '',
  style       text DEFAULT '',
  season      text DEFAULT '',
  youtube     jsonb DEFAULT '[]'::jsonb,
  attachments jsonb DEFAULT '[]'::jsonb,
  lyrics      text DEFAULT '',
  scripture   text DEFAULT '',
  use_count   integer DEFAULT 0,
  last_used   timestamptz,
  date_added  timestamptz DEFAULT now(),
  last_edited timestamptz DEFAULT now()
);

ALTER TABLE songs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "songs_select" ON songs FOR SELECT USING (true);
CREATE POLICY "songs_insert" ON songs FOR INSERT WITH CHECK (true);
CREATE POLICY "songs_update" ON songs FOR UPDATE USING (true);
CREATE POLICY "songs_delete" ON songs FOR DELETE USING (true);

-- ── ROSTER ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roster (
  id           serial PRIMARY KEY,
  month        integer NOT NULL,
  year         integer NOT NULL,
  role_id      text NOT NULL,
  service_date text NOT NULL,
  value        text DEFAULT '',
  updated_at   timestamptz DEFAULT now(),
  UNIQUE (month, year, role_id, service_date)
);

ALTER TABLE roster ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roster_select" ON roster FOR SELECT USING (true);
CREATE POLICY "roster_insert" ON roster FOR INSERT WITH CHECK (true);
CREATE POLICY "roster_update" ON roster FOR UPDATE USING (true);
CREATE POLICY "roster_delete" ON roster FOR DELETE USING (true);

-- ── ROSTER CHANGES (audit log) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS roster_changes (
  id           serial PRIMARY KEY,
  role_id      text NOT NULL,
  service_date text NOT NULL,
  old_value    text DEFAULT '',
  new_value    text DEFAULT '',
  month        integer NOT NULL,
  year         integer NOT NULL,
  changed_at   timestamptz DEFAULT now()
);

ALTER TABLE roster_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roster_changes_select" ON roster_changes FOR SELECT USING (true);
CREATE POLICY "roster_changes_insert" ON roster_changes FOR INSERT WITH CHECK (true);

-- ── ORDERS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id           text PRIMARY KEY,
  title        text NOT NULL DEFAULT 'Untitled Order',
  type         text DEFAULT 'traditional',
  service_date text DEFAULT '',
  data         jsonb DEFAULT '{}'::jsonb,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  created_by   text DEFAULT ''
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orders_select" ON orders FOR SELECT USING (true);
CREATE POLICY "orders_insert" ON orders FOR INSERT WITH CHECK (true);
CREATE POLICY "orders_update" ON orders FOR UPDATE USING (true);
CREATE POLICY "orders_delete" ON orders FOR DELETE USING (true);

-- ── SONGBOOKS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS songbooks (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  description text DEFAULT '',
  songs       jsonb DEFAULT '[]'::jsonb,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE songbooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "songbooks_select" ON songbooks FOR SELECT USING (true);
CREATE POLICY "songbooks_insert" ON songbooks FOR INSERT WITH CHECK (true);
CREATE POLICY "songbooks_update" ON songbooks FOR UPDATE USING (true);
CREATE POLICY "songbooks_delete" ON songbooks FOR DELETE USING (true);

-- ── ANNOUNCEMENTS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS announcements (
  id          text PRIMARY KEY DEFAULT ('ann_' || extract(epoch from now())::text),
  title       text NOT NULL,
  description text DEFAULT '',
  date        timestamptz DEFAULT now(),
  priority    text DEFAULT 'normal',
  active      boolean DEFAULT true
);

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "announcements_select" ON announcements FOR SELECT USING (true);
CREATE POLICY "announcements_insert" ON announcements FOR INSERT WITH CHECK (true);
CREATE POLICY "announcements_update" ON announcements FOR UPDATE USING (true);
CREATE POLICY "announcements_delete" ON announcements FOR DELETE USING (true);

-- ── SETTINGS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key   text PRIMARY KEY,
  value jsonb
);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings_select" ON settings FOR SELECT USING (true);
CREATE POLICY "settings_insert" ON settings FOR INSERT WITH CHECK (true);
CREATE POLICY "settings_update" ON settings FOR UPDATE USING (true);

-- Done!
SELECT 'Schema created successfully' AS status;
