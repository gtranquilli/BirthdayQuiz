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

Per la lobby, `lobby_public_sessions` è una proiezione materializzata e read-only
che contiene soltanto codice, titolo, fase, capienza, conteggio partecipanti e
la coppia pubblica nickname/avatar. Trigger database la mantengono sincronizzata
con `game_sessions` e `players`; è l'unica relazione della lobby pubblicata in
Realtime e non contiene identificativi Auth, voti o soluzioni.

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
- invia comandi espliciti `start`, `close`, `reveal`, `next`, `finish`.

### Display pubblico

- è read-only;
- durante `voting_open` e `voting_closed` mostra domanda, quattro risposte e solo il conteggio aggregato dei votanti;
- dopo `answer_revealed` riceve soluzione e associazioni avatar-risposta da un endpoint che verifica la fase.

### Route Handler Next.js

- gestiscono sessione host, creazione sessione, transizioni e risultati protetti;
- usano `SUPABASE_SERVICE_ROLE_KEY` soltanto server-side;
- validano payload, autorizzazione e fase;
- restituiscono errori di dominio stabili senza dettagli interni.

### Supabase

- conserva dati e stato autorevole;
- esegue creazione, estrazione, join, voto e transizioni sensibili in transazione;
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

La transazione di creazione verifica inoltre che ogni `session_question` abbia esattamente quattro `session_answer_options`, una sola soluzione coerente e un `position` univoco. `current_session_question_id` deve riferirsi a una domanda della stessa sessione.

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
4. salva `session_category_config`;
5. estrae i quesiti richiesti e congela domande, quattro opzioni, soluzioni e punteggi;
6. assegna e salva l'ordine definitivo;
7. fallisce interamente se un'invariante non è rispettata.

### `join_game_session(p_code, p_nickname)`

Normalizza gli input, blocca la sessione, verifica `lobby` e `participant_count < max_players`, crea o recupera il partecipante di `auth.uid()`, genera un avatar stabile e incrementa il conteggio solo al primo inserimento.

### `submit_vote(p_session_id, p_session_question_id, p_session_option_id)`

Identifica il partecipante tramite `auth.uid()`, verifica fase e domanda corrente, controlla che l'opzione appartenga alla copia di sessione, esegue insert/upsert e incrementa `voted_count` soltanto al primo voto. Non legge né restituisce la soluzione.

### Transizioni host

- `start`: `lobby` → `voting_open` sulla prima domanda congelata;
- `close`: `voting_open` → `voting_closed`;
- `reveal`: `voting_closed` → `answer_revealed`, con valutazione e punteggi atomici;
- `next`: `answer_revealed` → `voting_open` sulla domanda seguente, con `voted_count = 0`;
- `finish`: `answer_revealed` → `finished` dopo l'ultima domanda.

Ogni comando verifica la fase nel database. Retry o fase incompatibile non ripetono effetti; un conflitto restituisce lo snapshot aggiornato.

## 8. RLS, snapshot e reveal

Policy minime:

- tabelle soluzione sorgente e di sessione: nessuna lettura pubblica;
- `votes`: ogni partecipante legge solo la propria risposta; scrittura diretta disabilitata in favore della funzione validata;
- `players`: una proiezione sicura rende leggibili nickname, avatar e punteggi dove servono alla lobby/classifica; `user_id` e associazioni con le risposte non sono pubblici;
- contenuti, preset e sessioni: lettura dei soli campi non sensibili; mutazioni server-side.

`GET /api/game-sessions/[code]/snapshot` restituisce fase, conteggi e contenuto della domanda corrente. Per un partecipante autenticato include la propria scelta. Prima del reveal non include mai soluzione, correttezza, distribuzione o associazioni partecipante-opzione.

`GET /api/game-sessions/[code]/results` verifica server-side `answer_revealed` o `finished` e la domanda rivelata. Restituisce:

- opzione corretta;
- per ogni opzione, gli `avatar_key` dei partecipanti che l'hanno scelta;
- classifica;
- per il partecipante autenticato, esito e punti personali.

Questo è l'unico confine pubblico che rivela la relazione richiesta. Non espone token o identificativi Auth e non è disponibile nelle fasi precedenti.

## 9. Realtime e recovery

Durante la lobby, display e partecipanti sottoscrivono la riga della proiezione
sicura `lobby_public_sessions` filtrata per codice. Le tabelle autorevoli
`game_sessions` e `players` non sono leggibili direttamente dai client
pubblici. Non si sottoscrivono pubblicamente `votes` e non si usa Presence come
contatore.

Sequenza consigliata:

1. creare la subscription;
2. ottenere lo snapshot `no-store`;
3. applicare gli eventi successivi della proiezione;
4. rifare lo snapshot al ritorno online o dopo un errore del canale.

## 10. Flusso completo

1. Migrazioni e seed caricano almeno “Compleanno di Giorgio”, categorie, domande e preset.
2. L'host accede, sceglie quiz e preset, modifica i conteggi e inserisce il massimo giocatori.
3. Dopo la conferma, la sessione viene creata con contenuti e ordine congelati.
4. I partecipanti entrano in lobby fino alla capienza e ricevono un avatar stabile.
5. L'host apre la domanda; i voti aggiornano soltanto il conteggio aggregato visibile.
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
| Contenuto sorgente cambia | Snapshot completo alla creazione della sessione |
| Preset chiede troppe domande | Validazione di disponibilità prima dell'estrazione |
| Capienza superata da join concorrenti | Blocco riga e controllo atomico su `max_players` |
| Reveal ripetuto | Fase condizionale e `points_awarded` idempotente |
| Voti visibili in anticipo | RLS, nessun Realtime su `votes`, endpoint risultati vincolato alla fase |
| Realtime perde un evento | Snapshot iniziale e refetch alla riconnessione |
| Scope eccessivo | Contenuti solo seed, nessun editor, marketplace o account utente |
