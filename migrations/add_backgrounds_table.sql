-- Migration: Shared media library for LCD Projection backgrounds
-- Run this in your Supabase SQL Editor.
--
-- The media FILES already live in Supabase Storage (bucket "Liturgy Files",
-- public URLs). This table just shares the INDEX of them so every user's
-- Media Tray shows the same media source.

CREATE TABLE IF NOT EXISTS lhc_backgrounds (
  id           TEXT        PRIMARY KEY,      -- client-generated bg id (e.g. bg_1699999999999)
  type         TEXT        NOT NULL DEFAULT 'image', -- 'image' | 'video'
  name         TEXT,
  url          TEXT        NOT NULL,         -- Supabase Storage public URL
  storage_path TEXT,                         -- path within the bucket (for cleanup)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Allow public read/write (same policy style as song_layouts and other tables,
-- since the app talks to Supabase with the anon key).
ALTER TABLE lhc_backgrounds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read"   ON lhc_backgrounds FOR SELECT USING (true);
CREATE POLICY "Allow public insert" ON lhc_backgrounds FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update" ON lhc_backgrounds FOR UPDATE USING (true);
CREATE POLICY "Allow public delete" ON lhc_backgrounds FOR DELETE USING (true);
