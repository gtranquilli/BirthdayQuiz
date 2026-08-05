# Quiz Engine — roadmap MVP al 6 agosto 2026

## Principio di esecuzione

La finestra di implementazione e collaudo è il 4–6 agosto 2026. La priorità è consegnare un flusso verticale affidabile: configurazione host → sessione congelata → ingresso → voto → chiusura → reveal con avatar → punteggio → domanda successiva → classifica finale.

Le nuove astrazioni servono a rendere riutilizzabile il motore, non ad ampliare il prodotto. Contenuti e preset arrivano solo da seed; editor, marketplace, gestione utenti e creazione pubblica restano fuori dai tre giorni.

## Decisioni funzionali chiuse

| Tema | Decisione MVP |
| --- | --- |
| Prodotto | Quiz Engine generico; “Compleanno di Giorgio” è il primo quiz seed |
| Contenuti | Quiz → categorie → domande → quattro risposte, una corretta |
| Punteggio | Valore positivo configurato per domanda nel seed; nessun bonus velocità |
| Composizione | Preset con conteggi per categoria, modificabili solo per la nuova sessione |
| Sessione | Configurazione congelata alla creazione; domande, risposte, soluzioni, punteggi e ordine congelati all'avvio |
| Capienza | Valore obbligatorio inserito dall'host, senza default, confermato prima della creazione |
| Privacy | Prima del reveal solo conteggio aggregato; dopo il reveal avatar sulle risposte scelte |
| Fasi | `lobby`, `voting_open`, `voting_closed`, `answer_revealed`, `finished` |
| Contenuti MVP | Solo migrazioni e seed, nessuna UI di authoring |

Prima di iniziare il seed definitivo servono i testi reali del quiz di Giorgio, le categorie, le quattro risposte e la soluzione di ogni domanda, il relativo punteggio e almeno un preset valido. Questa è preparazione dei dati, non una decisione di prodotto ancora aperta.

## 4 agosto — Fondamenta e creazione sessione

Obiettivo: modellare il Quiz Engine e creare una sessione immutabile da un preset.

### 1. Scaffold minimo

- [ ] Inizializzare Next.js App Router con TypeScript strict e Tailwind.
- [ ] Mantenere le dipendenze minime e aggiungere `.env.example` senza segreti.
- [ ] Definire script reali per sviluppo, lint, typecheck e build.

Verifica: shell delle rotte previste, lint, typecheck e build funzionano.

### 2. Schema contenuti e preset

- [ ] Creare `quizzes`, `quiz_categories`, `questions`, `answer_options` e `question_solutions`.
- [ ] Creare `quiz_presets` e `preset_category_rules`.
- [ ] Vincolare categoria/quiz, punteggio positivo, quattro risposte e una soluzione coerente.
- [ ] Attivare RLS e impedire lettura pubblica delle soluzioni.

Verifica: un quiz valido è riutilizzabile e un contenuto incompleto viene rifiutato prima dell'uso.

### 3. Schema sessione e snapshot

- [ ] Creare `game_sessions` con `max_players` obbligatorio e senza default.
- [ ] Creare configurazione, domande, opzioni e soluzioni di sessione.
- [ ] Creare partecipanti e risposte con vincoli univoci e contatori persistenti.
- [ ] Implementare la macchina a stati invariata.

Verifica: una sessione avviata non dipende più dai contenuti live.

### 4. Seed iniziale

- [ ] Caricare “Compleanno di Giorgio”, categorie e domande definitive.
- [ ] Garantire quattro risposte, una soluzione e un punteggio per domanda.
- [ ] Caricare almeno un preset, incluso “Compleanno classico” se coerente con i dati disponibili.
- [ ] Rendere il seed idempotente e documentarne l'esecuzione.

Verifica: il quiz completo è interrogabile, mentre le soluzioni restano inaccessibili con chiave pubblica.

### 5. Configurazione host e creazione atomica

- [ ] Mostrare quiz, preset e conteggi per categoria modificabili in `/host`.
- [ ] Lasciare vuoto “Numero massimo giocatori” e accettare solo interi positivi.
- [ ] Mostrare “Creare una partita con massimo N giocatori?” prima della creazione.
- [ ] Validare disponibilità per categoria e salvare la configurazione della lobby.
- [ ] Demandare estrazione e copia atomica all'azione host di avvio.

Verifica: configurazioni impossibili non creano dati parziali; modifiche successive al quiz non cambiano la sessione.

## 5 agosto — Motore multiplayer completo

Obiettivo: giocare tutte le domande con le tre superfici, anche con UI essenziale.

### 6. Accesso e lobby

- [ ] Proteggere le operazioni host con password ambiente e cookie firmato.
- [x] Creare o ripristinare Auth anonimo nel browser partecipante.
- [x] Aprire `/join/[code]` tramite QR e mantenere la home come fallback per il codice.
- [x] Implementare il join con nickname, fase e capienza atomica.
- [x] Assegnare e conservare un avatar visuale stabile.
- [x] Impedire avatar duplicati nella stessa stanza.
- [x] Recuperare lo stesso player dopo la perdita di Auth tramite rejoin token
  personale hashato e ruotato atomicamente.
- [ ] Consentire all'host di riaprire stanze recenti, rimuovere giocatori e annullare una lobby.
- [x] Completare `/`, `/join/[code]`, `/play/[code]`, `/host/[code]` e `/display/[code]` per la lobby.

Verifica: due sessioni browser entrano; refresh non duplica; il partecipante oltre capienza viene rifiutato.

### 7. Snapshot, Realtime e recovery

- [ ] Implementare snapshot iniziale dipendente da fase e identità.
- [ ] Sottoscrivere soltanto i cambiamenti persistenti necessari.
- [ ] Rifare lo snapshot a riconnessione e ritorno online.
- [ ] Gestire loading, offline ed errore del canale.

Verifica: host, display e telefoni ricostruiscono lo stato dopo refresh ed eventi persi.

### 8. Apertura e voto anonimo

- [x] Collegare `start` alla creazione atomica delle copie ordinate di sessione.
- [x] Collegare l’avanzamento atomico dopo il reveal.
- [x] Mostrare la prima domanda e le quattro risposte nell'ordine congelato.
- [x] Implementare `submit_vote` con modifica consentita solo in `voting_open`.
- [x] Incrementare `voted_count` soltanto al primo voto.
- [x] Recuperare dopo refresh esclusivamente la scelta del partecipante corrente.
- [x] Mostrare sul display solo `voted_count / participant_count` come dato sui voti.

Verifica: nessun client pubblico ottiene soluzione, distribuzione o associazione giocatore-risposta.

### 9. Chiusura e reveal separati

- [x] Collegare i comandi host `close` e `reveal` come transizioni distinte.
- [x] Bloccare ogni voto dopo `close`, anche tramite chiamata manuale.
- [x] Integrare scoring idempotente nel comando di conferma successivo al reveal.
- [x] Dopo il reveal evidenziare la soluzione e mostrare gli avatar vicino alle risposte scelte.
- [x] Mostrare l’esito personale con punti della domanda e totale.
- [x] Mostrare classifica provvisoria.

Verifica: doppio reveal non duplica punti; le associazioni avatar-risposta diventano disponibili soltanto in `answer_revealed`.

### 10. Ciclo completo e fine

- [x] Passare alla domanda seguente azzerando solo il contatore corrente.
- [x] Conservare punteggi cumulativi e ordine di sessione.
- [x] Abilitare `finished` solo dopo il reveal dell'ultima domanda.
- [x] Mostrare la classifica finale su display e telefoni.

Verifica: la sessione completa non richiede interventi manuali sul database.

## 6 agosto — Sicurezza, collaudo e deploy

Obiettivo: provare il flusso reale, correggere difetti bloccanti e congelare la release.

### 11. UX essenziale

- [x] Ottimizzare `/play` per touch e schermi da 320 px con tema dark.
- [x] Ottimizzare `/display` per distanza e 16:9, inclusi gruppi di avatar leggibili.
- [x] Mostrare un QR locale ad alto contrasto su display e host soltanto durante la lobby.
- [x] Distinguere pending, voto salvato, voto chiuso e offline.
- [x] Mostrare pallini voto anonimi e responsive sul display.
- [x] Mostrare podio competition-ranking e commento personale deterministico.
- [ ] Rispettare `prefers-reduced-motion` nel reveal.
- [ ] Confermare la chiusura host se non tutti hanno votato.

Verifica: testi reali, quattro risposte e avatar non causano tagli bloccanti.

### 11a. Media strutturati

- [x] Configurare il bucket `quiz-media` pubblico in lettura e server-write.
- [x] Aggiungere metadati e constraint media a sorgente e snapshot.
- [x] Congelare i media in `start_game_session` ed esporre solo la domanda corrente.
- [x] Rendere immagini e fallback responsive su play, display e host.
- [x] Aggiungere `/host/content` per upload, sostituzione e rimozione protetti.
- [x] Fornire asset demo generati localmente e procedura di upload.

Verifica: contenuti solo testo, solo immagine e misti attraversano voto e reveal
senza layout shift bloccanti o scritture Storage dal browser pubblico.

### 12. Test di dominio e sicurezza

- [ ] Provare configurazioni con conteggi negativi, zero totale o richieste oltre disponibilità.
- [ ] Provare capienza mancante, non positiva e join concorrenti sull'ultimo posto.
- [ ] Modificare un contenuto sorgente in ambiente di test e verificare che la sessione resti invariata.
- [ ] Tentare lettura di soluzioni e risposte altrui prima del reveal.
- [ ] Tentare voto su sessione, domanda o opzione errata e fuori fase.
- [ ] Provare `reveal` e `advance` concorrenti e verificare i log.

Verifica: gli input non validi falliscono senza dati parziali, leak o punteggi duplicati.

### 13. Collaudo multi-browser

- [ ] Usare host, display e almeno tre sessioni partecipante separate.
- [ ] Giocare almeno due sessioni consecutive con configurazioni diverse.
- [ ] Provare refresh in ogni fase e interruzione temporanea della rete.
- [ ] Lasciare un partecipante senza voto e chiudere manualmente.
- [ ] Verificare gli avatar su opzioni corrette e sbagliate dopo il reveal.
- [ ] Provare il numero massimo realistico scelto per l'evento, senza introdurre un default nel prodotto.

Verifica: entrambe le sessioni arrivano a una classifica finale stabile sul deploy di preview.

### 14. Deploy e congelamento

- [ ] Configurare le variabili segrete in Vercel.
- [ ] Applicare migrazioni e seed all'ambiente definitivo.
- [ ] Eseguire lint, typecheck, build e deploy di produzione.
- [ ] Provare rete, dispositivi, host e display dell'evento.
- [ ] Annotare una procedura breve di avvio e recupero pagina.
- [ ] Congelare le funzionalità e correggere solo bug bloccanti.

Verifica: URL, accesso host, quiz seed, sessione, reveal e classifica funzionano nell'ambiente definitivo.

## Ordine di priorità in caso di ritardo

Non si tagliano snapshot di sessione, RLS, capienza atomica, fasi separate, privacy pre-reveal, scoring idempotente o recovery di base. Si riducono nell'ordine:

1. animazione, sostituita da una transizione CSS semplice;
2. elenco completo dei partecipanti nel pannello host;
3. styling decorativo degli avatar, mantenendone identità e posizione;
4. rifiniture estetiche non necessarie alla leggibilità;
5. test di carico oltre il numero realistico dell'evento.

## Matrice minima di collaudo

| Scenario | Risultato atteso |
| --- | --- |
| Preset richiede più domande di quelle disponibili | Creazione rifiutata senza sessione parziale |
| Quiz sorgente diventa insufficiente prima dell'avvio | Avvio rifiutato senza snapshot parziale |
| Quiz sorgente cambia dopo l'avvio | Contenuti e ordine della sessione non cambiano |
| Capienza non inserita | Creazione bloccata; nessun valore implicito |
| Due join concorrenti sull'ultimo posto | Entra un solo nuovo partecipante |
| Due utenti scelgono lo stesso nickname | Il secondo riceve un errore chiaro |
| Stesso utente invia due opzioni | Una risposta; contatore incrementato una volta |
| Host chiude mentre arriva un voto | Un solo esito transazionale valido |
| Accesso ai risultati prima del reveal | Nessuna soluzione o associazione avatar-risposta |
| Host rivela due volte | Seconda chiamata senza effetti; punti invariati |
| Reveal valido | Soluzione e avatar appaiono sulle opzioni scelte |
| Refresh o reconnessione | Fase, scelta personale e punteggio vengono ripristinati |
| Fine ultima domanda | Nessun altro voto; classifica finale stabile |

## Definizione di completamento

L'MVP è pronto quando soddisfa tutti i criteri di `docs/requirements.md`, passa lint/typecheck/build, completa la matrice sul deploy reale e non contiene segreti. Qualsiasi editor, marketplace, gestione utenti o creazione pubblica resta lavoro successivo al 6 agosto.
