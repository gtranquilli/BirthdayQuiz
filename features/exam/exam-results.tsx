import { QuizMediaImage } from '@/components/quiz-media-image';
import { getAnswerPositionLabel } from '@/lib/game/answer-position';
import type { ExamProgress } from '@/lib/game/exam';

export function ExamResults({ progress }: { readonly progress: ExamProgress }) {
  const result = progress.result;
  if (!result) return null;
  return (
    <section className='space-y-6 text-white'>
      <header>
        <h1 className='text-3xl font-black'>Esame consegnato</h1>
        <p className='mt-2 text-slate-300'>
          La consegna è definitiva. Risultati personali.
        </p>
      </header>
      <dl className='grid grid-cols-2 gap-3 sm:grid-cols-3'>
        {(
          [
            ['Domande', result.total],
            ['Corrette', result.correct],
            ['Errate', result.incorrect],
            ['Omesse', result.omitted],
            ['Percentuale corrette', `${result.percentage}%`],
            ['Punti', result.points],
          ] as const
        ).map(([label, value]) => (
          <div className='rounded-xl bg-white/5 p-4' key={label}>
            <dt className='text-sm text-slate-300'>{label}</dt>
            <dd className='text-2xl font-bold'>{value}</dd>
          </div>
        ))}
      </dl>
      {progress.questions.map((q) => (
        <article
          className='rounded-2xl bg-white/5 p-4 ring-1 ring-white/10 sm:p-6'
          key={q.id}
        >
          <p className='font-bold text-indigo-300'>
            Domanda {q.position} ·{' '}
            {q.selectedOptionId === null
              ? 'Omessa'
              : q.selectedOptionId === q.correctOptionId
                ? 'Corretta'
                : 'Errata'}
          </p>
          {q.prompt && (
            <h2 className='mt-3 break-words text-xl font-bold'>{q.prompt}</h2>
          )}
          {q.media && (
            <QuizMediaImage
              sizes='(min-width: 640px) 40rem, calc(100vw - 4rem)'
              className='mt-4 max-h-80'
              media={q.media}
            />
          )}
          <ol className='mt-4 space-y-3'>
            {q.options.map((o) => (
              <li
                key={o.id}
                className={`break-words rounded-xl border-2 p-4 ${o.id === q.correctOptionId ? 'border-emerald-400 bg-emerald-500/10' : o.id === q.selectedOptionId ? 'border-red-400 bg-red-500/10' : 'border-white/10'}`}
              >
                <p className='font-bold'>
                  {getAnswerPositionLabel(o.position)}{' '}
                  {o.id === q.correctOptionId && '· Risposta corretta'}{' '}
                  {o.id === q.selectedOptionId && '· La tua risposta'}
                </p>
                {o.text && <p className='mt-2'>{o.text}</p>}
                {o.media && (
                  <QuizMediaImage
                    sizes='(min-width: 640px) 40rem, calc(100vw - 4rem)'
                    className='mt-3 max-h-64'
                    media={o.media}
                  />
                )}
              </li>
            ))}
          </ol>
        </article>
      ))}
    </section>
  );
}
