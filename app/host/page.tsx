import type { Metadata } from 'next';

import { HostFlow } from '@/features/host/host-flow';
import { hasValidHostSession } from '@/lib/host/session';

export const metadata: Metadata = {
  title: 'Host | Quiz Engine',
};

export const dynamic = 'force-dynamic';

export default async function HostPage() {
  const initiallyAuthenticated = await hasValidHostSession();

  return <HostFlow initiallyAuthenticated={initiallyAuthenticated} />;
}
