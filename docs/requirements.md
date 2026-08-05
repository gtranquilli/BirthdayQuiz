# Quiz Engine — requisiti dell'MVP

## 1. Obiettivo e scadenza

Realizzare entro il 6 agosto 2026 un Quiz Engine multiplayer riutilizzabile per partite dal vivo. Un host controlla la sessione, un display separato presenta il gioco e i partecipanti rispondono dal browser dello smartphone senza installazione né account email.

Il compleanno di Giorgio è il primo quiz configurato, non una specializzazione della logica applicativa. Nuovi quiz caricati in futuro dovranno usare lo stesso modello di contenuti e lo stesso flusso, senza modifiche al motore.

## 2. Utenti e superfici

### Host

Accede con la password condivisa dell'MVP, sceglie quiz e preset, adatta la configurazione, indica il numero massimo di giocatori, crea la sessione e controlla le transizioni. Usa `/host` e `/host/[code]`.

### Partecipante

Entra con codice e nickname, riceve un avatar di gioco, vota da smartphone e vede conferma, rivelazione, punti e classifica. Usa `/` e `/play/[code]`. Il browser riceve una sessione Supabase anonima; non è richiesta un'email.

### Pubblico

Guarda `/display/[code]` sullo schermo principale. La pagina è read-only e non contiene controlli host.

## 3. Modello di contenuto

```text
Quiz
└── Categorie
    └── Domande
        └── Risposte
```

- Un quiz è un contenitore riutilizzabile con una o più categorie.
- Ogni domanda appartiene a una sola categoria.
- Ogni domanda ha esattamente quattro risposte nell'MVP.
- Ogni domanda ha esattamente una risposta corretta.
- Ogni domanda ha un punteggio intero positivo configurabile nei dati caricati.
- Quiz, categorie, domande, risposte, soluzioni e preset sono caricati tramite seed prima dell'evento.
- L'MVP non comprende un editor o un flusso pubblico di creazione dei contenuti.

## 4. Preset e configurazione della sessione

Un preset definisce quanti quesiti estrarre da ciascuna categoria di un quiz. Per esempio, “Compleanno classico” può richiedere cinque domande serie, cinque divertenti e cinque impossibili.

Prima di creare la sessione, l'host può modificare i conteggi per categoria proposti dal preset. La modifica vale soltanto per la nuova sessione e non altera il preset salvato né il quiz sorgente. Il sistema valida che:

- ogni conteggio sia un intero non negativo;
- sia selezionata almeno una domanda complessiva;
- per ogni categoria siano disponibili abbastanza domande;
- preset e categorie appartengano al quiz selezionato.

Alla creazione, il sistema salva la configurazione effettiva per categoria. All'avvio, estrae le domande in base a tale configurazione e ne congela contenuto, risposte, soluzione, punteggio e ordine nella sessione.

## 5. Sessione di gioco

La sessione è distinta dal quiz sorgente e contiene almeno:

- quiz scelto;
- preset di partenza, se usato, e configurazione effettiva per categoria;
- numero massimo di giocatori;
- domande effettivamente estratte;
- ordine definitivo delle domande e delle quattro risposte;
- fase corrente, domanda corrente, conteggi e timestamp operativi.

Una modifica successiva a quiz, categorie, domande, risposte o preset non deve cambiare una sessione già avviata. Nell'MVP la configurazione non è modificabile dopo la creazione della sessione; se i contenuti diventano insufficienti prima dell'avvio, l'avvio fallisce senza snapshot parziali.

## 6. Requisiti funzionali

### RF-01 — Accesso host

- `/host` richiede una password condivisa configurata nell'ambiente di deploy.
- Il server imposta una sessione host firmata, `HttpOnly`, `Secure` in produzione e `SameSite=Lax`.
- Non è richiesta una gestione completa degli account host nell'MVP.

### RF-02 — Configurazione e creazione sessione

- L'host seleziona uno dei quiz caricati tramite seed e un relativo preset.
- Può modificare i conteggi per categoria prima della creazione.
- Deve compilare “Numero massimo giocatori” con un intero positivo. Il campo non ha un valore predefinito.
- Prima della creazione, il sistema chiede conferma con il valore inserito, per esempio: “Creare una partita con massimo 7 giocatori?”.
- Solo dopo la conferma il sistema valida e salva la configurazione e genera un codice breve, casuale e univoco, consigliato di sei caratteri non ambigui.
- La sessione parte in `lobby`; il pannello mostra codice, URL del display, capienza e conteggio partecipanti.

### RF-03 — Ingresso partecipante

- Il partecipante inserisce codice e nickname dalla home.
- Il sistema normalizza il codice, valida nickname, fase e capienza e impedisce duplicati.
- Il nickname è lungo 2–20 caratteri ed è univoco nella sessione senza distinzione tra maiuscole e minuscole.
- Al primo ingresso crea una sessione Supabase anonima e un partecipante associato ad `auth.uid()`.
- Il partecipante riceve un `avatar_key` da un set predefinito; non sono previsti upload o editor avatar.
- Nickname e avatar sono entrambi univoci all'interno della sessione.
- Un refresh sullo stesso browser ripristina partecipazione e avatar.
- Raggiunto il massimo configurato dall'host, nuovi ingressi vengono rifiutati con un messaggio comprensibile.

### RF-04 — Lobby

- Il display mostra titolo del quiz, codice sessione e numero di partecipanti.
- Il telefono conferma l'ingresso e resta in attesa.
- L'host vede conteggio e capienza; può vedere l'elenco dei partecipanti con avatar.
- Durante la lobby l'host può rimuovere un partecipante o annullare definitivamente la stanza.
- Rimozione e annullamento sono operazioni atomiche server-side e non sono più consentiti dopo l'avvio.
- Nuovi ingressi sono ammessi soltanto in `lobby`; chi è già registrato può riconnettersi.
- Soltanto l'host può avviare la prima domanda.

### RF-05 — Apertura domanda

- L'avvio è consentito soltanto dalla `lobby` e richiede almeno un partecipante.
- L'azione host estrae e congela atomicamente domande, quattro opzioni, soluzioni, punteggi e ordine deterministico della sessione, imposta l'indice corrente a zero e porta la sessione in `voting_open`.
- Se le domande disponibili non rispettano la configurazione, l'operazione fallisce interamente con un errore comprensibile.
- Display e telefoni mostrano testo e quattro risposte nell'ordine memorizzato nella sessione.
- Il contatore dei voti parte da zero. Non è previsto un timer.

### RF-06 — Voto

- Ogni partecipante può avere al massimo una risposta per la domanda corrente.
- Può cambiare scelta finché la fase è `voting_open`; la modifica non incrementa nuovamente il conteggio.
- La UI conferma il salvataggio soltanto dopo la risposta positiva del database.
- Un refresh recupera tramite identità anonima soltanto l'opzione scelta dal partecipante corrente.
- Nessun voto è accettato per un'altra domanda o fuori da `voting_open`.
- Host e display mostrano `voted_count / participant_count`.
- Il raggiungimento del totale non chiude automaticamente la votazione.

### RF-07 — Anonimato prima della rivelazione

- Durante `voting_open` e `voting_closed`, il display mostra domanda, quattro risposte e solo il numero aggregato di giocatori che hanno votato.
- Prima di `answer_revealed` non mostra avatar associati alle risposte, nickname, scelte individuali, distribuzione, percentuali, conteggi per risposta o correttezza.
- Un partecipante può leggere soltanto la propria scelta; host e client pubblici non ricevono la relazione giocatore-risposta.
- La lettura personale passa da una RPC legata a `auth.uid()`; la tabella `votes` non concede lettura diretta ai client.
- La relazione viene conservata nel database con accesso ristretto per rivelazione e scoring.

### RF-08 — Chiusura voto

- L'host passa esplicitamente da `voting_open` a `voting_closed`.
- I controlli si disabilitano dopo l'aggiornamento Realtime e ogni tentativo tardivo viene comunque rifiutato dal database.
- Domanda e risposte restano visibili, ma soluzione e scelte altrui rimangono nascoste.
- Retry e doppio click non cambiano nuovamente lo stato né assegnano punti.
- La chiusura e il reveal restano azioni host distinte; un voto concorrente è serializzato sullo stesso lock della sessione.

### RF-09 — Rivelazione stile Among Us e scoring

- Un secondo comando host passa da `voting_closed` ad `answer_revealed`.
- La stessa operazione valuta le risposte, assegna una sola volta il punteggio configurato della domanda e aggiorna i totali.
- Il display evidenzia la risposta corretta e dispone vicino a ciascuna risposta gli avatar dei giocatori che l'hanno scelta.
- Chi non risponde non viene associato a un'opzione e riceve zero punti.
- Il telefono mostra risposta corretta, correttezza della propria scelta, punti ottenuti e totale.
- La classifica può essere mostrata dopo la rivelazione; non è richiesta una visualizzazione statistica separata oltre agli avatar.
- La prima implementazione del reveal pubblica soluzione, distribuzione e non votanti senza assegnare ancora punti; scoring e classifica restano una tranche successiva.

### RF-10 — Domanda successiva

- Dopo la rivelazione l'host può aprire la domanda successiva congelata.
- Il sistema aggiorna la domanda corrente, azzera `voted_count` e torna a `voting_open` in un'unica operazione.
- I punteggi cumulativi restano invariati fino alla rivelazione successiva.

### RF-11 — Fine partita

- Dopo l'ultima rivelazione, l'host conclude la sessione.
- La fase diventa `finished` e display e telefoni mostrano la classifica finale.
- In caso di pari punteggio i partecipanti condividono il piazzamento; l'ordine visuale stabile usa poi l'orario di ingresso.
- Non sono accettati altri voti o ingressi.

### RF-12 — Ripristino e Realtime

- Ogni interfaccia recupera uno snapshot iniziale e poi ascolta gli aggiornamenti Realtime.
- Dopo refresh o riconnessione, ricostruisce fase, domanda, propria risposta e punteggio senza dipendere da eventi persi.
- Se perde la connessione, segnala lo stato e non presenta come salvato un voto non confermato.
- L'host può chiudere manualmente anche se un partecipante è disconnesso.

## 7. Macchina a stati

| Fase | Display | Partecipante | Azione host valida |
| --- | --- | --- | --- |
| `lobby` | Codice e totale iscritti | Attesa | Avvia prima domanda |
| `voting_open` | Domanda, quattro risposte, solo conteggio aggregato | Può votare o modificare | Chiudi voto |
| `voting_closed` | Domanda, risposte e conteggio finale; nessuna soluzione | Voto bloccato | Rivela risposta |
| `answer_revealed` | Soluzione, avatar sulle risposte e classifica | Esito e punti | Prossima domanda o termina |
| `finished` | Classifica finale | Classifica finale | Nessuna nell'MVP |

Transizioni consentite:

```text
lobby -> voting_open -> voting_closed -> answer_revealed
             ^                                 |
             +---------- domanda seguente -----+
                                               |
                                               +-> finished
```

Non sono consentiti salti di fase, riapertura del voto o ritorno a una domanda precedente.

## 8. Requisiti non funzionali

### RNF-01 — Compatibilità e UX

- Browser mobile moderni su iOS e Android; browser desktop moderno per host e display.
- Layout partecipante da 320 px e display leggibile a distanza in formato 16:9.
- Target touch adeguati, focus visibile e corretto/errato non comunicati dal solo colore.
- Animazioni compatibili con `prefers-reduced-motion`.

### RNF-02 — Prestazioni e capienza

- La capienza è un dato obbligatorio della sessione, non un default globale.
- Il database impedisce atomicamente di superare il massimo impostato dall'host.
- Feedback di voto normalmente entro un secondo e cambi di fase entro due secondi su connessione stabile.
- Evitare polling aggressivo; usare snapshot su connessione e ripresa.

### RNF-03 — Integrità

- Vincoli univoci impediscono partecipanti duplicati, voti doppi e posizioni duplicate.
- Creazione della sessione, estrazione, transizioni e scoring sono atomici dove necessario.
- Reveal e scoring sono idempotenti.
- Il client non determina mai punteggi, soluzione o correttezza autorevoli.

### RNF-04 — Sicurezza e privacy

- Tutte le tabelle esposte hanno RLS attiva.
- Soluzioni e relazioni giocatore-risposta non sono leggibili pubblicamente prima di `answer_revealed`.
- Dopo la rivelazione, un endpoint controllato restituisce soltanto i dati necessari a collocare gli avatar sulle risposte della domanda corrente.
- La `service_role` è esclusivamente server-side.
- Il codice sessione non è un segreto forte; nickname, avatar e punteggi sono dati di gioco a bassa sensibilità.
- Nessun log contiene password, chiavi, token, cookie o risposte individuali.

### RNF-05 — Operatività

- Configurazione tramite variabili Vercel/Supabase, senza segreti nel repository.
- Migrazioni e seed sono versionati e ripetibili.
- Build di produzione e prova multi-sessione browser completate prima dell'evento.

## 9. Fuori scope

- Editor completo di quiz, categorie, domande, risposte o preset.
- Marketplace, condivisione o creazione pubblica di quiz.
- Registrazione email, social login, profili persistenti o gestione utenti.
- Più host con ruoli diversi.
- Risposte multiple corrette, testo libero o sondaggi.
- Timer, speed bonus, streak, penalità o power-up.
- Squadre, chat, reazioni, audio, video o media nelle domande.
- Upload e personalizzazione avanzata degli avatar.
- Moderazione avanzata, late join, cambio nickname e Presence autorevole.
- Pausa, riapertura voto, rollback o modifica punteggi.
- Storico, analytics, export, replay e supporto offline completo.

## 10. Criteri di accettazione end-to-end

L'MVP è accettato quando, sul deploy Vercel collegato a Supabase:

1. almeno il quiz “Compleanno di Giorgio”, le sue categorie e un preset sono disponibili da seed;
2. ogni domanda selezionabile ha quattro risposte, una soluzione e un punteggio configurato;
3. l'host sceglie quiz e preset, modifica i conteggi e non può richiedere più domande di quelle disponibili;
4. “Numero massimo giocatori” parte vuoto, accetta un intero positivo e compare nella conferma prima della creazione;
5. all'avvio la sessione congela configurazione, domande estratte e ordine; modificare poi i contenuti sorgente non ne cambia lo snapshot;
6. il sistema non supera la capienza scelta e un refresh non duplica il partecipante;
7. host, display e almeno due partecipanti completano lobby, voto, chiusura, rivelazione, domanda successiva e fine;
8. prima del reveal nessun payload pubblico espone soluzione, distribuzione o relazione giocatore-risposta;
9. ogni primo voto incrementa il contatore una volta e una modifica non lo incrementa;
10. dopo la chiusura nessun voto nuovo o modificato viene accettato;
11. soltanto il reveal assegna i punti una volta, evidenzia la risposta corretta e mostra gli avatar accanto alle risposte scelte;
12. refresh e breve disconnessione ricostruiscono lo stato senza duplicazioni;
13. l'ultima domanda porta a una classifica finale stabile;
14. lint, typecheck e build di produzione terminano con successo.
