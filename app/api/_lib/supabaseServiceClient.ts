import { createClient } from '@supabase/supabase-js';

// Server-only Supabase client (service role key, bypasses RLS) for the
// worship-roster API routes. Deliberately separate from Vocal Hero's
// src/lib/vocal-hero/supabaseClient.ts -- that helper belongs to a different
// feature area even though both live in this same deployment.
export function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );
}
