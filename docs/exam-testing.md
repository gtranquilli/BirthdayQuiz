# Collaudo Esame

## Prove locali riproducibili

Nessun test usa credenziali remote per modificare dati. Il
runner browser avvia Next.js con valori fittizi, intercetta HTTP e blocca le
richieste esterne. Il runner SQL applica tutte le migration e il seed su un nuovo
PostgreSQL incorporato PGlite in memoria, con stub minimi Auth/Storage e ruoli.
Non avvia né modifica il progetto Supabase collegato.

Gli strumenti di test sono opzionali ed esterni alle dipendenze applicative:

```powershell
$examTools = Join-Path $env:TEMP 'birthdayquiz-exam-tools'
npm install --prefix $examTools --no-save --no-package-lock @electric-sql/pglite @playwright/test
$env:EXAM_TEST_TOOLS = $examTools
& "$examTools/node_modules/.bin/playwright.cmd" install chromium webkit
node scripts/test-exam-database.mjs
node scripts/test-exam-browser.mjs
```

Il runner browser occupa temporaneamente la porta 3197, avvia un processo nascosto
e lo termina al termine. Non eseguirlo in parallelo a build o sviluppo sullo stesso
checkout. Gli screenshot sono in `$examTools/screenshots` oppure nella directory
indicata da `EXAM_TEST_OUTPUT`.

## Copertura e limiti

- SQL: tutte le migration più seed; quantità e disponibilità; avvio con almeno
  un player; snapshot senza duplicati con ordine A–D, media e punti; isolamento
  delle modalità; capienza e late join; posizione e risposte indipendenti; skip,
  modifica e cancellazione esplicita; refresh tramite nuova lettura; rejoin con
  nuova Auth e rotazione token; corretta/errata/omessa; blocco post-consegna;
  doppia consegna; risultato privato; nessuna soluzione agli altri o al display;
  fine automatica; un partecipante; avvio fallito senza snapshot parziale;
  ciclo completo Presentazione con due player, privacy, reveal/avatar e scoring.
- UI Chromium (quattro contesti separati): creazione Esame senza preset e capienza vuota; host, display e due player
  in contesti browser separati; scelta non confermata, skip/cambio/conferma,
  refresh, nuova Auth con rejoin, offline/online, dialogo di consegna con omissioni,
  correzione personale e host, fine e display senza soluzioni, larghezza 320 px.
- UI WebKit (un contesto mobile isolato): conferma, skip, refresh, perdita Auth,
  rejoin, consegna parziale, correzione privata e layout a 320 px. Il tentativo
  multi-contesto WebKit su Windows ha incontrato attese/blocchi del browser e non
  viene considerato superato.
- PGlite esegue le richieste in serie: verifica l’idempotenza, ma **non** dimostra
  il comportamento di lock, deadlock o race su connessioni PostgreSQL distinte.
- Le prove UI usano fixture HTTP: **non** dimostrano l’integrazione completa
  Next.js–Supabase Auth/PostgREST/Realtime. I controlli di RLS/grant/RPC vengono
  esercitati separatamente dal runner SQL. L’indicatore di sviluppo Next.js viene
  nascosto nel browser di test perché può coprire i pulsanti a 320 px; gli errori
  runtime restano causa di fallimento.
- WebKit desktop non equivale a Safari iOS reale; Chromium non equivale a Chrome
  Android reale. Chiusura forzata dell’app, bfcache, rete mobile e ricezione degli
  eventi Realtime richiedono il collaudo sotto riportato.

## Matrice manuale su ambiente autorizzato

Da eseguire dopo aver applicato la migration in un ambiente di test separato.
L’applicazione remota della migration non è autorizzata per questa attività.

| Scenario | Risultato atteso |
| --- | --- |
| Una persona, una domanda | Avvio possibile, omissione possibile, submit conclude |
| Due persone a indici diversi | Stesso snapshot/ordine, progressi indipendenti |
| Conteggio oltre disponibilità | Errore comprensibile, nessuna stanza parziale |
| Contenuti insufficienti prima di start | Fallimento completo, nessuno snapshot parziale |
| Modifica testo/media/punti sorgente dopo start | Snapshot e risultati invariati |
| Due join concorrenti sull’ultimo posto | Uno solo entra; capienza rispettata |
| Nuovo join dopo start / rejoin player esistente | Nuovo rifiutato, esistente recuperato |
| Bozza, skip, indietro e cambio risposta | Solo Conferma modifica il DB; posizione recuperabile |
| Deseleziona e conferma | Risposta rimossa, domanda omessa |
| Refresh, rete assente, Safari chiuso e riaperto | Stesso player, posizione e scelte confermate |
| Perdita cookie Auth con token locale conservato | Nuova Auth, stesso player; token ruotato |
| Consegna con risposte mancanti | Riepilogo corretto e conferma esplicita |
| Save e submit su due connessioni, doppio submit | Serializzazione, un solo risultato, niente modifiche tardive |
| Primo submit mentre altro player continua | Nessun blocco o soluzione per l’altro |
| Risultati via anon, altro player o host scaduto | Accesso negato; cache privata/no-store per API host |
| Ultimi due submit concorrenti | Un solo stato finale coerente, punti invariati |
| Display aperto in ogni fase | Solo lobby/QR e aggregati; nessun quesito o risultato Esame |
| Immagini valide, lente o mancanti | Contain, alt/fallback e interazione sempre disponibile |
| Presentazione completa | Stesse votazioni, close/reveal separati, avatar e ranking |

Controlli finali: `npm run lint`, `npm run typecheck`, `npm run build`,
`git diff --check`, `npx supabase db push --linked --dry-run`.
Il dry-run controlla l’elenco delle migration da applicare, non esegue il SQL remoto.

## Esito locale del 20 ottobre 2026

- Superati 71 controlli SQL nel database PGlite, con tutte le migration e il seed.
- Superato il percorso completo Chromium con host, display e due partecipanti.
- Superato il percorso mobile isolato WebKit, inclusa perdita Auth e rejoin.
- Verifica visiva degli screenshot mobile e risultati a 320 px.
- La matrice manuale su Supabase/dispositivi reali e le race multi-connessione
  restano da eseguire. Nessuna migration remota, deploy o commit effettuato.
