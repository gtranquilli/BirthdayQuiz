import type { Metadata } from 'next';

import { JoinCodeForm } from '@/features/player/join-code-form';

export const metadata: Metadata = {
  title: 'Entra nella partita | Quiz Engine',
};

export default function Home() {
  return (
    <main className='min-h-screen overflow-x-hidden bg-slate-950 px-4 py-8 text-white sm:grid sm:place-items-center sm:py-12'>
      <section className='mx-auto w-full max-w-md rounded-3xl bg-white/5 p-5 shadow-2xl shadow-black/30 ring-1 ring-white/10 sm:p-8'>
        <p className='text-sm font-bold uppercase tracking-wide text-indigo-300'>
          Quiz Engine
        </p>
        <h1 className='mt-2 text-3xl font-black text-white sm:text-4xl'>
          Entra nella partita
        </h1>
        <p className='mt-2 text-sm text-slate-300 sm:text-base'>
          Se non puoi scansionare il QR, inserisci il codice mostrato sul display.
        </p>
        <div className='mt-7'>
          <JoinCodeForm />
        </div>
      </section>
    </main>
  );
}
