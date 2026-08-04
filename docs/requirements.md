# Requisiti dell'MVP

## 1. Obiettivo

Realizzare in tre giorni una web app affidabile per condurre dal vivo un singolo quiz di compleanno con più domande. Tutti i telefoni accedono via browser e non richiedono installazione. L'esperienza deve privilegiare chiarezza, controllo del presentatore e prevenzione delle rivelazioni premature.

## 2. Utenti e superfici

### Presentatore

Prepara il quiz prima dell'evento, crea la stanza, osserva i conteggi e decide quando chiudere, rivelare e avanzare. Usa `/host` e `/host/[code]`.

### Partecipante

Entra con codice e nickname, vota da smartphone e vede conferma, risposta corretta, punti e classifica. Usa `/` e `/play/[code]`. Non crea un account email: il browser riceve una sessione Supabase anonima.

### Pubblico

Guarda `/display/[code]` sullo schermo principale. Questa pagina non contiene controlli host.

## 3. Baseline funzionale proposta

Le decisioni seguenti rendono realizzabile l'MVP nel tempo disponibile. Sono assunzioni da confermare prima dell'implementazione:

- un solo quiz pre-caricato, consigliati 8–12 quesiti;
- 2–6 opzioni testuali per domanda, una sola corretta;
- 100 punti per risposta corretta, 0 per risposta errata o mancante;
- nessun bonus legato alla velocità;
- possibilità di cambiare risposta finché il voto è aperto;
- nuovi ingressi ammessi soltanto in lobby; un partecipante già registrato può riconnettersi;
- capienza obiettivo 30 partecipanti, limite applicativo consigliato 50;
- nessun passaggio automatico: l'host controlla chiusura, rivelazione e domanda successiva;
- nickname univoci nella stanza senza distinzione tra maiuscole e minuscole, lunghi 2–20 caratteri;
- in caso di parità in classifica, stesso piazzamento; per la visualizzazione stabile si ordina poi per orario di ingresso.

## 4. Requisiti funzionali

### RF-01 — Accesso host

- `/host` richiede una password condivisa configurata nell'ambiente di deploy.
- Dopo l'accesso, il server imposta una sessione host firmata, `HttpOnly`, `Secure` in produzione e `SameSite=Lax`.
- Non è richiesta una gestione completa degli account host nell'MVP.

### RF-02 — Creazione stanza

- L'host seleziona il quiz pre-caricato e crea una nuova stanza.
- Il sistema genera un codice breve, casuale e univoco, consigliato di 6 caratteri non ambigui.
- La stanza parte in fase `lobby`.
- Il pannello mostra codice, URL del display e conteggio partecipanti.

### RF-03 — Ingresso partecipante

- Il partecipante inserisce codice e nickname dalla home.
- Il sistema normalizza il codice, valida nickname e fase della stanza e impedisce duplicati.
- Al primo ingresso viene creata una sessione Supabase anonima e una riga `participants` associata all'identità `auth.uid()`.
- Un refresh sullo stesso browser ripristina la partecipazione.
- Codice inesistente, stanza non in lobby, nickname non valido o capienza raggiunta producono messaggi comprensibili.

### RF-04 — Lobby

- Il display mostra titolo, codice stanza e numero di partecipanti, ma non è obbligato a mostrare i nickname.
- Il telefono conferma l'ingresso e resta in attesa.
- L'host vede almeno il conteggio; l'elenco dei nickname nel pannello privato è utile ma non essenziale.
- Soltanto l'host può avviare la prima domanda.

### RF-05 — Apertura domanda

- L'azione host imposta la domanda corrente e porta la stanza in `voting_open`.
- Display e telefoni mostrano testo della domanda e opzioni nello stesso ordine stabile.
- Il contatore dei voti della domanda parte da zero.
- Non è previsto un timer nell'MVP.

### RF-06 — Voto

- Ogni partecipante può avere al massimo una risposta per la domanda corrente.
- Se cambia scelta durante `voting_open`, la risposta viene aggiornata senza incrementare nuovamente il conteggio.
- La UI mostra la propria selezione e conferma il salvataggio soltanto dopo la risposta positiva del database.
- Nessun voto è accettato per una domanda diversa da quella corrente o quando la fase non è `voting_open`.
- Il sistema mostra all'host e al display `voted_count / participant_count`.
- Raggiungere il totale non chiude automaticamente la votazione: l'host mantiene il controllo.

### RF-07 — Privacy durante il voto

- Sul display la sola informazione derivata dai voti è il conteggio aggregato.
- Durante `voting_open` e `voting_closed`, il display non mostra nickname, scelte individuali, distribuzione, percentuali o indicazioni sulla correttezza.
- Baseline proposta: testo della domanda e opzioni restano visibili. Questo dettaglio deve essere confermato perché la frase “soltanto quante persone hanno votato” può anche essere interpretata come display contenente esclusivamente il contatore.
- Un partecipante può vedere soltanto la propria risposta, non quelle degli altri.

### RF-08 — Chiusura voto

- L'host usa un comando esplicito per passare da `voting_open` a `voting_closed`.
- Tutti i controlli di voto si disabilitano immediatamente dopo l'aggiornamento Realtime o, al più tardi, al successivo tentativo server-side.
- La risposta corretta non viene ancora mostrata.
- Un doppio click o un retry non altera lo stato né assegna punti.

### RF-09 — Rivelazione e scoring

- Un secondo comando host passa da `voting_closed` ad `answer_revealed`.
- La transazione di rivelazione assegna i punti una sola volta e aggiorna i totali.
- Il display evidenzia la risposta corretta con una breve animazione non bloccante, poi mostra distribuzione aggregata e classifica.
- Il telefono mostra risposta corretta, correttezza della propria scelta, punti ottenuti nella domanda e totale.
- I partecipanti senza risposta ricevono zero punti.

### RF-10 — Domanda successiva

- Dopo i risultati l'host può aprire la domanda successiva.
- Il sistema aggiorna la domanda corrente, azzera `voted_count` e torna a `voting_open` in un'unica operazione.
- I punteggi totali restano invariati fino alla rivelazione successiva.

### RF-11 — Fine partita

- Dopo l'ultima rivelazione, l'host conclude la partita.
- La fase diventa `finished` e display e telefoni mostrano la classifica finale.
- Non sono accettati altri voti o ingressi.

### RF-12 — Ripristino e Realtime

- Ogni interfaccia recupera uno snapshot iniziale dal database e poi ascolta gli aggiornamenti Realtime.
- Dopo refresh o riconnessione, la UI ricostruisce domanda, fase, propria risposta e punteggio senza dipendere da eventi persi.
- In caso di perdita della connessione, la UI segnala lo stato e impedisce di presentare come salvato un voto non confermato.
- L'host può sempre chiudere manualmente anche se un partecipante registrato si è disconnesso.

## 5. Macchina a stati

| Fase | Display | Partecipante | Azione host valida |
| --- | --- | --- | --- |
| `lobby` | Codice e totale iscritti | Attesa | Avvia prima domanda |
| `voting_open` | Domanda, opzioni, solo conteggio aggregato | Può votare/modificare | Chiudi voto |
| `voting_closed` | Domanda, opzioni, conteggio finale; nessuna soluzione | Voto bloccato | Rivela risposta |
| `answer_revealed` | Soluzione, risultati aggregati, classifica | Esito e punti | Prossima domanda o termina |
| `finished` | Classifica finale | Classifica finale | Nessuna nell'MVP |

Transizioni consentite:

```text
lobby -> voting_open -> voting_closed -> answer_revealed
                     domanda seguente ^            |
                            voting_open <------------+
                                      oppure finished
```

Non sono consentiti salti di fase, riapertura del voto o ritorno a una domanda precedente nell'MVP.

## 6. Requisiti non funzionali

### RNF-01 — Compatibilità

- Browser mobile moderni su iOS e Android, senza installazione.
- Browser desktop moderno per host e display.
- Layout partecipante utilizzabile a partire da 320 px di larghezza.
- Display leggibile a distanza in formato 16:9.

### RNF-02 — Prestazioni

- Target iniziale: 30 partecipanti simultanei; collaudo fino al limite concordato.
- Feedback di voto immediato dopo conferma server, normalmente entro 1 secondo su una connessione stabile.
- Propagazione dei cambi di fase normalmente entro 2 secondi.
- Evitare query periodiche aggressive; effettuare refetch su connessione/ripresa e come fallback controllato.

### RNF-03 — Integrità

- Vincoli univoci impediscono voti doppi, posizioni duplicate e nickname duplicati.
- Scoring e transizione di rivelazione sono atomici e idempotenti.
- Il client non determina mai autonomamente punteggi o correttezza autorevoli.

### RNF-04 — Sicurezza e privacy

- Tutte le tabelle esposte hanno RLS attiva.
- La soluzione non è leggibile con la chiave pubblica prima della rivelazione.
- Le risposte individuali non sono pubbliche.
- La `service_role` è usata soltanto in codice server-side.
- Il codice stanza non è considerato un segreto forte: nell'MVP nickname e punteggi sono dati pubblici a bassa sensibilità per chi raggiunge la stanza.
- Nessun dato personale oltre a nickname, identificativo anonimo e risposte di gioco.

### RNF-05 — Accessibilità e UX

- I pulsanti hanno target touch adeguati e stati `focus` visibili.
- Colori di corretto/errato sono accompagnati da testo o icone.
- Le animazioni rispettano `prefers-reduced-motion`.
- Le azioni irreversibili host hanno etichette esplicite; la chiusura può richiedere conferma se non tutti hanno votato.

### RNF-06 — Operatività

- Configurazione tramite variabili Vercel/Supabase, senza segreti nel repository.
- Log utili per errori di transizione e database, senza token o risposte individuali.
- Build di produzione verificata prima dell'evento.

## 7. Fuori scope

- Registrazione email, social login o profili persistenti.
- Creazione e modifica quiz tramite UI.
- Più host con ruoli o permessi diversi.
- Più risposte corrette, testo libero o sondaggi.
- Timer, bonus velocità, streak, penalità o power-up.
- Squadre, chat, emoji/reazioni, audio e video.
- QR code generato dall'app, temi avanzati o personalizzazione del branding.
- Espulsione giocatori, cambio nickname, late join e gestione Presence avanzata.
- Pausa, riapertura voto, modifica punteggi e rollback di una domanda.
- Storico, analytics, export o replay delle partite.
- Supporto offline completo e notifiche push.

## 8. Criteri di accettazione end-to-end

L'MVP è accettato quando, su deploy Vercel collegato a Supabase:

1. l'host crea una stanza e apre il display;
2. almeno due browser mobili entrano con nickname distinti senza email;
3. l'host avvia una domanda e i telefoni ricevono le opzioni;
4. ogni primo voto incrementa il contatore una volta e una modifica non lo incrementa;
5. durante il voto il display non rivela identità, distribuzione o correttezza;
6. dopo la chiusura nessun voto nuovo o modificato viene accettato;
7. soltanto la rivelazione mostra la risposta corretta e assegna i punti una volta;
8. risultati e classifica coincidono su host, display e telefoni;
9. la domanda successiva riparte da zero voti conservando i punteggi;
10. refresh e breve disconnessione non fanno perdere stato o duplicano il partecipante;
11. l'ultima domanda porta a una classifica finale stabile;
12. lint, typecheck e build di produzione terminano con successo.
