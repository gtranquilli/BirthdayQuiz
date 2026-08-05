import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { HostRoom } from '@/features/host/host-room';
import { hasValidHostSession } from '@/lib/host/session';

export const metadata: Metadata = {
  title: 'Gestione stanza | Quiz Engine',
};

export const dynamic = 'force-dynamic';

interface HostRoomPageProps {
  readonly params: Promise<{ code: string }>;
}

export default async function HostRoomPage({ params }: HostRoomPageProps) {
  if (!(await hasValidHostSession())) {
    redirect('/host');
  }

  const { code } = await params;
  return <HostRoom code={code} />;
}
