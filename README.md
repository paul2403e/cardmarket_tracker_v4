# CM Tracker

Markt-Tracker für Sealed-Produkte auf Cardmarket (Pokémon, One Piece, Flesh and Blood): jeden Tag faire Preise,
Bestände und Veränderungen, dazu ein Portfolio mit Kauf- und Verkaufshistorie, eine Watchlist und Preisalarme per Mail.

Website: https://cardmarket-tracker-v4.vercel.app

## Architektur

| Teil | Technik | Inhalt |
|---|---|---|
| Datensammlung | Python auf dem eigenen Windows-Laptop (Heimanschluss) | Katalog, Price Guide, Scrape, faire Preise, Website-Dateien – täglich |
| Code | GitHub (öffentlich) | Quellcode; GitHub Actions **nur für Tests** (kein Scraping) |
| Marktdaten | Cloudflare R2, Bucket `cm-market-data` (privat) | Rohdaten, Preise, Verlauf, fertige Website-Dateien |
| Nutzerdaten | Supabase (Frankfurt) | Konten, Einstellungen, Depots, Transaktionen, Watchlist, Preisalarme |
| Website | Next.js auf Vercel | Markt, Browse, Produktseiten; Konten, Portfolio, Watchlist |

## Ordner

```
scraper/                 Python-Code für die Datensammlung
  config/games/*.yaml    ein Spiel pro Datei: Kategorien, Sprachen, Reihenfolge, Ausschlüsse
  config/pricing.yaml    komplette Preislogik (Filter, Wortlisten, Kappung, Korb)
  config/monitoring.yaml Tempo (pace) und Schwellen der Plausibilitätsprüfung
  cmtracker/             Paket (catalog, scrape, pricing, publish, maintenance, review …)
  tests/                 Tests ohne Netzwerkzugriff (fixtures = echte, anonymisierte Cardmarket-Seiten)
web/                     Website (Next.js)
supabase/migrations/     SQL für die Nutzerdatenbank (einmalig im Supabase-Dashboard ausführen)
docs/Preislogik.md       die Preislogik in verständlichen Worten
AGENTS.md                Übergabe für neue Chats / andere KI: Arbeitsweise, Regeln, Stand, Entscheidungen
CLAUDE.md                verweist auf AGENTS.md (wird von Claude automatisch gelesen)
windows/                 Laptop-Betrieb: setup.ps1 (Einrichtung), cmwin.py (Zeitplan-Lauf, Befehl cm)
server/                  Alternative für einen Linux-Rechner zu Hause (derzeit nicht im Einsatz)
.github/workflows/       Tests bei jeder Code-Änderung
```

## Fortschritt

- [x] **Meilenstein 1 – Katalog & Price Guide:** täglicher Abgleich aller Sealed-Produkte, Tagespreise avg/low/trend
- [x] **Meilenstein 2 – Scraper-Kern:** Login, Produktseiten je Sprache, alle Angebote, Bestandszählung,
      günstigste 50 nach Endpreis und Artikelpreis, Notbremse
- [x] **Meilenstein 3 – Automatik & Überwachung:** Laptop-Lauf mit Zeitplan, Tagesbericht, Warn-Mails,
      Plausibilitätsprüfung, Totmannschalter (healthchecks.io)
- [x] **Meilenstein 4 – Rechenschritt:** faire Preise (Logik 5), Verlauf, Marktindex, Website-Dateien, Prüf-Excel
- [x] **Meilenstein 5 – Website:** Markt (Index, Movers, Supply, Neuheiten), Browse, Produktseiten,
      drei Spiele mit Umschalter
- [x] **Meilenstein 6 – Nutzerbereich**
  - [x] 6a Konten: Registrierung, Anmeldung, Passwort, Einstellungen im Konto, Konto löschen
  - [x] 6b Depots und Transaktionen: Kauf/Verkauf erfassen (auch per + in All products), Bewertung zum fairen
        Preis „nur Artikel“, Gewinn/Verlust nach FIFO, Spiele-Filter zum Ankreuzen
  - [x] 6c Excel: Vorlage mit allen Produkten (Blatt je Spiel + „How to“), Import mit Vorschau und Fehlerliste
        (schon Importiertes wird erkannt), Export von Beständen und Transaktionen
  - [x] 6d Historie je Position: eigene Seite je Produkt + Sprache (Klick in Holdings, Sold completely, Top
        positions, Winners/Losers, Sales) mit Kennzahlen, Aufteilung je Portfolio, Graph Wert/Einstand oder Preis
        pro Stück mit Kauf-/Verkaufspunkten, Transaktionen bearbeiten/löschen
- [x] **Meilenstein 7 – Portfolio-Auswertung:** Reiter Overview / Performance / Analysis / Transactions / Import-Export;
      Performance-Kacheln (7T/30T/6M/1J), Graph in % (einfache Rendite) oder €, Zeiträume inkl. All (vor Trackingbeginn
      linear geschätzt) und Custom, Gewinner/Verlierer, Aufteilung als Kuchen, Top-Positionen, Verkäufe
- [x] **Meilenstein 8 – Watchlist und Preisalarme:** beobachten je Produkt und Sprache (Auge in Browse, „Watch“ auf
      der Produktseite), Alarme für Preis unter/über, Bestand unter/über und Veränderung in % über 1–365 Tage;
      Prüfung auf dem Laptop nach dem Veröffentlichen, eine Sammel-Mail pro Nutzer
- [x] **Feedback-Runde 9:** Performance als einfache Rendite, Preis-Verlässlichkeit in 5 Stufen (+ Übersicht in
      Analysis), „Owned“ in All products und auf der Produktseite, Custom-Zeitraum auf der Produktseite, Stückzahl bei
      Winners/Losers, echte Produktbilder (.png/.jpg aus der Produktseite), Übergabe-Datei `AGENTS.md`;
      danach: Analysis und Winners/Losers fassen Produkte über Portfolios zusammen, Verlässlichkeit sortierbar und
      nach gültigen Angeboten im Korb (Reliable/Fair/Thin/Very thin), daneben Zahl aller Angebote auf Cardmarket, klarere Supabase-Fehler; Preislogik 6 (Lockangebote über alle Länder,
      Korb nach Angeboten) mit Vergleichs-Mail; Portfolio-Kopf mit Zeilen „Portfolio“ und „Games“, Umbenennen/Löschen
      über den Stift am gewählten Portfolio

## Laptop einrichten (Windows, einmalig)

Warum zu Hause: Cardmarket sperrt die großen Cloud-Netze (getestet: Oracle, Google Cloud, Microsoft Azure).
Über den eigenen Internetanschluss kommt der Scraper wie ein normaler Besucher durch.

In **PowerShell** (Startmenü → „PowerShell“, kein Administrator nötig) einfügen:

```
irm https://raw.githubusercontent.com/paul2403e/cardmarket_tracker_v4/main/windows/setup.ps1 | iex
```

Das Skript installiert bei Bedarf Python 3.13 (winget), lädt Scraper und FlareSolverr (Windows-Version mit
eigenem Chrome, kein Docker), fragt einmal die Zugangsdaten ab (verschlüsselt mit dem Windows-Konto in
`%LOCALAPPDATA%\cmtracker\secrets.json`), legt den Zeitplan an, erlaubt Windows das Wecken aus dem
Energiesparmodus (auch auf Akku) und richtet den Befehl `cm` ein. Am Ende: Selbsttest mit Testmail.
Darf jederzeit erneut ausgeführt werden.

| Zugangsdaten | Wofür |
|---|---|
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Speicher für die Marktdaten |
| `CM_USERNAME`, `CM_PASSWORD` | Cardmarket-Login (Versandkosten an die eigene Adresse) |
| `SMTP_USER`, `SMTP_PASS`, `ALERT_EMAIL_TO` | Mails (Gmail-Adresse, Gmail-App-Passwort, Empfänger) |
| `HC_PING_URL` | Totmannschalter healthchecks.io (Ping nach jedem vollständig gescrapten Tag) |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | optional, für Preisalarme: Projekt-URL und **secret key** (`sb_secret_…`, Supabase → Project Settings → API Keys). Nur hier auf dem Laptop eintragen (`cm secrets`) – nie in Vercel, nie in einen Chat. Leer = keine Preisalarme |

### Ablauf auf dem Laptop

| Wann | Was |
|---|---|
| 03:30 | Windows weckt den Laptop (auch zugeklappt und auf Akku): Katalog → Scrape Pokémon → One Piece → Flesh and Blood (zusammen ~4–4,5 Std.) → je Spiel faire Preise, Website-Daten und Preisalarme, sobald **sein** Scrape fertig ist → Laptop darf wieder schlafen |
| Anmelden, Entsperren, Aufwachen | Ist der Tag noch nicht fertig, macht der Lauf dort weiter (im Hintergrund). Ist er fertig, endet er nach Sekunden. Vor 03:30 passiert nichts. |
| 23:55 | Ein laufender Scrape hört spätestens hier auf (Tageswechsel) |

- Während des Laufs bleibt der Laptop wach (Bildschirm darf aus sein); kein Netz → bis zu 15 Min. warten statt Fehler.
- **Tempo:** 0,8–1,6 s Pause pro Abruf (`pace` in `scraper/config/monitoring.yaml`). Zeigt Cardmarket eine Prüfung,
  die FlareSolverr nicht löst: 30 Min. Abkühlpause, neu anmelden, weiter; nach 3 Pausen Notbremse (Mail) und an
  diesem Tag keine automatischen Neustarts mehr (`cm run --now` geht).
- **Beim Login öffnet sich kurz ein Chrome-Fenster** (FlareSolverr). Unter Windows erkennt Cloudflare das
  versteckte Chrome, deshalb läuft es sichtbar; nach dem Login schließt es sich.
- Der Price Guide wird jeden Tag gespeichert (bei Bedarf beim nächsten Start erneut, höchstens alle 2 Std.).
  Preise und Website hängen nicht davon ab.
- Vor jedem Lauf holt sich der Laptop den neuesten Code von `main` – ein gemergter PR ist ab dem nächsten Lauf aktiv
  (ein neues Steuerskript sofort).
- **Mails:** je Spiel ein „Tagesbericht“ mit Kennzahlen (auch wenn alles in Ordnung ist); dazu Warn-Mails bei
  Problemen – dieselbe höchstens einmal pro Tag. Unvollständige oder ausgefallene Tage meldet eine Mail beim
  nächsten Lauf.
- Die Prüf-Excel jedes Laufs liegt in `Dokumente\CM-Tracker\Review` (und 7 Tage in R2 unter `review/`).
- **Nicht zugeklappt in Rucksack oder Tasche lassen** – der Laptop wacht um 03:30 trotzdem auf.

### Bedienung (PowerShell)

| Befehl | Was passiert |
|---|---|
| `cm status` | Stand von heute (Scrape, Preise und Website je Spiel), Zeitplan, letzte Protokollzeilen |
| `cm logs [N]` | letzte N Zeilen des Protokolls (Dateien: `%LOCALAPPDATA%\cmtracker\logs`) |
| `cm run --now` | täglichen Lauf sofort starten (auch vor 03:30); macht nur, was heute noch fehlt |
| `cm stop` | laufenden Lauf anhalten (der nächste Start macht dort weiter) |
| `cm test [N]` | Testlauf mit N Produkten (Standard 20), Ausgabe live |
| `cm secrets` / `cm selftest` / `cm update` | Zugangsdaten ändern / prüfen (Testmail) / Code sofort aktualisieren |
| `cm tool price` | faire Preise neu berechnen (bei geänderter Logik automatisch alle Tage) |
| `cm tool publish` | Website-Dateien neu erzeugen |
| `cm tool price-alerts` | Preisalarme jetzt prüfen (jeder Markttag wird je Alarm nur einmal geprüft) |
| `cm tool price-alerts --check` | nur die Verbindung zu Supabase testen (zeigt bei Fehlern Adresse, Meldung und was zu tun ist) |
| `cm tool categories --game-id N` | Kategorien eines Cardmarket-Spiels mit Anzahl und Beispielen (für neue Spiele) |
| `cm tool cleanup --before JJJJ-MM-TT` | zeigt, welche Scrape-Tage davor gelöscht würden; mit `--yes` am Ende wirklich löschen (Katalog und Price Guide bleiben, Website wird neu aufgebaut) |

`cm tool …` führt jeden Befehl von `python -m cmtracker` aus (holt vorher den neuesten Code, nicht während eines Laufs).

## Spiele

Erfasst werden Pokémon, One Piece und Flesh and Blood – in dieser Reihenfolge (`order` in der Spiel-Datei):

| Spiel | Kategorien | Sprachen |
|---|---|---|
| Pokémon | Booster Boxes, Elite Trainer Boxes, Box Sets, Tins, Blisters | EN, DE, JA |
| One Piece | Booster Boxes, Promo Products | EN, JA |
| Flesh and Blood | Booster Boxes, Box Sets, Other Boxes | EN, DE, JA |

Jede Sprache wird nur gescrapt, wenn Cardmarket sie für das Produkt führt. Ein weiteres Spiel hinzufügen:

1. `cm tool categories --game-id N` zeigt alle Kategorien des Spiels mit ID, Anzahl und Beispielen.
2. Eine Spiel-Datei in `scraper/config/games/` nach dem Muster von `one_piece.yaml` anlegen: `key` (nur a–z,
   0–9, `-`), `name`, `order`, `cardmarket_id`, `cardmarket_path` (z. B. `OnePiece`), Kategorien, Sprachen.
3. In `web/lib/gameList.ts` das Spiel mit Sprachen eintragen.
4. Der nächste Lauf holt den Katalog des neuen Spiels und scrapt es mit.

## Faire Preise (Preislogik)

**Verständliche Beschreibung mit Beispielen: [docs/Preislogik.md](docs/Preislogik.md)** (auf der Website: „How fair prices work“).

Aktuell **Logik 6** (seit 11/2026: Lockangebote über alle Länder geprüft, Korbgröße nach Angeboten statt Stück).
Je Produkt, Sprache und Tag vier Preise: **nur EU / alle Länder × inkl. / exkl. Versand**. Die komplette Logik
steht mit Kommentaren in [`scraper/config/pricing.yaml`](scraper/config/pricing.yaml):

1. **ungültige Angebote entfernen** – Land (EU-27 beim EU-Schalter) und Kommentar (Mängel, Folie/Siegel,
   geöffnet/unvollständig, Risikohinweise; ganze Wörter, Verneinungen wie „no damage“ zählen nicht)
2. **Ausreißer nach unten** – über 100/200/300 Listungen zählen die 1/2/3 günstigsten gültigen Angebote nicht;
   bis 100 Listungen fliegen nur klare Lockangebote raus (< 50 % des Medians der nächsten 4 **und** < 80 % des
   nächsten Angebots), **geprüft über alle Länder** (erst danach greift der EU-Filter)
3. **jedes Angebot zählt einmal**, egal wie viele Stück · 4. **Korb** K = abrunden(0,15 × N **Angebote**), 1–7 ·
5. **Lückenschutz** (+15 %) · 6. **Median**

Bleibt nach Schritt 1 ein Angebot übrig, gibt es immer einen Preis. Ergebnis: `prices/<spiel>/date=…parquet`
(Cent). **Jede Änderung der Logik wird beim nächsten Lauf erkannt und alle Tage werden neu berechnet**
(`prices/<spiel>/_meta.json` enthält die Prüfsumme der verwendeten Logik). Danach kommt je Spiel eine Mail
„Preislogik geändert – Vergleich alt/neu“: wie viele EU-Preise (inkl. Versand) sich am letzten Tag geändert haben,
wie viele um mehr als 20 %, und die 10 größten Änderungen.

Prüf-Excel `preise_review_<spiel>_<tag>.xlsx`: Preise mit Korb je Variante, Listungen, alle wegen des Kommentars
aussortierten Angebote mit Grund, Lockangebote und gekappte Angebote.

## Website-Daten (Veröffentlichen)

Nach den Preisen erzeugt `python -m cmtracker publish` fertige Dateien unter `public/<spiel>/`:
`status.json` (Stand), `catalog.json` (alle Produkte mit aktuellen Werten und Veränderungen 1 T/7 T/30 T/1 J),
`spark.json` (30-Tage-Verläufe), `index.json` (Marktindex) und `products/<id>.json` (Verlauf + heutige Angebote).
Arbeitsmaterial ist die Verlaufstabelle `history/<spiel>/month=JJJJ-MM.parquet`.

- Veränderungen nur, wenn es am Anfang **und** am Ende des Zeitraums einen Preis gab – neue Produkte springen
  nicht „von 0 auf X“.
- Marktindex verkettet: je Tag nur Varianten mit Preis gestern und heute, extremste 5 % oben/unten getrimmt.
- Hochgeladen werden nur geänderte Dateien; `status.json` kommt zuletzt. Fehlende Werte werden als `null` geschrieben.
- Geänderte Preislogik → Verlauf wird automatisch komplett neu aufgebaut.

## Website (Ordner `web/`, Next.js auf Vercel)

| Seite | Inhalt |
|---|---|
| `/<spiel>` | Markt: Marktindex, Top movers, Supply, New on Cardmarket, Kategorien (Listen-Einstellungen über „Settings“) |
| `/<spiel>/browse` | alle Produkte mit Filtern, Sortierung (auf/ab), Fair price, Items, 1D/7D/30D/1Y, angemeldet „Owned“ (Stück über alle Portfolios) |
| `/<spiel>/product/<id>` | Produktseite: Preise, Verlässlichkeit (Korb: Reliable/Fair/Thin/Very thin) + Zahl der Angebote, ATH/ATL, 52-Wochen-Spanne, eigene Stück je Portfolio mit Link zur Positionshistorie, Verlauf (7D…All, Custom: Von–Bis oder letzte N Tage), Sprachvergleich, Angebote |
| `/portfolio` | Overview: Wert, Einstand, Gewinn/Verlust offen und realisiert (FIFO), Performance 7T/30T/6M/1J, Bestände (bei „All portfolios“ je Produkt zusammengefasst; Klick öffnet die Positionsseite) |
| `/portfolio/performance` | Graph (Performance % oder Gesamtwert; 1T…All, Custom; „Include sold items“), Gewinner und Verlierer |
| `/portfolio/analysis` | Aufteilung (Spiel, Portfolio, Produktart, Sprache, Set, Top-10-Produkte), Preis-Verlässlichkeit der Bestände (Anteil am Wert je Stufe, Filter, Spalten sortierbar), Top-Positionen nach Wert, Verkäufe. Verlässlichkeit, Top-Positionen, der Kuchen „Product“ und Winners/Losers (Performance) fassen dasselbe Produkt (gleiche Sprache) aus mehreren Portfolios zu einer Zeile zusammen |
| `/portfolio/position/<spiel>/<id>/<sprache>` | Historie einer Position (bei „All portfolios“ über alle Portfolios zusammen, mit Aufteilung): Wert, Ø-Einstand, Gewinn/Verlust, Graph Wert/Einstand oder Preis pro Stück mit Kauf-/Verkaufspunkten, Transaktionen |
| `/portfolio/transactions` | alle Käufe und Verkäufe, bearbeiten und löschen |
| `/portfolio/excel` | Import / Export (Excel): Vorlage, Upload mit Vorschau, Export |
| `/watchlist` | beobachtete Produkte (je Sprache, sortierbar, Spiele-Filter), eigene Preisalarme (bearbeiten, pausieren, löschen), zuletzt ausgelöste Alarme |
| `/login`, `/signup`, `/account` | Konto (Supabase): Anmeldung, Registrierung mit E-Mail-Bestätigung, Passwort, Konto löschen |
| `/how-prices-work` | Preislogik in verständlichen Worten |

`/` öffnet das zuletzt gewählte Spiel; alte Adressen `/browse` und `/product/<id>` leiten auf Pokémon um.
Marktdaten kommen über `/api/data/<spiel>/<datei>` (Vercel liest sie mit einem **Nur-Lese-Schlüssel** aus R2;
der Bucket bleibt privat). Einstellungen (EU only, Listen-Einstellungen, letztes Spiel) speichert der Browser,
bei Angemeldeten zusätzlich das Konto (auch die Spiele-Auswahl im Portfolio).

**Performance-Rechnung:** Graph und Kacheln zeigen standardmäßig nur den heutigen Bestand – jeder Kaufposten ab
seinem Kaufdatum (am Kauftag zum bezahlten Preis, danach zum fairen Preis „nur Artikel“). Prozent = **einfache
Rendite**: Gewinn im Zeitraum ÷ eingesetztes Geld (Wert am Anfang des Zeitraums + Käufe seitdem zum Kaufpreis); über
„All“ also (Wert − Einstand) ÷ Einstand, gleich der Kachel „Unrealized“. Ein Kauf verändert so den Prozentwert
(mehr eingesetztes Geld), aber nicht den Gewinn in €. Vor dem ersten Preis (Trackingbeginn) wird linear vom Kaufpreis
zum ersten fairen Preis geschätzt (gestrichelt, „≈“). Mit „Include sold items“ zählen verkaufte Posten bis zum
Verkauf, am Verkaufstag zum Verkaufspreis, danach als fester Erlös. Preisverläufe kommen aus den Produktdateien.

**Portfolio-Regeln:** Kaufpreis = pro Stück inkl. Versand und Gebühren; Verkauf = Erlös pro Stück nach Gebühren und
Versand. Bewertet wird mit dem fairen Preis „nur Artikel“ (nach „EU only“); gibt es heute keinen, der letzte bekannte
mit Datum. Verkäufe werden nach FIFO verrechnet (zuerst gekaufte Stücke zuerst); mehr verkaufen als im Depot liegt
geht nicht. „Position entfernen“ (Fehleingabe) zieht Stücke bei den zuletzt gekauften, noch gehaltenen ab – Verkäufe und
realisierter Gewinn bleiben. Unwiderrufliches (Position entfernen, Transaktion löschen) braucht einen 2,5 Sekunden
gehaltenen Knopf; ein Portfolio löschen geht nur mit eingetipptem Bestätigungssatz. Passwort: mind. 10 Zeichen mit Klein-, Großbuchstabe, Zahl und Sonderzeichen (in Supabase eingestellt).

**Preisalarme:** Arten: Preis fällt unter / steigt über X €, Bestand (Items listed) fällt unter / steigt über N,
Veränderung von Preis oder Bestand um mindestens X % innerhalb von 1–365 Tagen (steigt, fällt oder beides). Preise
standardmäßig inkl. Versand und nach „EU only“, je Alarm umstellbar. Geprüft wird mit dem letzten Markttag des Spiels,
sobald seine Website-Daten veröffentlicht sind (Laptop, `price_alerts.py`); alles Ausgelöste kommt als **eine Mail pro
Nutzer** über das Gmail-Konto der Warn-Mails. Ein Alarm meldet sich einmal und erst wieder, nachdem die Bedingung
zwischendurch nicht erfüllt war; Bearbeiten macht ihn wieder scharf. Einen Alarm anlegen setzt das Produkt auch auf die
Watchlist; von der Watchlist nehmen löscht seine Alarme (gehaltener Knopf).

**Vercel – Environment Variables** (Projekt → Settings → Environment Variables, für alle Umgebungen):

| Name | Wert |
|---|---|
| `R2_ACCOUNT_ID` | Cloudflare-Account-ID |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | eigener R2-API-Token **nur mit Leserecht** (Object Read) für den Bucket |
| `R2_BUCKET` | `cm-market-data` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase-Projekt-URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase „publishable key“ (absichtlich öffentlich; geschützt wird über Row Level Security) |

Ohne die Supabase-Werte läuft die Website ohne Konten weiter. Jeder gemergte PR wird automatisch
veröffentlicht; jeder offene PR bekommt eine Vorschau-Adresse.
Lokal testen: `DATA_DIR=/pfad/mit/public-ordner npm run dev` im Ordner `web`.

### Supabase (Nutzerdaten)

Projekt in Frankfurt. Die Tabellen entstehen aus `supabase/migrations/*.sql` (der Reihe nach im Dashboard unter
*SQL Editor* ausführen; `0003_watchlist_alerts.sql` für Watchlist und Preisalarme). Jede Tabelle hat Row Level Security: Jeder Nutzer sieht und ändert nur seine eigenen Zeilen. Der Laptop liest die
Alarme mit dem secret key (umgeht RLS) und schreibt nur Prüfstand und ausgelöste Alarme zurück.
Passwörter speichert Supabase nur gehasht. Unter *Authentication → URL Configuration*: Site URL =
Website-Adresse, Redirect URLs zusätzlich die Vorschau-Adressen (`https://*-paul-7725.vercel.app/**`).

## Datenablage in R2 (je Spiel: `pokemon`, `one-piece`, `flesh-and-blood`)

```
raw/catalog/<spiel>/date=…/products_nonsingles.json.gz   Rohkatalog (unverändert)
raw/priceguide/<spiel>/date=…/price_guide_nonsingles.json.gz  Roh-Price-Guide (nur Sealed)
priceguide/<spiel>/date=…/part.parquet                   Tagespreise avg, low, trend
catalog/<spiel>/products.parquet, state.json, meta.parquet  Katalog-Zustand; URL, Name, Sprachen, Bild

scrape/<spiel>/snapshots/date=…/day.parquet   je Produkt+Sprache: Status, Infobox, Summen (Stück, Listungen)
scrape/<spiel>/offers/date=…/day.parquet      günstigste 50 nach Endpreis + 50 nach Artikelpreis
scrape/<spiel>/counts/date=…/day.parquet      Bestand nach Land, Verkäufertyp, Bewertung
scrape/<spiel>/progress/date=….json           Fortschritt des Tages (für Fortsetzung)
status/<spiel>/date=….json, latest.json       Stand des Scrapes

prices/<spiel>/date=….parquet, _meta.json     faire Preise je Tag (Cent) + Prüfsumme der Logik
history/<spiel>/month=JJJJ-MM.parquet         Verlauf (Arbeitsmaterial fürs Veröffentlichen)
public/<spiel>/…                              fertige Website-Dateien (siehe oben)

debug/<spiel>/failed/date=…/…                 Fehlerseiten zur Fehlersuche (max. 20 pro Lauf)
review/date=…/…xlsx                           Prüf-Excel der Läufe (nach 7 Tagen gelöscht)
```

Seller-Namen werden nicht gespeichert. Der Datentag richtet sich nach dem Stand des Price Guides (deutsche Zeit).
Geschätzter Speicherbedarf: wenige GB pro Jahr – der Free-Tier (10 GB) reicht lange.

## Alternative: eigener Linux-Rechner zu Hause (derzeit nicht im Einsatz)

Für einen dauerhaft laufenden Rechner mit Ubuntu 24.04 im eigenen Netz – **nicht** für Cloud-Server (werden von
Cardmarket gesperrt). Per SSH anmelden, dann:

```
curl -fsSL https://raw.githubusercontent.com/paul2403e/cardmarket_tracker_v4/main/server/setup.sh -o setup.sh
sudo bash setup.sh
```

Das Skript installiert FlareSolverr (Docker), Python und den Scraper, richtet Zeitpläne (04:41, Nachhol-Termine
11:11 und 17:11) und automatische Sicherheits-Updates ein und fragt einmal die Zugangsdaten ab (dieselben wie
oben, gespeichert nur auf dem Server in `/etc/cmtracker/env`). Bedienung per `cm status`, `cm logs -f`,
`cm test`, `cm run`, `cm stop`, `cm selftest`. Unterschied zum Laptop: Preise und Website werden erst
erzeugt, wenn **alle** Spiele des Tages fertig sind.
