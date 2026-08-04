# Architettura dell'MVP

## 1. Analisi del progetto corrente

Al momento dell'analisi il repository contiene soltanto `.git`. Non esistono codice applicativo, `package.json`, configurazione Next.js/Tailwind, migrazioni, test, variabili d'ambiente documentate o integrazioni Supabase/Vercel.

Conseguenze:

- non ci sono vincoli legacy o modifiche utente da preservare;
- scaffold, database e deploy fanno parte della roadmap, ma non di questa attività di documentazione;
- versioni e comandi esatti verranno registrati quando le dipendenze saranno effettivamente installate;
- il rischio principale non è il refactoring, ma l'eccesso di scope nei tre giorni disponibili.

## 2. Decisione architetturale

L'MVP usa una singola applicazione Next.js e un singolo progetto Supabase.

```text
Telefono partecipante ----> Next.js (pagine/snapshot) ----> Supabase Postgres
          |                         ^                              |
          +---- Auth anonimo -------+---- RPC voto/join -----------+
          |                                                        |
          +<------------ Supabase Realtime ------------------------+

Pannello host -----------> Route Handler Next.js ------------------+
   sessione HttpOnly       (service_role solo server)              |
                                                                   |
Display pubblico --------> snapshot sicuro + Realtime <------------+
```

### Perché questa forma

- Un monolite Next.js evita servizi e deploy aggiuntivi.
- Postgres conserva lo stato autorevole anche quando le funzioni Vercel sono effimere.
- Realtime notifica cambiamenti persistenti; uno snapshot ristabilisce lo stato dopo eventi persi.
- Supabase Auth anonimo fornisce a ogni browser un `auth.uid()` senza introdurre email, password o un sistema token proprietario.
- Le operazioni host attraversano il server, così password, soluzione e `service_role` non raggiungono il browser.

Non servono state manager globale, websocket custom, code generator per QR, ORM o libreria di componenti per l'MVP.

## 3. Struttura applicativa prevista

La struttura è indicativa e verrà creata soltanto durante l'implementazione:

```text
app/
  page.tsx                    # ingresso partecipante
  play/[code]/page.tsx        # esperienza mobile
  host/page.tsx               # accesso e nuova stanza
  host/[code]/page.tsx        # pannello di controllo
  display/[code]/page.tsx     # schermo pubblico
  api/host/session/route.ts
  api/host/rooms/route.ts
  api/host/rooms/[id]/transition/route.ts
  api/rooms/[code]/snapshot/route.ts
  api/rooms/[code]/results/route.ts
components/
lib/
  game/                       # fasi, transizioni, tipi e scoring condivisi
  supabase/                   # client browser, server e tipi DB
supabase/
  migrations/
  seed.sql                    # quiz preparato per l'evento
```

Le schermate di attesa, voto, rivelazione e classifica sono rendering diversi della stessa rotta in base alla fase. Non richiedono nuove pagine.

## 4. Responsabilità dei componenti

### Browser partecipante

- crea o ripristina la sessione anonima;
- invoca la funzione `join_room`;
- carica lo snapshot della stanza;
- invoca `submit_answer`;
- ascolta la riga stanza e il proprio stato;
- non calcola mai punteggi autorevoli.

### Browser host

- autentica il presentatore tramite Route Handler;
- carica lo stato corrente;
- invia soltanto comandi espliciti (`start`, `close`, `reveal`, `next`, `finish`);
- disabilita i comandi incompatibili con la fase corrente;
- riceve aggiornamenti di conteggio e classifica.

### Display pubblico

- è read-only;
- riceve lo stato pubblico tramite codice stanza;
- durante il voto renderizza solo il conteggio aggregato come informazione sui voti;
- dopo `answer_revealed` richiede l'endpoint risultati, che verifica la fase prima di restituire soluzione e aggregati.

### Route Handler Next.js

- gestiscono sessione e comandi host;
- usano `SUPABASE_SERVICE_ROLE_KEY` solo lato server;
- validano payload, sessione e transizione richiesta;
- restituiscono errori di dominio stabili, non dettagli interni del database.

### Supabase

- contiene vincoli, dati e stato corrente;
- identifica i partecipanti con Auth anonimo;
- esegue join, voto e transizioni sensibili in transazione;
- applica RLS e pubblica soltanto le tabelle necessarie a Realtime.

## 5. Modello dati Supabase

Si usano UUID per le chiavi interne e timestamp `timestamptz` in UTC. Tutte le tabelle includono i soli campi necessari all'MVP.

### `quizzes`

| Colonna | Tipo | Note |
| --- | --- | --- |
| `id` | `uuid` PK | Default `gen_random_uuid()` |
| `title` | `text` | Titolo pubblico |
| `created_at` | `timestamptz` | Default `now()` |

### `questions`

| Colonna | Tipo | Note |
| --- | --- | --- |
| `id` | `uuid` PK |  |
| `quiz_id` | `uuid` FK | `quizzes.id`, delete cascade |
| `position` | `smallint` | Ordine a partire da 1 |
| `prompt` | `text` | Testo domanda |

Vincolo univoco `(quiz_id, position)`; `prompt` non vuoto.

### `answer_options`

| Colonna | Tipo | Note |
| --- | --- | --- |
| `id` | `uuid` PK |  |
| `question_id` | `uuid` FK | `questions.id`, delete cascade |
| `position` | `smallint` | Ordine stabile |
| `label` | `text` | Testo opzione |

Vincolo univoco `(question_id, position)`; almeno due opzioni viene garantito dal processo di seed/validazione.

### `question_solutions`

| Colonna | Tipo | Note |
| --- | --- | --- |
| `question_id` | `uuid` PK/FK | `questions.id`, delete cascade |
| `correct_option_id` | `uuid` FK | Deve appartenere alla stessa domanda |

Questa separazione è intenzionale: la tabella non ha policy `SELECT` per `anon` o `authenticated`. La coerenza domanda/opzione va verificata con trigger o funzione di caricamento.

### Tipo `room_phase`

Enum Postgres con valori:

```text
lobby
voting_open
voting_closed
answer_revealed
finished
```

### `rooms`

| Colonna | Tipo | Note |
| --- | --- | --- |
| `id` | `uuid` PK |  |
| `code` | `text` UNIQUE | 6 caratteri normalizzati uppercase |
| `quiz_id` | `uuid` FK | Quiz immutabile dopo l'avvio |
| `phase` | `room_phase` | Default `lobby` |
| `current_question_id` | `uuid` FK nullable | `null` in lobby |
| `participant_count` | `integer` | Contatore persistente, default 0 |
| `voted_count` | `integer` | Contatore della domanda, default 0 |
| `created_at` | `timestamptz` |  |
| `started_at` | `timestamptz` nullable |  |
| `finished_at` | `timestamptz` nullable |  |
| `updated_at` | `timestamptz` | Utile per recovery/cache |

Vincoli: contatori non negativi e `voted_count <= participant_count`. Indici su `code`, `phase` e `quiz_id`.

I contatori sono denormalizzati deliberatamente: il display può ascoltare una sola riga senza leggere le risposte individuali. Vengono modificati soltanto dalle funzioni transazionali.

### `participants`

| Colonna | Tipo | Note |
| --- | --- | --- |
| `id` | `uuid` PK | Identificativo di dominio |
| `room_id` | `uuid` FK | `rooms.id`, delete cascade |
| `user_id` | `uuid` | Corrisponde ad `auth.uid()` anonimo |
| `nickname` | `text` | Valore mostrato |
| `nickname_normalized` | `text` | Per unicità case-insensitive |
| `total_score` | `integer` | Default 0, mai negativo |
| `joined_at` | `timestamptz` | Tie-break stabile di visualizzazione |

Vincoli univoci `(room_id, user_id)` e `(room_id, nickname_normalized)`. Indici su `room_id` e `(room_id, total_score desc)`.

### `responses`

| Colonna | Tipo | Note |
| --- | --- | --- |
| `id` | `uuid` PK |  |
| `room_id` | `uuid` FK | Denormalizzato per controlli/indici |
| `question_id` | `uuid` FK |  |
| `participant_id` | `uuid` FK |  |
| `option_id` | `uuid` FK |  |
| `submitted_at` | `timestamptz` | Aggiornato quando cambia scelta |
| `is_correct` | `boolean` nullable | Valorizzato alla rivelazione |
| `points_awarded` | `integer` nullable | `null` prima dello scoring |

Vincolo univoco `(room_id, question_id, participant_id)`. La funzione di voto verifica che stanza, domanda, partecipante e opzione siano coerenti. Indici su `(room_id, question_id)` e `participant_id`.

`points_awarded is null` è anche una guardia di idempotenza: la procedura di rivelazione aggiorna e somma soltanto risposte non ancora valutate, nella stessa transazione che cambia fase.

## 6. Funzioni e transazioni database

### `join_room(p_code, p_nickname)`

Funzione `security definer` con `search_path` fissato esplicitamente:

1. normalizza e valida gli input;
2. blocca la riga stanza interessata;
3. verifica `phase = 'lobby'` e capienza;
4. crea o restituisce il partecipante associato ad `auth.uid()`;
5. incrementa `participant_count` soltanto sul primo inserimento;
6. restituisce i soli dati pubblici necessari.

### `submit_answer(p_room_id, p_question_id, p_option_id)`

1. individua il partecipante tramite `auth.uid()`;
2. blocca/legge la stanza e verifica `voting_open` e domanda corrente;
3. verifica che l'opzione appartenga alla domanda;
4. inserisce o aggiorna la risposta;
5. incrementa `voted_count` soltanto se è la prima risposta del partecipante per quella domanda;
6. non consulta né restituisce la soluzione.

### Transizioni host

Un'unica funzione interna, chiamabile solo dal server privilegiato, riceve stanza e azione:

- `start`: da `lobby` apre la prima domanda;
- `close`: da `voting_open` a `voting_closed`;
- `reveal`: da `voting_closed` a `answer_revealed`, valuta risposte e aggiorna punteggi atomicamente;
- `next`: da `answer_revealed` apre la domanda seguente e azzera `voted_count`;
- `finish`: da `answer_revealed` a `finished`, soltanto dopo l'ultima domanda.

Ogni comando verifica la fase attesa nel database, non soltanto nella UI. Un conflitto restituisce `409` con lo snapshot aggiornato. Non sono previsti rollback o riapertura nell'MVP.

## 7. Accesso ai dati e RLS

Policy minime:

- `question_solutions`: nessun accesso pubblico; solo server privilegiato/funzioni autorizzate.
- `responses`: un partecipante può leggere soltanto la propria riga; nessun `SELECT` pubblico sugli altri voti; scrittura diretta disabilitata in favore di `submit_answer`.
- `participants`: lettura di nickname e punteggio consentita ai client della stanza per la classifica; insert/update diretti disabilitati.
- `rooms`, `quizzes`, `questions`, `answer_options`: lettura dei campi non sensibili necessaria alla partita; mutazioni soltanto server-side.

Il codice stanza facilita l'accesso ma non è una credenziale forte. Per non aggiungere un sistema di token stanza e policy complesse in tre giorni, l'MVP considera pubblici i dati non sensibili della partita. Soluzioni, comandi host e risposte individuali restano comunque protetti.

Le viste pubbliche non devono usare accidentalmente privilegi del proprietario. Se si introducono viste, configurarle con comportamento `security_invoker` o applicare policy equivalenti e verificarle con chiave anonima.

## 8. Snapshot, risultati e Realtime

### Snapshot

`GET /api/rooms/[code]/snapshot` restituisce un payload dipendente dalla fase:

- sempre: codice, titolo, fase, conteggi e domanda corrente se presente;
- partecipante autenticato: propria risposta e proprio punteggio;
- mai prima della rivelazione: soluzione, correttezza o distribuzione.

La risposta deve essere `no-store` perché rappresenta stato live.

### Risultati

`GET /api/rooms/[code]/results` verifica che la fase sia `answer_revealed` o `finished`, poi restituisce:

- opzione corretta della domanda corrente;
- conteggi aggregati per opzione;
- classifica ordinata;
- per il partecipante autenticato, esito e punti della propria risposta.

Non restituisce mai la relazione tra nickname e singola opzione votata.

### Realtime

Client host, display e partecipanti sottoscrivono la riga `rooms` filtrata per `id`. La classifica può aggiornarsi tramite `participants` filtrata per `room_id`, oppure essere rifatta al cambio fase.

Sequenza di connessione consigliata:

1. creare la subscription;
2. ottenere lo snapshot;
3. applicare soltanto stati con `updated_at` non precedente allo snapshot;
4. al ritorno online o dopo errore del canale, richiedere un nuovo snapshot.

Non sottoscrivere pubblicamente `responses`. Non usare Presence per `participant_count`: una scheda in background o una breve perdita di rete renderebbe il conteggio instabile.

## 9. Flusso completo di una partita

1. Il quiz viene caricato in Supabase e validato prima dell'evento.
2. L'host accede, crea la stanza e apre `/display/[code]` sullo schermo pubblico.
3. Il display mostra il codice; i partecipanti entrano da `/` e attendono in lobby.
4. L'host avvia la prima domanda; database, display e telefoni passano a `voting_open`.
5. I partecipanti inviano o modificano la propria scelta. La stanza aggiorna solo il contatore dei primi voti.
6. Il display mostra domanda, opzioni e conteggio aggregato, senza rivelare chi o cosa è stato votato.
7. Quando è pronto, anche se il totale non è completo, l'host preme “Chiudi votazione”.
8. La fase `voting_closed` impedisce ulteriori scritture, ma non mostra ancora la soluzione.
9. L'host preme “Rivela risposta”. Una transazione valuta risposte, assegna punti e cambia fase.
10. I client evidenziano la risposta corretta con una breve animazione e mostrano risultati/classifica.
11. L'host apre la domanda successiva; il contatore si azzera e il ciclo riparte dal punto 5.
12. Dopo l'ultima domanda, l'host termina e tutti vedono la classifica finale.

## 10. Sicurezza host

Per l'evento singolo è sufficiente una password condivisa `HOST_ACCESS_PASSWORD`. Dopo verifica server-side, il server imposta un cookie contenente una prova firmata con `HOST_SESSION_SECRET`, usando primitive crittografiche native. Il cookie non contiene la password in chiaro.

Ogni Route Handler host:

- verifica firma, scadenza e attributi del cookie;
- valida l'azione richiesta;
- usa la `service_role` soltanto dopo la verifica;
- applica protezione same-origin per le richieste mutative.

Se in futuro serviranno più presentatori o audit, si sostituirà questo gate con Supabase Auth per host; non è necessario nell'MVP.

## 11. Variabili d'ambiente previste

| Variabile | Visibilità | Uso |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser e server | URL progetto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser e server | Chiave pubblica soggetta a RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo server | Comandi host e risultati protetti |
| `HOST_ACCESS_PASSWORD` | Solo server | Accesso del presentatore |
| `HOST_SESSION_SECRET` | Solo server | Firma della sessione host |

I nomi potranno essere adeguati alla nomenclatura corrente del progetto Supabase durante lo scaffold, ma il confine pubblico/privato non cambia.

## 12. Deploy e osservabilità

- Un progetto Vercel serve tutte le rotte Next.js.
- Un progetto Supabase ospita database, Auth anonimo e Realtime.
- Migrazioni e seed sono versionati nel repository; modifiche manuali al database di produzione vengono evitate dopo il setup.
- Tabelle necessarie vengono abilitate esplicitamente nella pubblicazione Realtime.
- I log registrano stanza, azione e codice errore con identificativi tecnici, ma non password, cookie o contenuto dei voti.
- Prima dell'evento si esegue una prova sul deploy reale con dispositivi e rete che verranno usati.

## 13. Rischi e mitigazioni

| Rischio | Mitigazione MVP |
| --- | --- |
| Realtime perde un evento | Snapshot iniziale e refetch alla riconnessione |
| Partecipante chiude la pagina | Conteggio persistente; l'host può chiudere manualmente |
| Doppio click dell'host | Transizioni condizionali e scoring idempotente |
| Due risposte simultanee dallo stesso browser | Vincolo univoco e upsert transazionale |
| Soluzione leggibile dal client | Tabella separata senza policy pubblica; endpoint con controllo fase |
| Scope eccessivo | Quiz pre-caricato, punteggio fisso, nessun timer/authoring |
| Rete dell'evento instabile | Messaggi di connessione, retry esplicito e prova sul posto |
| Display espone controlli | Rotte `/host/[code]` e `/display/[code]` separate |
