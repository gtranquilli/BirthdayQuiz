# Quiz Engine multiplayer

Questo repository, nato come BirthdayQuiz, descrive un Quiz Engine riutilizzabile per partite multiplayer dal vivo. Un host configura e controlla la sessione, una pagina separata viene proiettata sul display principale e i partecipanti votano dal browser dello smartphone con codice sessione e nickname.

“Compleanno di Giorgio” è soltanto il primo quiz configurato. La logica applicativa deve poter eseguire altri quiz caricati con lo stesso modello, senza modifiche specifiche al motore.

## Stato del progetto

Lo scaffold Next.js, lo schema Supabase, il seed, la creazione sessione host e
il primo game loop sono presenti. I partecipanti possono entrare con Auth
anonima, recuperare la propria identità anche dopo la perdita della sessione
Auth tramite un rejoin token personale e vedere la prima domanda; host e
display ricevono lo stesso stato pubblico tramite Realtime. Durante
`voting_open` il voto viene salvato atomicamente e la scelta personale viene
recuperata dopo refresh. L’host può chiudere la votazione e, con un’azione
separata, mostrare soluzione, avatar raggruppati e non votanti in Realtime.
Dopo il reveal conferma il risultato: i punti vengono assegnati una sola volta
e la sessione apre la domanda successiva oppure termina con la classifica finale.
Le superfici partecipante usano lo stesso tema dark del display; durante il voto
il display mostra un indicatore aggregato a pallini e, a fine partita, un podio
compatibile con i pari merito e commenti personali deterministici sui telefoni.

## MVP

- Contenuti gerarchici: quiz → categorie → domande → risposte.
- Esattamente quattro risposte e una sola corretta per domanda.
- Punteggio positivo configurabile per domanda.
- Quiz e preset caricati tramite seed; “Compleanno di Giorgio” è il primo dataset.
- Preset con quantità per categoria, modificabili dall'host per la nuova sessione.
- “Numero massimo giocatori” obbligatorio, senza valore predefinito e con conferma esplicita.
- Sessione separata dal quiz, con configurazione salvata alla creazione e domande, risposte, soluzioni e ordine congelati atomicamente all'avvio.
- Accesso partecipanti senza email tramite Supabase Auth anonimo.
- Voto anonimo fino al reveal: durante apertura e chiusura sul display sono visibili solo domanda, quattro risposte e conteggio dei votanti.
- Reveal separato in stile Among Us: risposta corretta e avatar accanto alle risposte scelte, poi punti e classifica.
- Competition ranking condiviso (`1°, 1°, 3°`) con podio finale e classifica completa.
- Recovery dopo refresh, breve disconnessione o perdita della sessione Auth,
  senza creare un secondo player né modificare voti e punteggio.

Restano fuori scope editor completo, marketplace, gestione utenti, creazione pubblica dei quiz, timer, squadre, chat, media, speed bonus, moderazione avanzata e storico partite.
Il prossimo blocco architetturale previsto è il supporto immagini per domande e
risposte; non è incluso nel batch grafico corrente.

## Flusso della sessione

1. L'host sceglie quiz e preset e adatta i conteggi per categoria.
2. Inserisce il massimo giocatori e conferma la creazione.
3. Il display mostra un QR verso `/join/[code]`; dopo la scansione il partecipante sceglie soltanto nickname e avatar. La home conserva l’inserimento manuale del codice come fallback. Al join il browser conserva in `localStorage` un rejoin token personale per quella stanza.
4. L'host avvia: il sistema estrae e congela domande, quattro risposte, soluzioni, punteggi e ordine, poi apre la prima domanda.
5. L'host chiude il voto e poi attiva separatamente il reveal con soluzione e avatar.
6. Dopo ogni reveal può aprire la domanda successiva o terminare con la classifica finale.

Le fasi restano `lobby`, `voting_open`, `voting_closed`, `answer_revealed` e `finished`.

## Interfacce previste

| Rotta | Utente | Responsabilità |
| --- | --- | --- |
| `/` | Partecipante | Inserimento manuale del solo codice come fallback |
| `/join/[code]` | Partecipante | Verifica stanza, Auth anonima, scelta nickname/avatar e ingresso |
| `/play/[code]` | Partecipante | Attesa, voto persistente, recovery, punti ed esito finale |
| `/host` | Host | Accesso, configurazione, creazione e stanze recenti |
| `/host/[code]` | Host | Gestione lobby, transizioni, scoring, avanzamento e fine partita |
| `/display/[code]` | Pubblico | Lobby, domanda, conteggio, reveal e classifica |

## Architettura in breve

- Next.js App Router, TypeScript strict e Tailwind CSS.
- Supabase Postgres come fonte di verità e Supabase Auth anonimo per i partecipanti.
- Supabase Realtime per fase e conteggi persistenti; snapshot per recovery.
- RLS e funzioni SQL transazionali per capienza, voto, transizioni e scoring.
- Soluzioni e relazioni giocatore-risposta protette fino a `answer_revealed`.
- Route Handler server-side protetti da sessione host HttpOnly per le operazioni privilegiate.
- Rejoin token casuali da 256 bit: il browser conserva il token in chiaro solo
  localmente, mentre Postgres conserva esclusivamente l'hash SHA-256 e lo ruota
  dopo ogni recupero riuscito.
- Vercel per il deploy.

## Documentazione

- [Requisiti e criteri di accettazione](docs/requirements.md)
- [Architettura e modello Supabase](docs/architecture.md)
- [Roadmap al 6 agosto 2026](docs/roadmap.md)
- [Regole operative per gli agenti](AGENTS.md)

## Prima dell'implementazione

Occorre predisporre in formato strutturato il quiz di Giorgio: categorie, domande, quattro risposte, soluzione e punteggio di ciascuna domanda, più almeno un preset valido. Non è prevista una UI per inserire questi dati nell'MVP.

## Avvio locale

1. Copiare `.env.example` in `.env.local` e compilare le variabili senza
   commettere segreti.
2. Abilitare gli accessi anonimi nel progetto Supabase. La configurazione locale
   equivalente è già impostata in `supabase/config.toml`.
3. Applicare le migration e il seed all'ambiente scelto.
4. Installare le dipendenze con `npm install` e avviare con `npm run dev`.

Controlli disponibili: `npm run lint`, `npm run typecheck` e `npm run build`.

## Configurazione Vercel

Configurare nel progetto Vercel le stesse variabili di `.env.example`, senza
inserire i valori nel repository:

| Variabile | Visibilità | Uso |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser e server | URL del progetto Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser e server | Chiave pubblicabile soggetta a RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo server | Operazioni host privilegiate |
| `HOST_ACCESS_PASSWORD` | Solo server | Password condivisa host |
| `HOST_SESSION_SECRET` | Solo server | Firma del cookie host; almeno 32 caratteri casuali |

Non serve una variabile con il dominio Vercel: QR e link di invito derivano da
`window.location.origin`, quindi usano automaticamente il dominio del deploy.
Nel progetto Supabase deve essere abilitato l’accesso anonimo. Dopo il deploy,
provare QR e clipboard sull’URL HTTPS definitivo di Vercel.
