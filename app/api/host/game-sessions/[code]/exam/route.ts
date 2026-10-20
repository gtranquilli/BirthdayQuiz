import { type NextRequest, NextResponse } from 'next/server';
import { GAME_CODE_PATTERN, normalizeGameCode } from '@/lib/game/lobby';
import {
  HOST_SESSION_COOKIE_NAME,
  verifyHostSessionToken,
} from '@/lib/host/session';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  const headers = { 'Cache-Control': 'private, no-store' };
  if (
    !verifyHostSessionToken(
      request.cookies.get(HOST_SESSION_COOKIE_NAME)?.value,
    )
  ) {
    return NextResponse.json(
      { error: 'Sessione host non valida o scaduta.' },
      { status: 401, headers },
    );
  }
  const code = normalizeGameCode((await context.params).code);
  const playerId = request.nextUrl.searchParams.get('playerId');
  if (
    !GAME_CODE_PATTERN.test(code) ||
    (playerId !== null &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        playerId,
      ))
  ) {
    return NextResponse.json(
      { error: 'Stanza o partecipante non valido.' },
      { status: 400, headers },
    );
  }
  try {
    const { data, error } = await createAdminClient().rpc(
      'get_host_exam_progress',
      { p_code: code, p_player_id: playerId },
    );
    if (error)
      return NextResponse.json(
        { error: 'Esame o risultato consegnato non disponibile.' },
        { status: error.code === 'P0002' ? 404 : 500, headers },
      );
    return NextResponse.json(
      playerId ? { progress: data } : { players: data },
      { headers },
    );
  } catch {
    return NextResponse.json(
      { error: 'Impossibile caricare i progressi.' },
      { status: 500, headers },
    );
  }
}
