import 'server-only';

import { createClient } from '@supabase/supabase-js';

interface VerifiedAnonymousParticipant {
  readonly accessToken: string;
  readonly userId: string;
}

function getRequiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required server environment variable: ${name}`);
  }

  return value;
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization');

  if (!authorization?.startsWith('Bearer ')) {
    return null;
  }

  const token = authorization.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

export async function verifyAnonymousParticipantRequest(
  request: Request,
): Promise<VerifiedAnonymousParticipant | null> {
  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return null;
  }

  const supabase = createClient(
    getRequiredEnvironmentVariable('NEXT_PUBLIC_SUPABASE_URL'),
    getRequiredEnvironmentVariable('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error || !data.user || data.user.is_anonymous !== true) {
    return null;
  }

  return { accessToken, userId: data.user.id };
}
