# Roadmap MVP — tre giorni

## Principio di esecuzione

La priorità è completare un flusso verticale funzionante prima di rifinire l'aspetto. Ogni attività deve lasciare il progetto in uno stato verificabile. Funzionalità fuori scope non entrano nei tre giorni finché i criteri end-to-end non sono soddisfatti.

## Decisioni da confermare prima dello sviluppo

Queste decisioni influenzano schema, UX o collaudo e vanno chiuse prima di implementare le parti indicate.

| # | Decisione indispensabile | Baseline consigliata | Impatto se diversa |
| --- | --- | --- | --- |
| D1 | Quanti partecipanti simultanei sono attesi? | 30 attesi, limite 50 | Determina test di carico, capienza e affidabilità richiesta |
| D2 | Quante domande e quante opzioni? Il contenuto è definitivo? | 8–12 domande, 2–6 opzioni, una corretta | Serve per seed, layout mobile e durata prova |
| D3 | Come si assegnano punti e si gestiscono i pari merito? | 100/0, nessun speed bonus, pari merito | Cambia transazione di scoring e classifica |
| D4 | Host e display saranno due finestre dello stesso computer, due monitor o due dispositivi? | Pannello su laptop, display in finestra/monitor separato | Determina il flusso operativo e il test dell'evento |
| D5 | Durante il voto il display mantiene domanda e opzioni? | Sì; l'unico dato sui voti è il conteggio aggregato | Se “soltanto il conteggio” è letterale, cambia il layout principale |
| D6 | Si può cambiare risposta prima della chiusura? | Sì | Cambia RPC, testi di conferma e test del contatore |
| D7 | Sono ammessi ingressi dopo l'avvio? | No; solo riconnessione di chi era già entrato | Late join richiede regole per denominatore e domande perse |
| D8 | Il deploy può essere protetto da una sola password host condivisa? | Sì, segreto in Vercel e cookie firmato | Account multipli aumentano notevolmente lo scope |

È inoltre necessario ricevere entro il primo giorno titolo, domande, opzioni e soluzioni definitive. Correzioni ai testi restano possibili prima dell'evento, ma il quiz non deve cambiare mentre una stanza è attiva.

## Giorno 1 — Fondamenta e primo collegamento

Obiettivo: un partecipante entra in una stanza reale e tutte le superfici leggono lo stesso stato Supabase.

### 1. Confermare la baseline

- [ ] Chiudere D1–D8 o accettare esplicitamente i default.
- [ ] Raccogliere il quiz definitivo in formato strutturato.
- [ ] Definire URL/progetto Vercel e progetto Supabase da usare.

Verifica: nessuna regola di dominio necessaria resta ambigua.

### 2. Creare lo scaffold minimo

- [ ] Inizializzare Next.js App Router con TypeScript e Tailwind.
- [ ] Abilitare TypeScript strict e mantenere le dipendenze iniziali minime.
- [ ] Aggiungere `.env.example` senza valori segreti.
- [ ] Definire script reali per dev, lint, typecheck e build.

Verifica: home placeholder, lint, typecheck e build funzionano.

### 3. Configurare Supabase

- [ ] Creare progetto e variabili locali.
- [ ] Abilitare Auth anonimo.
- [ ] Creare una migrazione con enum, tabelle, vincoli e indici.
- [ ] Attivare RLS su ogni tabella.
- [ ] Aggiungere policy minime e revocare scritture dirette non necessarie.
- [ ] Abilitare Realtime soltanto sulle tabelle richieste.

Verifica: con la chiave anonima non si può leggere `question_solutions` né voti altrui.

### 4. Caricare e validare il quiz

- [ ] Creare un seed idempotente con quiz, domande, opzioni e soluzioni.
- [ ] Validare posizioni univoche, almeno due opzioni e una soluzione per domanda.
- [ ] Documentare come rieseguire il seed in ambiente di sviluppo.

Verifica: il quiz completo è interrogabile senza esporre le soluzioni pubblicamente.

### 5. Implementare il dominio database

- [ ] Creare `join_room` con normalizzazione, capienza e idempotenza.
- [ ] Creare `submit_answer` con controlli di fase e coerenza.
- [ ] Creare la funzione di transizione host con macchina a stati.
- [ ] Rendere atomici contatori e scoring.
- [ ] Testare manualmente casi validi e rifiuti direttamente contro Supabase.

Verifica: concorrenza e retry non producono doppi partecipanti, doppi voti o doppi punti.

### 6. Costruire ingresso e lobby

- [ ] Implementare client Supabase browser/server con confini chiari.
- [ ] Creare `/` con codice e nickname, mobile-first.
- [ ] Creare o recuperare la sessione anonima.
- [ ] Collegare `join_room` e navigare a `/play/[code]`.
- [ ] Mostrare attesa e messaggi per gli errori previsti.

Verifica: due sessioni browser entrano, un refresh non duplica il partecipante e un nickname duplicato viene rifiutato.

## Giorno 2 — Motore completo della partita

Obiettivo: giocare tutte le domande dall'inizio alla classifica finale, anche con UI essenziale.

### 7. Proteggere e creare la stanza host

- [ ] Implementare login host con password ambiente e cookie firmato.
- [ ] Creare `POST /api/host/rooms`.
- [ ] Implementare `/host` con selezione quiz e creazione stanza.
- [ ] Impedire l'uso degli endpoint host senza sessione valida.

Verifica: una sessione non autenticata riceve `401`; l'host crea una stanza in lobby.

### 8. Creare le tre superfici live

- [ ] Creare `/host/[code]` con fase, conteggi e singolo comando valido.
- [ ] Creare `/display/[code]` read-only.
- [ ] Completare gli stati di `/play/[code]`.
- [ ] Implementare snapshot iniziale e tipi condivisi.

Verifica: tutte le superfici rendono correttamente lobby e stanza inesistente.

### 9. Collegare Realtime e recovery

- [ ] Sottoscrivere la riga `rooms` filtrata.
- [ ] Rifare lo snapshot su reconnessione e ritorno online.
- [ ] Gestire loading, offline ed errore del canale.
- [ ] Verificare che un evento perso non lasci una pagina in una fase obsoleta.

Verifica: host, display e telefoni cambiano fase senza refresh; dopo refresh tornano allo stato corretto.

### 10. Completare apertura e voto

- [ ] Collegare `start`/`next` alla domanda corretta.
- [ ] Rendere opzioni e selezione sul telefono.
- [ ] Collegare `submit_answer` con stato pending/success/error.
- [ ] Aggiornare il contatore solo al primo voto.
- [ ] Impedire scritture dopo chiusura anche con chiamata manuale.

Verifica: modifica risposta, doppio tap e due schede dello stesso partecipante rispettano i vincoli.

### 11. Completare chiusura, rivelazione e scoring

- [ ] Collegare i comandi `close` e `reveal` separati.
- [ ] Implementare endpoint risultati con controllo fase.
- [ ] Evidenziare la risposta corretta dopo la rivelazione.
- [ ] Mostrare esito personale, punti, aggregati e classifica.
- [ ] Verificare idempotenza su retry/doppio click.

Verifica: prima di `reveal` nessuna richiesta pubblica ottiene soluzione o distribuzione; dopo `reveal` i punteggi sono corretti una sola volta.

### 12. Completare ciclo e fine partita

- [ ] Passare alla domanda seguente azzerando solo i voti correnti.
- [ ] Conservare punteggi cumulativi.
- [ ] Riconoscere l'ultima domanda e abilitare `finish`.
- [ ] Mostrare la classifica finale su display e telefoni.

Verifica: l'intero quiz può essere giocato senza interventi sul database.

## Giorno 3 — Robustezza, UX e deploy

Obiettivo: provare il flusso reale, correggere difetti bloccanti e congelare una release utilizzabile all'evento.

### 13. Rifinire l'interfaccia essenziale

- [ ] Ottimizzare `/play` per touch e schermi da 320 px.
- [ ] Ottimizzare `/display` per distanza e 16:9.
- [ ] Aggiungere animazione breve con fallback `prefers-reduced-motion`.
- [ ] Rendere distinti pending, voto salvato, voto chiuso e offline.
- [ ] Aggiungere conferma host quando chiude prima di `voted_count === participant_count`.

Verifica: nessun testo importante viene tagliato con i contenuti reali.

### 14. Eseguire test di sicurezza e dominio

- [ ] Provare accesso host senza cookie e cookie alterato/scaduto.
- [ ] Tentare lettura soluzione e risposte altrui con chiave anonima.
- [ ] Tentare voto su stanza/domanda/opzione errata e fuori fase.
- [ ] Provare doppio reveal e next concorrenti.
- [ ] Verificare che i log non contengano segreti o risposte individuali.

Verifica: tutti i tentativi non validi falliscono senza corrompere lo stato.

### 15. Eseguire collaudo multi-dispositivo

- [ ] Usare host, display e almeno 3–5 telefoni/sessioni separate.
- [ ] Simulare il limite di partecipanti concordato, se possibile con browser automatizzati o sessioni controllate senza introdurre dipendenze permanenti.
- [ ] Provare refresh in ogni fase.
- [ ] Spegnere e ripristinare la rete di un partecipante.
- [ ] Lasciare un partecipante senza voto e chiudere manualmente.
- [ ] Giocare tutte le domande fino alla classifica finale.

Verifica: completare due partite consecutive sul deploy di preview senza interventi manuali sui dati.

### 16. Pubblicare e preparare l'evento

- [ ] Configurare le variabili segrete in Vercel.
- [ ] Applicare migrazioni e seed all'ambiente definitivo.
- [ ] Eseguire build di produzione e deploy.
- [ ] Provare il deploy sulla rete e sui dispositivi dell'evento.
- [ ] Annotare una procedura operativa breve per avvio, display e recupero pagina.
- [ ] Congelare le funzionalità e correggere soltanto bug bloccanti.

Verifica: URL, password host, quiz e classifica finale funzionano nell'ambiente definitivo.

## Ordine di priorità in caso di ritardo

Non si tagliano integrità, RLS, comandi separati o recovery di base. Le rifiniture si riducono in questo ordine:

1. animazione ridotta a una transizione CSS semplice;
2. distribuzione grafica sostituita da conteggi testuali;
3. elenco nickname nel pannello host omesso;
4. styling decorativo ridotto;
5. test di carico limitato al numero realistico confermato.

Il flusso join → voto → chiusura → rivelazione → punti → domanda successiva → classifica finale resta sempre completo.

## Matrice minima di collaudo

| Scenario | Risultato atteso |
| --- | --- |
| Due utenti scelgono lo stesso nickname | Il secondo riceve errore chiaro |
| Stesso utente invia due opzioni | Una risposta; contatore incrementato una volta |
| Voto arriva mentre l'host chiude | La transazione determina un solo esito valido, senza conteggi incoerenti |
| Host rivela due volte | Seconda chiamata rifiutata; punti invariati |
| Partecipante ricarica in `voting_open` | Ritrova stanza e propria scelta |
| Partecipante ricarica dopo reveal | Vede esito e totale corretti |
| Realtime viene interrotto | Stato offline visibile; snapshot corretto alla ripresa |
| Non tutti votano | Host può chiudere e i mancanti ricevono zero |
| Accesso a risultati prima del reveal | Nessuna soluzione o distribuzione restituita |
| Fine ultima domanda | Nessun ulteriore voto; classifica finale stabile |

## Definizione di completamento dell'MVP

Il progetto è pronto quando soddisfa tutti i criteri di accettazione di `docs/requirements.md`, passa lint/typecheck/build, completa la matrice sopra sul deploy reale e non contiene segreti nel repository. Tutto il resto viene registrato come lavoro successivo all'evento.
