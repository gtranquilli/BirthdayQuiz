import type { Metadata } from 'next';

import { JoinCodeForm } from '@/features/player/join-code-form';

export const metadata: Metadata = {
  title: 'Entra nella partita | Quiz Engine',
};

export default function Home() {
  return (
    <main className='min-h-screen bg-slate-100 px-4 py-8 sm:grid sm:place-items-center sm:py-12'>
      <section className='mx-auto w-full max-w-md rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-8'>
        <p className='text-sm font-bold uppercase tracking-wide text-indigo-600'>
          Quiz Engine
        </p>
        <h1 className='mt-2 text-3xl font-black text-slate-950 sm:text-4xl'>
          Entra nella partita
        </h1>
        <p className='mt-2 text-sm text-slate-600 sm:text-base'>
          Se non puoi scansionare il QR, inserisci il codice mostrato sul display.
        </p>
        <div className='mt-7'>
          <JoinCodeForm />
        </div>
      </section>
    </main>
  );
}
