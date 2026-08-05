# Quiz Engine — architettura dell'MVP

## 1. Contesto e confini

Al 4 agosto 2026 il repository contiene soltanto documentazione: non esistono scaffold, dipendenze, migrazioni, progetto Supabase o deploy Vercel. Questa architettura guida l'implementazione da completare e collaudare entro il 6 agosto; non descrive componenti già presenti.

Il prodotto è un Quiz Engine multiplayer riutilizzabile. “Compleanno di Giorgio” è il primo dataset caricato tramite seed. Il motore non contiene regole specifiche per quel quiz e potrà eseguire altri quiz conformi allo stesso modello senza modifiche alla logica applicativa.

Restano fuori dall'MVP editor, marketplace, gestione utenti e creazione pubblica dei quiz.

## 2. Decisione architetturale

L'MVP usa una singola applicazione Next.js e un singolo progetto Supabase.

```text
Partecipante --------> Next.js (pagine e snapshot) ------> Supabase Postgres
     |                         ^                                  |
     +---- Auth anonimo -------+---- RPC join/voto ---------------+
     |                                                            |
     +<-------------- Supabase Realtime --------------------------+

Host ----------------> Route Handler Next.js ---------------------+
 sessione HttpOnly      (service_role solo server)                |
                                                                  |
Display -------------> snapshot sicuro + Realtime <---------------+
```

- Postgres è la fonte di verità per contenuti, preset, sessioni, partecipanti, risposte e punteggi.
- Realtime segnala cambiamenti persistenti; gli snapshot ripristinano lo stato dopo eventi persi.
- Auth anonimo identifica ogni browser partecipante senza account email.
- Le operazioni host passano dal server e non espongono `service_role`, soluzioni o voti individuali.
- Non servono websocket custom, ORM, state manager globale o libreria di componenti per l'MVP.

`lobby_public_sessions` è la proiezione materializzata e read-only dello stato
pubblico. Contiene codice, titolo, fase, capienza, domanda corrente con opzioni,
conteggio aggregato dei voti e coppie nickname/avatar. Trigger database la
mantengono sincronizzata; è l'unica relazione di gioco pubblicata in Realtime e
non contiene identificativi Auth, voti individuali, punteggi o soluzioni.

## 3. Struttura applicativa prevista

La struttura è indicativa e verrà creata durante l'implementazione:

```text
app/
  page.tsx
  play/[code]/page.tsx
  host/page.tsx
  host/[code]/page.tsx
  display/[code]/page.tsx
  api/host/session/route.ts
  api/host/game-sessions/route.ts
  api/host/game-sessions/[code]/route.ts
  api/host/game-sessions/[code]/start/route.ts
  api/host/game-sessions/[code]/players/[playerId]/route.ts
  api/host/game-sessions/[id]/transition/route.ts
  api/game-sessions/[code]/snapshot/route.ts
  api/game-sessions/[code]/results/route.ts
components/
lib/
  game/                    # fasi, transizioni, scoring e validazione
  supabase/                # client browser, server e tipi DB
supabase/
  migrations/
  seed.sql                 # contenuti e preset predefiniti
```

Attesa, voto, rivelazione e classifica sono stati delle tre rotte esistenti, non nuove pagine.

## 4. Responsabilità

### Browser partecipante

- crea o ripristina la sessione anonima;
- invoca `join_game_session` e `submit_vote`;
- carica lo snapshot e ascolta la sessione via Realtime;
- mostra solo la propria scelta prima del reveal;
- non calcola punteggi o correttezza autorevoli.

### Browser host

- autentica l'host tramite Route Handler;
- legge quiz e preset disponibili;
- modifica la configurazione per categoria e inserisce la capienza senza valore predefinito;
- chiede conferma prima di creare la sessione;
- riapre le sessioni recenti e, in lobby, rimuove giocatori o annulla la stanza;
- invia comandi espliciti `start`, `close`, `reveal`, `next`, `finish`.

### Display pubblico

- è read-only;
- durante `voting_open` e `voting_closed` mostra domanda, quattro risposte e solo il conteggio aggregato dei votanti;
- dopo `answer_revealed` riceve soluzione e associazioni avatar-risposta da un endpoint che verifica la fase.

### Route Handler Next.js

- gestiscono sessione host, elenco/dettaglio stanze, creazione, gestione lobby, transizioni e risultati protetti;
- usano `SUPABASE_SERVICE_ROLE_KEY` soltanto server-side;
- validano payload, autorizzazione e fase;
- restituiscono errori di dominio stabili senza dettagli interni.

### Supabase

- conserva dati e stato autorevole;
- esegue creazione, snapshot all'avvio, join, rimozione giocatore, annullamento stanza, voto e transizioni sensibili in transazione;
- applica RLS e pubblica in Realtime solo i dati necessari.

## 5. Modello dati dei contenuti

Le chiavi interne sono UUID e i timestamp sono `timestamptz` UTC.

### `quizzes`

| Colonna | Tipo | Note |
| --- | --- | --- |
| `id` | `uuid` PK | Identificativo del contenitore |
| `title` | `text` | Titolo pubblico |
| `created_at` | `timestamptz` | Default `now()` |

### `quiz_categories`

| Colonna | Tipo | Note |
| --- | --- | --- |
| `id` | `uuid` PK |  |
| `quiz_id` | `uuid` FK | Quiz proprietario |
| `name` | `text` | Nome mostrato all'host |
| `position` | `smallint` | Ordine stabile |

Vincoli univoci `(quiz_id, name)` e `(quiz_id, position)`.

### `questions`

| Colonna | Tipo | Note |
| --- | --- | --- |
| `id` | `uuid` PK |  |
| `category_id` | `uuid` FK | Categoria proprietaria |
| `prompt` | `text` | Testo non vuoto |
| `points` | `integer` | Punteggio positivo configurabile |

La relazione con il quiz deriva dalla categoria; non viene duplicata.

### `answer_options`

| Colonna | Tipo | Note |
| --- | --- | --- |
| `id` | `uuid` PK |  |
| `question_id` | `uuid` FK |  |
| `position` | `smallint` | Da 1 a 4 |
| `label` | `text` | Testo non vuoto |

Il vincolo univoco `(question_id, position)`, il range 1–4 e una validazione transazionale garantiscono esattamente quattro risposte. Le scritture dirette dei contenuti sono revocate: seed e routine di caricamento non possono rendere disponibile una domanda incompleta.

### `question_solutions`

| Colonna | Tipo | Note |
| --- | --- | --- |
| `question_id` | `uuid` PK/FK |  |
| `correct_option_id` | `uuid` FK | Deve appartenere alla stessa domanda |

La tabella non ha policy `SELECT` per client pubblici. Il seed e la creazione sessione rifiutano domande senza una sola soluzione coerente.

### `quiz_presets`

| Colonna | Tipo | Note |
| --- | --- | --- |
| `id` | `uuid` PK |  |
| `quiz_id` | `uuid` FK |  |
| `name` | `text` | Per esempio “Compleanno classico” |

### `preset_category_rules`

| Colonna | Tipo | Note |
| --- | --- | --- |
| `preset_id` | `uuid` FK |  |
| `category_id` | `uuid` FK | Categoria dello stesso quiz |
| `question_count` | `integer` | Intero non negativo |

Chiave primaria `(preset_id, category_id)`. La coerenza tra quiz del preset e categoria viene controllata dal database. I preset sono dati seed: l'host modifica una copia della configurazione, non queste righe.

## 6. Modello dati della sessione

### Tipo `game_phase`

Enum invariato:

```text
lobby
voting_open
voting_closed
answer_revealed
finished
```

### `game_sessions`

| Colonna | Tipo | Note |
| --- | --- | --- |
| `id` | `uuid` PK |  |
| `code` | `text` UNIQUE | Codice normalizzato uppercase |
| `quiz_id` | `uuid` FK nullable | Tracciabilità del quiz, `ON DELETE SET NULL` |
| `quiz_title` | `text` | Snapshot del titolo mostrato |
| `preset_id` | `uuid` FK nullable | Tracciabilità del preset, `ON DELETE SET NULL` |
| `preset_name` | `text` | Snapshot del preset usato come base |
| `max_players` | `integer` | Obbligatorio, positivo, nessun default |
| `phase` | `game_phase` | Default `lobby` |
| `current_session_question_id` | `uuid` nullable | `null` in lobby |
| `participant_count` | `integer` | Default 0 |
| `voted_count` | `integer` | Default 0 |
| `created_at` | `timestamptz` |  |
| `started_at` | `timestamptz` nullable |  |
| `finished_at` | `timestamptz` nullable |  |
| `updated_at` | `timestamptz` | Recovery e ordinamento eventi |

Vincoli: `max_players > 0`, contatori non negativi, `participant_count <= max_players` e `voted_count <= participant_count`.

### `session_category_config`

| Colonna | Tipo | Note |
| --- | --- | --- |
| `id` | `uuid` PK | Identità della configurazione copiata |
| `session_id` | `uuid` FK |  |
| `source_category_id` | `uuid` FK nullable | Tracciabilità, `ON DELETE SET NULL` |
| `position` | `smallint` | Ordine stabile della configurazione |
| `category_name` | `text` | Snapshot del nome |
| `question_count` | `integer` | Conteggio effettivo scelto |

Vincolo univoco `(session_id, position)`. Conserva la configurazione realmente confermata, distinta dal preset sorgente.

### `game_questions`

| Colonna | Tipo | Note |
| --- | --- | --- |
| `id` | `uuid` PK | Identità della copia di sessione |
| `session_id` | `uuid` FK |  |
| `source_question_id` | `uuid` FK nullable | Tracciabilità `ON DELETE SET NULL`, non fonte live |
| `position` | `smallint` | Ordine definitivo della partita |
| `category_name` | `text` | Snapshot |
| `prompt` | `text` | Snapshot |
| `points` | `integer` | Snapshot del punteggio |

Vincolo univoco `(session_id, position)`. La sessione usa sempre questi campi copiati, mai il contenuto sorgente durante la partita.

### `session_answer_options`

| Colonna | Tipo | Note |
| --- | --- | --- |
| `id` | `uuid` PK |  |
| `session_question_id` | `uuid` FK |  |
| `source_option_id` | `uuid` FK nullable | Tracciabilità `ON DELETE SET NULL` |
| `position` | `smallint` | Ordine definitivo 1–4 |
| `label` | `text` | Snapshot |

### `session_question_solutions`

| Colonna | Tipo | Note |
| --- | --- | --- |
| `session_question_id` | `uuid` PK/FK |  |
| `correct_session_option_id` | `uuid` FK | Opzione della stessa copia |

È separata e priva di lettura pubblica come `question_solutions`.

La transazione di avvio verifica inoltre che ogni `session_question` abbia esattamente quattro `session_answer_options`, una sola soluzione coerente e un `position` univoco. `current_session_question_id` deve riferirsi a una domanda della stessa sessione.

### `players`

| Colonna | Tipo | Note |
| --- | --- | --- |
| `id` | `uuid` PK |  |
| `session_id` | `uuid` FK |  |
| `user_id` | `uuid` | Corrisponde ad `auth.uid()` |
| `nickname` | `text` | Valore mostrato |
| `nickname_normalized` | `text` | Unicità case-insensitive |
| `avatar_key` | `text` | Identità visuale stabile generata all'ingresso |
| `total_score` | `integer` | Default 0 |
| `joined_at` | `timestamptz` | Tie-break stabile |

Vincoli univoci `(session_id, user_id)` e `(session_id, nickname_normalized)`. `avatar_key` permette un avatar deterministico da risorse predefinite, senza upload o profili.

### `votes`

| Colonna | Tipo | Note |
| --- | --- | --- |
| `id` | `uuid` PK |  |
| `session_id` | `uuid` FK |  |
| `session_question_id` | `uuid` FK |  |
| `participant_id` | `uuid` FK |  |
| `session_option_id` | `uuid` FK | Relazione da rivelare solo dopo il reveal |
| `submitted_at` | `timestamptz` | Aggiornato al cambio scelta |
| `is_correct` | `boolean` nullable | Valorizzato al reveal |
| `points_awarded` | `integer` nullable | Guardia di idempotenza |

Vincolo univoco `(session_id, session_question_id, participant_id)`. I contatori denormalizzati su `game_sessions` evitano di esporre `votes` a Realtime.

## 7. Operazioni atomiche

### Creazione sessione

Il Route Handler host, dopo la conferma della capienza, invoca un'operazione database transazionale che:

1. verifica host, quiz, preset e configurazione modificata;
2. verifica capienza positiva e disponibilità delle domande per categoria;
3. crea `game_sessions` senza default per `max_players`;
4. salva `session_category_config` senza creare ancora lo snapshot delle domande;
5. fallisce interamente se un'invariante non è rispettata.

### `join_game_session(p_code, p_nickname, p_avatar_key)`

Normalizza gli input, blocca la sessione, verifica `lobby`, capienza e unicità di nickname e avatar, crea o recupera il partecipante di `auth.uid()` e incrementa il conteggio solo al primo inserimento.

### Gestione host della lobby

`remove_lobby_player` blocca la sessione, accetta soltanto `lobby`, elimina il
giocatore richiesto e decrementa `participant_count` nella stessa transazione,
senza consentire valori negativi. `cancel_lobby_session` blocca e cancella una
sessione ancora in lobby; snapshot e giocatori vengono eliminati tramite
cascade. Entrambe le funzioni sono eseguibili soltanto da `service_role`.

### `start_game_session(p_game_session_id)`

Blocca la sessione, richiede fase `lobby` e almeno un partecipante, rilegge la
configurazione congelata e verifica la disponibilità sorgente. Seleziona le
domande con un ordinamento deterministico basato su sessione e domanda, copia
domande, quattro opzioni e soluzione nelle tabelle `game_*`, imposta
`current_question_index = 0`, `voted_count = 0`, `started_at` e la fase
`voting_open`. Ogni errore annulla l'intera transazione. La funzione è
eseguibile soltanto da `service_role`; per compatibilità riusa uno snapshot già
completo nelle lobby create prima della migration.

### `submit_vote(p_code, p_game_answer_option_id)`

Identifica il partecipante tramite `auth.uid()`, blocca la sessione, verifica
fase e domanda corrente e controlla che l'opzione appartenga alla copia di
sessione. Inserisce o aggiorna l'unico voto del giocatore per la domanda e
incrementa `voted_count` soltanto al primo inserimento. Restituisce esclusivamente
opzione selezionata, conteggio aggregato e indice corrente; non legge né
restituisce la soluzione.

`get_my_current_vote(p_code)` usa la stessa identità e restituisce soltanto
`game_answer_option_id` del chiamante sulla domanda corrente, oppure `null`.
Entrambe le RPC sono eseguibili dal ruolo `authenticated`, incluso un utente
Supabase Auth anonimo; una chiamata priva di `auth.uid()` viene rifiutata.

### Transizioni host

- `start`: `lobby` → `voting_open`, creando lo snapshot e aprendo la prima domanda;
- `close`: `voting_open` → `voting_closed`;
- `reveal`: `voting_closed` → `answer_revealed`, con valutazione e punteggi atomici;
- `next`: `answer_revealed` → `voting_open` sulla domanda seguente, con `voted_count = 0`;
- `finish`: `answer_revealed` → `finished` dopo l'ultima domanda.

Ogni comando verifica la fase nel database. Retry o fase incompatibile non ripetono effetti; un conflitto restituisce lo snapshot aggiornato.

## 8. RLS, snapshot e reveal

Policy minime:

- tabelle soluzione sorgente e di sessione: nessuna lettura pubblica;
- `votes`: nessuna lettura o scrittura diretta dai client; invio e recovery personale passano esclusivamente dalle RPC validate;
- `players`: una proiezione sicura rende leggibili nickname, avatar e punteggi dove servono alla lobby/classifica; `user_id` e associazioni con le risposte non sono pubblici;
- contenuti, preset e sessioni: lettura dei soli campi non sensibili; mutazioni server-side.

La proiezione Realtime restituisce fase, conteggi e contenuto pubblico della
domanda corrente. La scelta personale viene recuperata separatamente con
`get_my_current_vote`; prima del reveal nessun payload include soluzione,
correttezza, distribuzione o scelte degli altri partecipanti.

`GET /api/game-sessions/[code]/results` verifica server-side `answer_revealed` o `finished` e la domanda rivelata. Restituisce:

- opzione corretta;
- per ogni opzione, gli `avatar_key` dei partecipanti che l'hanno scelta;
- classifica;
- per il partecipante autenticato, esito e punti personali.

Questo è l'unico confine pubblico che rivela la relazione richiesta. Non espone token o identificativi Auth e non è disponibile nelle fasi precedenti.

## 9. Realtime e recovery

Display e partecipanti sottoscrivono la riga della proiezione sicura
`lobby_public_sessions` filtrata per codice sia in lobby sia durante la domanda.
Le tabelle autorevoli `game_sessions`, `game_questions`, `players` e `votes` non
sono leggibili direttamente dai client pubblici. Non si pubblicano voti
individuali e non si usa Presence come contatore.

Sequenza consigliata:

1. creare la subscription;
2. ottenere lo snapshot `no-store`;
3. applicare gli eventi successivi della proiezione;
4. rifare lo snapshot al ritorno online o dopo un errore del canale.

## 10. Flusso completo

1. Migrazioni e seed caricano almeno “Compleanno di Giorgio”, categorie, domande e preset.
2. L'host accede, sceglie quiz e preset, modifica i conteggi e inserisce il massimo giocatori.
3. Dopo la conferma, la sessione viene creata con configurazione immutabile.
4. I partecipanti entrano in lobby fino alla capienza e ricevono un avatar stabile.
5. L'host avvia: snapshot e ordine vengono congelati atomicamente e la prima domanda diventa pubblica.
6. L'host chiude esplicitamente il voto senza mostrare soluzione o associazioni.
7. L'host rivela: scoring idempotente, soluzione e avatar compaiono accanto alle risposte scelte.
8. L'host apre la domanda successiva oppure termina con la classifica finale.

## 11. Sicurezza host e configurazione

L'MVP usa `HOST_ACCESS_PASSWORD` e un cookie firmato con `HOST_SESSION_SECRET`. Ogni Route Handler mutativo verifica firma, scadenza, attributi del cookie e origine della richiesta prima di usare la `service_role`.

| Variabile | Visibilità | Uso |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser e server | URL Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser e server | Chiave pubblica soggetta a RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo server | Operazioni privilegiate |
| `HOST_ACCESS_PASSWORD` | Solo server | Accesso host |
| `HOST_SESSION_SECRET` | Solo server | Firma sessione host |

## 12. Deploy, verifica e rischi

- Un progetto Vercel serve Next.js; un progetto Supabase ospita database, Auth anonimo e Realtime.
- Migrazioni e seed sono versionati; dopo il setup si evitano modifiche manuali al database definitivo.
- I log registrano identificativi tecnici e codici errore, mai segreti o risposte individuali.
- Prima dell'evento si prova il deploy reale con host, display e più sessioni browser.

| Rischio | Mitigazione MVP |
| --- | --- |
| Contenuto sorgente cambia | Validazione all'avvio e snapshot completo nella stessa transazione |
| Preset chiede troppe domande | Validazione di disponibilità prima dell'estrazione |
| Capienza superata da join concorrenti | Blocco riga e controllo atomico su `max_players` |
| Reveal ripetuto | Fase condizionale e `points_awarded` idempotente |
| Voti visibili in anticipo | RLS, nessun Realtime su `votes`, endpoint risultati vincolato alla fase |
| Realtime perde un evento | Snapshot iniziale e refetch alla riconnessione |
| Scope eccessivo | Contenuti solo seed, nessun editor, marketplace o account utente |
