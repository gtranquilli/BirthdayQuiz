import type { Metadata } from 'next';

import { JoinGameScreen } from '@/features/player/join-game-screen';

export const metadata: Metadata = {
  title: 'Partecipa al quiz | Quiz Engine',
};

interface JoinPageProps {
  readonly params: Promise<{ code: string }>;
  readonly searchParams: Promise<{ recovery?: string }>;
}

export default async function JoinPage({ params, searchParams }: JoinPageProps) {
  const { code } = await params;
  const { recovery } = await searchParams;

  return <JoinGameScreen code={code} recoveryFailed={recovery === 'failed'} />;
}
