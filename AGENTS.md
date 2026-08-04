# Quiz Engine — istruzioni per gli agenti

## Scopo del repository

Questo repository contiene un Quiz Engine multiplayer riutilizzabile per partite dal vivo. Un host gestisce la sessione, una pagina separata viene proiettata sul display e i partecipanti votano da smartphone senza account email. “Compleanno di Giorgio” è il primo quiz configurato, non una specializzazione della logica.

Prima di modificare il progetto, leggere nell'ordine:

1. `docs/requirements.md`
2. `docs/architecture.md`
3. `docs/roadmap.md`

Se una richiesta contraddice una decisione documentata, non ampliare implicitamente lo scope: segnalare il conflitto e aggiornare la documentazione insieme al codice solo dopo aver chiarito la decisione.

## Stato iniziale

Al 4 agosto 2026 il repository non contiene ancora lo scaffold dell'applicazione. La baseline è costituita soltanto dalla documentazione. Non assumere che dipendenze, script, progetto Supabase o deploy Vercel siano configurati.

## Vincoli dell'MVP al 6 agosto

- Stack: Next.js App Router, TypeScript strict, Tailwind CSS, Supabase e Vercel.
- Interfacce distinte per host, display pubblico e partecipanti.
- Nessun account email per i partecipanti; usare Supabase Auth anonimo.
- Modello contenuti: quiz → categorie → domande → risposte.
- Ogni domanda appartiene a una categoria, ha esattamente quattro risposte, una sola corretta e un punteggio configurato.
- Quiz e preset sono dati seed. L'host può adattare i conteggi per categoria per la nuova sessione, senza modificare il preset sorgente.
- La sessione di gioco è separata dal quiz e congela configurazione, domande estratte, quattro risposte, soluzioni, punteggi e ordine.
- “Numero massimo giocatori” è obbligatorio, non ha default e deve essere confermato esplicitamente prima della creazione.
- Durante `voting_open` e `voting_closed`, il display mostra domanda, risposte e solo il conteggio aggregato dei votanti come dato sui voti.
- Soluzione e relazione giocatore-risposta restano nascoste fino a `answer_revealed`.
- Dopo il reveal il display evidenzia la risposta corretta e mostra gli avatar vicino alla risposta scelta.
- Chiusura e rivelazione sono azioni host distinte.
- Nessuna UI di authoring, marketplace, gestione utenti o creazione pubblica dei quiz.
- Nessun timer, chat, squadre, media, speed bonus, moderazione avanzata o storico partite.

## Regole architetturali

- Supabase è la fonte di verità per contenuti, preset, sessioni, partecipanti, voti e punteggi. Non conservare stato autorevole solo nella memoria di Vercel.
- Usare le fasi `lobby`, `voting_open`, `voting_closed`, `answer_revealed`, `finished` e accettare soltanto transizioni valide.
- Rendere atomiche creazione/snapshot della sessione, controllo capienza, transizioni e scoring dove modificano più dati.
- Usare Supabase Realtime con Postgres Changes; non usare Presence come contatore autorevole.
- La `service_role` resta esclusivamente server-side e non usa mai prefissi `NEXT_PUBLIC_*`.
- Conservare soluzioni sorgente e di sessione in tabelle senza lettura pubblica.
- Non esporre `votes` tramite Realtime. Prima del reveal ogni partecipante legge solo la propria risposta; dopo il reveal un endpoint controllato restituisce solo le associazioni avatar-opzione necessarie.
- Applicare RLS a tutte le tabelle esposte. Join e voto passano da funzioni SQL che validano identità, fase, sessione, domanda e opzione.
- Le operazioni host passano da Route Handler server-side protetti da sessione host HttpOnly.
- Rendere idempotenti rivelazione e assegnazione dei punti.
- Evitare librerie aggiuntive se Next.js, React, browser o Supabase coprono il caso d'uso.

## Convenzioni di implementazione

- Evitare `any` salvo motivazione locale.
- Preferire Server Components per shell e letture iniziali; usare Client Components solo per interazione, Auth anonimo o Realtime.
- Centralizzare fasi, transizioni, scoring e validazione; non duplicare regole nelle pagine.
- Validare input sia server-side sia nel database; la sola validazione client non basta.
- Usare i dati copiati in `session_*` durante la partita, mai i contenuti sorgente come stato live.
- Progettare mobile-first per il partecipante e 16:9 per il display.
- UI e messaggi in italiano; nomi di codice e database in inglese.
- Mostrare loading, errore, riconnessione e azione già conclusa.
- Non registrare password host, chiavi, token, cookie o risposte individuali.

## Rotte previste

- `/`: ingresso partecipante con codice sessione e nickname.
- `/play/[code]`: esperienza mobile del partecipante.
- `/host`: accesso host, configurazione e creazione sessione.
- `/host/[code]`: pannello di controllo.
- `/display/[code]`: schermata pubblica.

Risultati, attesa e classifica sono stati delle rotte esistenti, non pagine aggiuntive.

## Qualità e verifica

Prima di considerare completa una modifica applicativa:

1. eseguire lint, typecheck e build disponibili;
2. verificare le transizioni interessate;
3. verificare host, display e almeno due partecipanti in sessioni browser separate;
4. controllare recovery da refresh e riconnessione;
5. verificare snapshot immutabile e rispetto della capienza configurata;
6. verificare che nessun payload pubblico esponga soluzione o associazioni avatar-risposta prima del reveal;
7. verificare che dopo il reveal gli avatar siano associati alle opzioni corrette e lo scoring sia singolo;
8. aggiornare i documenti se cambiano comportamento, schema o scope.

Per modifiche esclusivamente documentali, verificare coerenza tra README, requisiti, architettura, roadmap e questo file; non inventare script di verifica finché lo scaffold non esiste.

Non introdurre funzionalità secondarie prima che tutti i criteri MVP in `docs/requirements.md` siano soddisfatti.
