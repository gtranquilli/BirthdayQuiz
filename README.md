# Quiz Engine multiplayer

Questo repository, nato come BirthdayQuiz, descrive un Quiz Engine riutilizzabile per partite multiplayer dal vivo. Un host configura e controlla la sessione, una pagina separata viene proiettata sul display principale e i partecipanti votano dal browser dello smartphone con codice sessione e nickname.

“Compleanno di Giorgio” è soltanto il primo quiz configurato. La logica applicativa deve poter eseguire altri quiz caricati con lo stesso modello, senza modifiche specifiche al motore.

## Stato del progetto

Lo scaffold Next.js, lo schema Supabase, il seed, la creazione sessione host e
il flusso lobby sono presenti. I partecipanti possono scegliere nickname e
avatar, entrare con Auth anonima e recuperare la propria identità dopo refresh;
il display usa una proiezione pubblica sicura sincronizzata via Realtime.

Domande, voto, reveal, scoring e controllo host della partita restano da
implementare secondo la roadmap MVP al 6 agosto 2026.

## MVP

- Contenuti gerarchici: quiz → categorie → domande → risposte.
- Esattamente quattro risposte e una sola corretta per domanda.
- Punteggio positivo configurabile per domanda.
- Quiz e preset caricati tramite seed; “Compleanno di Giorgio” è il primo dataset.
- Preset con quantità per categoria, modificabili dall'host per la nuova sessione.
- “Numero massimo giocatori” obbligatorio, senza valore predefinito e con conferma esplicita.
- Sessione separata dal quiz, con configurazione, domande, risposte, soluzioni e ordine congelati alla creazione.
- Accesso partecipanti senza email tramite Supabase Auth anonimo.
- Voto anonimo fino al reveal: durante apertura e chiusura sul display sono visibili solo domanda, quattro risposte e conteggio dei votanti.
- Reveal separato in stile Among Us: risposta corretta e avatar accanto alle risposte scelte, poi punti e classifica.
- Recovery dello stato dopo refresh o breve disconnessione.

Restano fuori scope editor completo, marketplace, gestione utenti, creazione pubblica dei quiz, timer, squadre, chat, media, speed bonus, moderazione avanzata e storico partite.

## Flusso della sessione

1. L'host sceglie quiz e preset e adatta i conteggi per categoria.
2. Inserisce il massimo giocatori e conferma la creazione.
3. Il sistema estrae e congela domande, quattro risposte, soluzioni, punteggi e ordine.
4. I partecipanti entrano in lobby con nickname e avatar.
5. L'host apre il voto, lo chiude e poi attiva separatamente il reveal.
6. Dopo ogni reveal può aprire la domanda successiva o terminare con la classifica finale.

Le fasi restano `lobby`, `voting_open`, `voting_closed`, `answer_revealed` e `finished`.

## Interfacce previste

| Rotta | Utente | Responsabilità |
| --- | --- | --- |
| `/` | Partecipante | Inserimento di codice sessione e nickname |
| `/play/[code]` | Partecipante | Attesa, voto, esito personale e classifica |
| `/host` | Host | Accesso, configurazione e creazione sessione |
| `/host/[code]` | Host | Controlli della partita e monitoraggio |
| `/display/[code]` | Pubblico | Lobby, domanda, conteggio, reveal e classifica |

## Architettura in breve

- Next.js App Router, TypeScript strict e Tailwind CSS.
- Supabase Postgres come fonte di verità e Supabase Auth anonimo per i partecipanti.
- Supabase Realtime per fase e conteggi persistenti; snapshot per recovery.
- RLS e funzioni SQL transazionali per capienza, voto, transizioni e scoring.
- Soluzioni e relazioni giocatore-risposta protette fino a `answer_revealed`.
- Route Handler server-side protetti da sessione host HttpOnly per le operazioni privilegiate.
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
