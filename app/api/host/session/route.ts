import { type NextRequest, NextResponse } from 'next/server';

import {
  createHostSessionToken,
  getHostSessionCookieOptions,
  HOST_SESSION_COOKIE_NAME,
  verifyHostPassword,
} from '@/lib/host/session';
import { hasValidRequestOrigin } from '@/lib/http/origin';

export const runtime = 'nodejs';

function invalidOriginResponse() {
  return NextResponse.json(
    { error: 'Origine della richiesta non valida.' },
    { status: 403 },
  );
}

export async function POST(request: NextRequest) {
  if (!hasValidRequestOrigin(request)) {
    return invalidOriginResponse();
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Richiesta non valida.' },
      { status: 400 },
    );
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    !('password' in body) ||
    typeof body.password !== 'string' ||
    body.password.length === 0 ||
    body.password.length > 512
  ) {
    return NextResponse.json(
      { error: 'Inserisci la password host.' },
      { status: 400 },
    );
  }

  try {
    if (!verifyHostPassword(body.password)) {
      return NextResponse.json(
        { error: 'Password host non corretta.' },
        { status: 401 },
      );
    }

    const response = NextResponse.json({ authenticated: true });

    response.cookies.set(
      HOST_SESSION_COOKIE_NAME,
      createHostSessionToken(),
      getHostSessionCookieOptions(),
    );

    return response;
  } catch {
    return NextResponse.json(
      { error: 'Configurazione della sessione host incompleta.' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!hasValidRequestOrigin(request)) {
    return invalidOriginResponse();
  }

  const response = NextResponse.json({ authenticated: false });

  response.cookies.set(HOST_SESSION_COOKIE_NAME, '', {
    ...getHostSessionCookieOptions(),
    expires: new Date(0),
    maxAge: 0,
  });

  return response;
}
