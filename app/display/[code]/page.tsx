import type { Metadata } from 'next';

import { DisplayLobby } from '@/features/display/display-lobby';

export const metadata: Metadata = {
  title: 'Display lobby | Quiz Engine',
};

interface DisplayPageProps {
  readonly params: Promise<{ code: string }>;
}

export default async function DisplayPage({ params }: DisplayPageProps) {
  const { code } = await params;

  return <DisplayLobby code={code} />;
}
