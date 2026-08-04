# BirthdayQuiz — istruzioni per gli agenti

## Scopo del repository

Questo repository contiene una web app per un quiz di compleanno in tempo reale. Un presentatore gestisce la partita, una pagina separata viene proiettata sullo schermo principale e i partecipanti votano da smartphone senza registrazione via email.

Prima di modificare il progetto, leggere nell'ordine:

1. `docs/requirements.md`
2. `docs/architecture.md`
3. `docs/roadmap.md`

Se una richiesta contraddice una decisione documentata, non ampliare implicitamente lo scope: segnalare il conflitto e aggiornare la documentazione insieme al codice solo dopo aver chiarito la decisione.

## Stato iniziale

Al 3 agosto 2026 il repository non contiene ancora lo scaffold dell'applicazione. La baseline è costituita soltanto da questi documenti. Non assumere quindi che dipendenze, script, progetto Supabase o deploy Vercel siano già configurati.

## Vincoli dell'MVP

- Stack: Next.js con App Router, TypeScript, Tailwind CSS, Supabase e Vercel.
- Tempo disponibile: tre giorni di implementazione e collaudo.
- Interfacce distinte per controllo host, schermo pubblico e partecipanti.
- Nessun account email per i partecipanti; usare Supabase Auth anonimo.
- Una sola partita può contenere più domande.
- Durante il voto, lo schermo pubblico mostra soltanto il conteggio aggregato dei votanti come informazione sulle risposte: mai nickname, scelte individuali, percentuali o conteggi per opzione.
- Chiusura e rivelazione sono due azioni host distinte.
- Nessuna UI di authoring nell'MVP: quiz e soluzioni vengono caricati prima dell'evento.
- Nessun timer, chat, squadre, media, speed bonus, moderazione avanzata o storico partite.

## Regole architetturali

- Supabase è la fonte di verità per stanza, fase, partecipanti, voti e punteggi. Non conservare stato autorevole soltanto nella memoria di un processo Vercel.
- Modellare il gioco come macchina a stati esplicita: `lobby`, `voting_open`, `voting_closed`, `answer_revealed`, `finished`.
- Accettare soltanto transizioni valide e renderle atomiche nel database quando modificano anche conteggi o punteggi.
- Usare Supabase Realtime con Postgres Changes per notificare cambiamenti persistenti. Non usare Presence come contatore autorevole dei giocatori.
- La chiave `service_role` deve restare esclusivamente server-side. Non usare mai variabili `NEXT_PUBLIC_*` per segreti.
- Il client non deve poter leggere la soluzione o i voti degli altri prima della rivelazione. Conservare la soluzione in una tabella senza policy di lettura pubblica.
- Applicare Row Level Security a tutte le tabelle esposte. I partecipanti possono scrivere solo come utente anonimo autenticato e solo tramite funzioni SQL che validano fase, stanza, domanda e opzione.
- Le operazioni host passano da Route Handler server-side protetti da sessione host HttpOnly.
- Rendere idempotenti rivelazione e assegnazione dei punti per impedire doppi punteggi su retry o doppio click.
- Evitare librerie aggiuntive se le API di Next.js, React, browser o Supabase coprono già il caso d'uso.

## Convenzioni di implementazione

- Usare TypeScript in modalità strict; evitare `any` salvo motivazione locale.
- Preferire Server Components per shell e letture iniziali; usare Client Components soltanto dove servono interazione, sessione anonima o Realtime.
- Tenere le regole di dominio pure e centralizzate: fasi, transizioni, scoring e validazione non devono essere duplicate nelle pagine.
- Validare tutti gli input anche sul server/database. La sola validazione client non è sufficiente.
- Progettare prima per smartphone nella pagina partecipante e per un display 16:9 nella pagina pubblica.
- UI e messaggi utente in italiano; nomi del codice e del database in inglese.
- Mostrare sempre stati di caricamento, errore, riconnessione e azione già conclusa.
- Non registrare nei log password host, chiavi Supabase, token, cookie o risposte individuali.
- Non modificare un quiz associato a una stanza già avviata.

## Rotte previste

- `/`: ingresso partecipante con codice stanza e nickname.
- `/play/[code]`: esperienza mobile del partecipante.
- `/host`: accesso host e creazione della stanza.
- `/host/[code]`: pannello di controllo del presentatore.
- `/display/[code]`: schermata pubblica da proiettare.

Risultati, attesa e classifica sono stati delle rotte esistenti, non pagine aggiuntive.

## Qualità e verifica

Prima di considerare completa una modifica:

1. eseguire lint, typecheck e build disponibili nel progetto;
2. verificare le transizioni di fase interessate;
3. verificare almeno host, display e due partecipanti in sessioni browser separate;
4. controllare che refresh e riconnessione ricostruiscano lo stato dal database;
5. verificare che nessun payload pubblico esponga `correct_option_id` prima della rivelazione o le risposte altrui;
6. aggiornare i documenti se cambiano comportamento, schema o scope.

Non introdurre funzionalità secondarie per “completezza” prima che tutti i criteri MVP in `docs/requirements.md` siano soddisfatti.
