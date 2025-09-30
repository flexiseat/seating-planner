import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.2';

const globalConfig = window.__FLOWSEAT_CONFIG ?? {};
const supabaseConfig = globalConfig.supabase ?? {};

const isConfigured = Boolean(supabaseConfig.url && supabaseConfig.anonKey);

const supabase = isConfigured
  ? createClient(supabaseConfig.url, supabaseConfig.anonKey, {
      auth: {
        persistSession: true,
        storage: window.localStorage,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

let authSubscription = null;

async function bootstrap(onSessionChange) {
  if (!supabase) {
    console.warn('[Supabase] Missing project configuration; Google login disabled.');
    onSessionChange?.(null);
    return null;
  }

  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) {
    console.error('[Supabase] Failed to hydrate session', error);
  }

  onSessionChange?.(session ?? null);

  if (!authSubscription) {
    authSubscription = supabase.auth.onAuthStateChange((_event, newSession) => {
      onSessionChange?.(newSession ?? null);
    });
  }

  return session ?? null;
}

async function signInWithGoogle() {
  if (!supabase || !isConfigured) {
    throw new Error('Supabase credentials are not configured. Update config.js before signing in.');
  }

  const redirectTo = supabaseConfig.redirectTo ?? window.location.origin;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      queryParams: {
        prompt: supabaseConfig.prompt ?? 'select_account',
      },
    },
  });

  if (error) {
    throw error;
  }

  const targetUrl = data?.url;
  if (targetUrl) {
    window.location.href = targetUrl;
  }
}

async function signOut() {
  if (!supabase || !isConfigured) {
    return;
  }

  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }
}

function mapUser(session) {
  const user = session?.user;
  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
    avatar: user.user_metadata?.avatar_url ?? null,
    lastLogin: new Date().toISOString(),
  };
}

export const authClient = {
  bootstrap,
  signInWithGoogle,
  signOut,
  mapUser,
  isConfigured,
  get client() {
    return supabase;
  },
};


