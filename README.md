# BirthdayQuiz

BirthdayQuiz sarà una web app per gestire un quiz di compleanno dal vivo. Il presentatore controlla la partita, una pagina dedicata viene mostrata sullo schermo principale e i partecipanti rispondono dal browser del proprio smartphone usando un codice stanza e un nickname.

## Stato del progetto

Il progetto è attualmente nella fase di progettazione. Al 3 agosto 2026 il repository iniziale conteneva soltanto la directory Git: non sono ancora presenti scaffold Next.js, dipendenze, migrazioni Supabase o codice applicativo.

Questa prima attività definisce l'MVP e il piano di lavoro senza implementare l'applicazione.

## MVP proposto

- Quiz già preparato in Supabase, con più domande e risposte multiple.
- Creazione di una stanza protetta da accesso host.
- Accesso dei partecipanti con codice e nickname, senza email.
- Lobby con conteggio dei partecipanti.
- Apertura della domanda e voto da smartphone.
- Conteggio aggregato `voti ricevuti / partecipanti` sul display, senza rivelare identità o scelte.
- Comandi distinti per chiudere il voto e rivelare la risposta.
- Breve animazione di rivelazione, risultati aggregati, punti e classifica.
- Avanzamento attraverso tutte le domande e classifica finale.
- Ripristino dello stato dopo refresh o una breve disconnessione.

Per rispettare i tre giorni disponibili, l'MVP non comprende editor di quiz, timer, squadre, domande con immagini, speed bonus, chat, account partecipante o storico delle partite.

## Interfacce previste

| Rotta | Utente | Responsabilità |
| --- | --- | --- |
| `/` | Partecipante | Inserimento di codice stanza e nickname |
| `/play/[code]` | Partecipante | Attesa, voto, esito personale e classifica |
| `/host` | Presentatore | Accesso host e creazione stanza |
| `/host/[code]` | Presentatore | Controlli della partita e monitoraggio |
| `/display/[code]` | Pubblico | Codice stanza, domanda, conteggio voti, rivelazione e classifica |

Lo schermo pubblico e il pannello host sono separati per evitare che controlli e informazioni operative finiscano nella proiezione. Possono essere aperti in due finestre dello stesso computer oppure su due dispositivi.

## Architettura in breve

- Next.js App Router e TypeScript per pagine e API server-side.
- Tailwind CSS per un'interfaccia responsive senza un component framework aggiuntivo.
- Supabase Postgres come fonte di verità.
- Supabase Auth anonimo per identificare il browser di ogni partecipante senza email.
- Supabase Realtime per propagare fase, conteggi e classifica.
- Row Level Security e funzioni SQL per impedire voti fuori fase e accessi ai dati privati.
- Vercel per il deploy; le operazioni host privilegiate restano server-side.

I dettagli, inclusi modello dati e confini di sicurezza, sono in [docs/architecture.md](docs/architecture.md).

## Documentazione

- [Requisiti e criteri di accettazione](docs/requirements.md)
- [Architettura e modello Supabase](docs/architecture.md)
- [Roadmap dei tre giorni](docs/roadmap.md)
- [Regole operative per chi sviluppa](AGENTS.md)

## Prima di iniziare a implementare

Occorre confermare almeno:

1. numero massimo atteso di partecipanti;
2. contenuto definitivo del quiz e numero di opzioni per domanda;
3. regola di punteggio e spareggio;
4. modalità fisica di utilizzo di pannello host e display;
5. significato esatto del vincolo sul display durante il voto, cioè se domanda e testi delle opzioni debbano restare visibili.

La baseline consigliata e le alternative sono elencate in [docs/roadmap.md](docs/roadmap.md#decisioni-da-confermare-prima-dello-sviluppo).

## Avvio locale

Non ancora disponibile: il repository non contiene codice applicativo. I comandi di installazione e avvio verranno aggiunti dopo la creazione dello scaffold, senza inventare script prima che esistano.
