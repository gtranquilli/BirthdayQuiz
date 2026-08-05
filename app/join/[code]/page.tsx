import type { Metadata } from 'next';

import { JoinGameScreen } from '@/features/player/join-game-screen';

export const metadata: Metadata = {
  title: 'Partecipa al quiz | Quiz Engine',
};

interface JoinPageProps {
  readonly params: Promise<{ code: string }>;
}

export default async function JoinPage({ params }: JoinPageProps) {
  const { code } = await params;

  return <JoinGameScreen code={code} />;
}
