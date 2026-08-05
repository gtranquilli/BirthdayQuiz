import type { Metadata } from 'next';

import { PlayerLobby } from '@/features/player/player-lobby';

export const metadata: Metadata = {
  title: 'Lobby partecipante | Quiz Engine',
};

interface PlayPageProps {
  readonly params: Promise<{ code: string }>;
}

export default async function PlayPage({ params }: PlayPageProps) {
  const { code } = await params;

  return <PlayerLobby code={code} />;
}
