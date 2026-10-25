/**
 * Optional Supabase Cloud Sync Integration
 *
 * How to configure:
 * 1. Set window.SUPABASE_URL and window.SUPABASE_ANON_KEY before loading this script,
 *    or provide them in your deployment environment.
 * 2. Supabase Table Schema:
 *    CREATE TABLE practicals (
 *      id SERIAL PRIMARY KEY,
 *      subject_name TEXT NOT NULL,
 *      practical_title TEXT NOT NULL,
 *      aim TEXT,
 *      content TEXT,
 *      content_type TEXT CHECK (content_type IN ('code', 'steps')),
 *      created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
 *    );
 */

const SupabaseSync = {
  client: null,
  isOnline: false,

  init() {
    // Supabase project credentials (can be overridden by window/process environment variables)
    const defaultUrl = 'https://dxtssznoudmbigljgqgw.supabase.co';
    const defaultKey = 'sb_publishable_sDQwLl1CH6dJMULEA9Smuw_pMvNptZn';

    const url = window.SUPABASE_URL || (typeof process !== 'undefined' && process.env && process.env.SUPABASE_URL) || defaultUrl;
    const key = window.SUPABASE_ANON_KEY || (typeof process !== 'undefined' && process.env && process.env.SUPABASE_ANON_KEY) || defaultKey;

    if (url && key && window.supabase && typeof window.supabase.createClient === 'function') {
      try {
        this.client = window.supabase.createClient(url, key);
        this.isOnline = true;
        console.log('[Sync] Supabase client initialized connected to:', url);
      } catch (err) {
        console.warn('[Sync] Could not initialize Supabase client:', err);
        this.isOnline = false;
      }
    } else {
      console.log('[Sync] Operating in local storage mode (offline fallback active).');
    }
  },

  async fetchAll() {
    if (!this.isOnline || !this.client) {
      return null;
    }
    try {
      const { data, error } = await this.client
        .from('practicals')
        .select('*')
        .order('id', { ascending: true });

      if (error) {
        console.warn('[Sync] Error fetching from Supabase:', error);
        return null;
      }
      return data;
    } catch (e) {
      console.warn('[Sync] Network exception while fetching practicals:', e);
      return null;
    }
  },

  async insertPractical(item) {
    if (!this.isOnline || !this.client) {
      return false;
    }
    try {
      const { data, error } = await this.client
        .from('practicals')
        .insert([
          {
            subject_name: item.subject_name,
            practical_title: item.practical_title,
            aim: item.aim,
            content: item.content,
            content_type: item.content_type
          }
        ]);
      if (error) {
        console.error('[Sync] Insert error:', error);
        return false;
      }
      return true;
    } catch (err) {
      console.error('[Sync] Insert network exception:', err);
      return false;
    }
  },

  async deleteAllPracticals() {
    if (!this.isOnline || !this.client) {
      return false;
    }
    try {
      const { error } = await this.client
        .from('practicals')
        .delete()
        .gt('id', 0);
      if (error) {
        console.warn('[Sync] Delete all error:', error);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('[Sync] Delete all exception:', err);
      return false;
    }
  }
};

window.SupabaseSync = SupabaseSync;
