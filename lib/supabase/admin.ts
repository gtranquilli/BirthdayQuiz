import 'server-only';

import { createClient } from '@supabase/supabase-js';

function getRequiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required server environment variable: ${name}`);
  }

  return value;
}

export function createAdminClient() {
  return createClient(
    getRequiredEnvironmentVariable('NEXT_PUBLIC_SUPABASE_URL'),
    getRequiredEnvironmentVariable('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
}
