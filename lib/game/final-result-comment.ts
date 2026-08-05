export interface FinalResultCommentInput {
  readonly rank: number;
  readonly participantCount: number;
  readonly score: number;
  readonly isTied: boolean;
  readonly highestScore: number;
  readonly isLast: boolean;
  readonly nickname: string;
  readonly code: string;
}

const COMMENTS = {
  only: [
    'Hai vinto contro una concorrenza spietata: te stesso.',
    'Primo, ultimo e imbattuto. Una prestazione statisticamente perfetta.',
    'Podio completo in una sola persona. Efficienza assoluta.',
  ],
  first: [
    'Assolutamente impeccabile. Gli altri possono prendere appunti.',
    'Hai trasformato il quiz in una dimostrazione pratica di superiorità.',
    'Trono conquistato senza bisogno di chiedere il permesso.',
  ],
  tiedFirst: [
    'Hai conquistato il trono, ma hai dovuto condividerlo.',
    'Vittoria sì, esclusiva no. Il regno sarà amministrato in comproprietà.',
    'Primo posto condiviso: gloria intera, spazio sul podio un po’ meno.',
  ],
  podium: [
    'Podio meritato. Abbastanza in alto da vantartene per tutta la serata.',
    'Ottima prova: non hai vinto, ma puoi raccontarla selezionando bene i dettagli.',
    'Tra i migliori, con margine sufficiente per guardare gli altri dall’alto.',
  ],
  upperHalf: [
    'Metà alta della classifica: competente, pericoloso e quasi convincente.',
    'Una prestazione solida. Il podio ti ha visto arrivare e si è preoccupato.',
    'Più risposte giuste che scuse da inventare: buon risultato.',
  ],
  lowerHalf: [
    'Non proprio gloria eterna, ma almeno hai tenuto viva la suspense.',
    'La rimonta era tecnicamente possibile. È la parte pratica che è mancata.',
    'Hai lasciato spazio agli altri con una generosità quasi commovente.',
  ],
  last: [
    'Ultimo posto, ma con la serenità di chi non si lascia distrarre dai risultati.',
    'La classifica finisce qui. Qualcuno doveva controllare che avesse un fondo.',
    'Probabilmente sei l’unica persona capace di raggiungere così precisamente il proprio pieno potenziale.',
  ],
  lastZero: [
    'Le aspettative rasentavano il terreno, ma vedo che hai portato una pala.',
    'Zero punti, infinite possibilità di sostenere che fosse tutto intenzionale.',
    'Hai dato a ogni risposta la stessa possibilità di essere sbagliata. Democrazia pura.',
  ],
} as const;

function getStableIndex(seed: string, length: number): number {
  let hash = 2166136261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) % length;
}

export function getFinalResultComment(input: FinalResultCommentInput): string {
  let category: keyof typeof COMMENTS;

  if (input.participantCount === 1) {
    category = 'only';
  } else if (input.rank === 1 && input.isTied) {
    category = 'tiedFirst';
  } else if (input.rank === 1) {
    category = 'first';
  } else if (input.isLast && input.score === 0) {
    category = 'lastZero';
  } else if (input.isLast) {
    category = 'last';
  } else if (input.rank <= 3) {
    category = 'podium';
  } else if (input.rank <= Math.ceil(input.participantCount / 2)) {
    category = 'upperHalf';
  } else {
    category = 'lowerHalf';
  }

  const variants = COMMENTS[category];
  const seed = [
    input.code,
    input.nickname,
    category,
    input.rank,
    input.score,
    input.highestScore,
  ].join(':');

  return variants[getStableIndex(seed, variants.length)];
}
