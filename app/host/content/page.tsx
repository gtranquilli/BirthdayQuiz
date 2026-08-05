import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { ContentMediaManager } from '@/features/host/content-media-manager';
import { hasValidHostSession } from '@/lib/host/session';

export const metadata: Metadata = {
  title: 'Media quiz | Quiz Engine',
};

export const dynamic = 'force-dynamic';

export default async function HostContentPage() {
  if (!(await hasValidHostSession())) {
    redirect('/host');
  }

  return <ContentMediaManager />;
}
