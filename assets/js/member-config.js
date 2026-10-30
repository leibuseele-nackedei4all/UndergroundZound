/*
 * Public Supabase settings for the static client.
 * Fill these in after creating the Supabase project; never put a service_role
 * or secret key in this file. A publishable key (or legacy anon key) is meant
 * to be public and is safe only when the database/storage RLS policies are on.
 *
 * supabaseUrl is the project base URL (https://PROJECT.supabase.co) – NOT the
 * REST endpoint. The client appends /auth/v1, /rest/v1 and /storage/v1 itself;
 * a URL ending in /rest/v1/ would produce /rest/v1/rest/v1/... requests.
 */
window.MEMBER_CONFIG = Object.freeze({
  supabaseUrl: 'https://vrheeikcssxmbnsektcw.supabase.co',
  supabasePublicKey: 'sb_publishable_zQ-oAP4j9X-4oBSz9vMQLg_Fl35S8KX'
});
