// ============================================================================
// Shared Supabase client (loaded once, imported everywhere)
// Relies on the global `supabase` object injected by the CDN script tag
// included on every page:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
// ============================================================================
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

if (!window.supabase) {
  throw new Error(
    "Supabase SDK not found. Make sure the CDN <script> tag is included before this module."
  );
}

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});
