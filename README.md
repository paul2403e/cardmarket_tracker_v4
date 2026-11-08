# Pauls CM Scraper

Markt-Tracker für Sealed-Produkte auf Cardmarket: tägliche Preise, Bestände und Verkaufsdurchschnitte,
dazu ein Portfolio mit Einkaufs- und Verkaufshistorie und Preis-Alerts.

## Architektur

| Teil | Technik | Inhalt |
|---|---|---|
| Datensammlung | Python auf dem eigenen Windows-Laptop (Heimanschluss) | Katalog, Price Guide und Scrape (täglich), später Rechenschritt |
| Code | GitHub (öffentlich) | Quellcode; GitHub Actions nur für die Tests |
| Marktdaten | Cloudflare R2 (Parquet + JSON) | Rohdaten, Tageskennzahlen, Dateien fürs Frontend |
| Nutzerdaten | Supabase | Accounts, Depots, Transaktionen, Alerts |
| Frontend | Next.js auf Vercel | Markt-Tracker, Portfolio, Alerts |

## Ordner

```
scraper/                Python-Code für die Datensammlung
  config/games/*.yaml   Ein Spiel pro Datei: Kategorien, Sprachen, Ausschlüsse
  cmtracker/            Paket (catalog, scrape, parser, fetcher, storage, review …)
  tests/                Tests ohne Netzwerkzugriff (fixtures = echte, anonymisierte Cardmarket-Seiten)
web/                    Next.js-Frontend (ab Meilenstein 5)
supabase/               SQL-Migrationen (ab Meilenstein 6)
.github/workflows/      Tests bei jeder Code-Änderung
windows/                Laptop-Betrieb: setup.ps1 (Einrichtung), cmwin.py (Zeitplan-Lauf, Befehl cm)
server/                 Alternative: eigener Linux-Rechner, z. B. Mini-PC zu Hause (setup.sh, cm, systemd)
```

## Fortschritt

- [x] **Meilenstein 1 – Katalog & Price Guide:** täglicher Abgleich aller Pokémon-Sealed-Produkte,
      Scope, aktive Produkte (mit Angeboten), Tagespreise avg/low/trend, Review-Datei
- [x] **Meilenstein 2 – Scraper-Kern:** Login, Produktseiten EN/DE/JA, alle Angebote (inkl. Nachladen
      und Aufteilung über 300), Bestandszählung, günstigste 50 nach Endpreis und Artikelpreis, Notbremse
- [x] **Meilenstein 3 – Automatik & Überwachung:** feste Startzeiten, Mail bei Problemen,
      tägliche Plausibilitätsprüfung, status.json, Totmannschalter (healthchecks.io);
      seit 11/2026 auf dem eigenen Laptop statt GitHub Actions
- [ ] Meilenstein 4 – Rechenschritt (Fair Price, Tageskennzahlen, Frontend-Dateien)
- [ ] Meilenstein 5 – Frontend-Basis
- [ ] Meilenstein 6 – Nutzerbereich (Depots, Transaktionen, Historien, Excel)
- [ ] Meilenstein 7 – Portfolio-Auswertung
- [ ] Meilenstein 8 – Alerts

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
| `SMTP_USER`, `SMTP_PASS`, `ALERT_EMAIL_TO` | Warn-Mails (Gmail-Adresse, Gmail-App-Passwort, Empfänger) |
| `HC_PING_URL` | Totmannschalter healthchecks.io (Ping nach jedem vollständig gescrapten Tag) |

### Ablauf auf dem Laptop

| Wann | Was |
|---|---|
| 03:30 | Windows weckt den Laptop (auch zugeklappt und auf Akku): Katalog → Scrape (~3,5–4 Std.) → Katalog erneut (falls der Price Guide um 03:30 noch alt war) → faire Preise → Laptop darf wieder schlafen |
| Anmelden, Entsperren, Aufwachen | Ist der Tag noch nicht fertig, macht der Lauf dort weiter (im Hintergrund, kein Fenster). Ist er fertig, endet er nach Sekunden. Vor 03:30 passiert nichts. |
| 23:55 | Ein laufender Scrape hört spätestens hier auf (Tageswechsel) |

- Während des Laufs bleibt der Laptop wach (Bildschirm darf aus sein); kein Netz → bis zu 15 Min. warten statt Fehler.
- Tempo: 1–2 s Pause pro Abruf (einstellbar unter `pace` in `scraper/config/monitoring.yaml`). Zeigt Cardmarket
  trotzdem eine Prüfung (auch schon beim Login), die FlareSolverr nicht löst: 30 Min. Abkühlpause, neu anmelden,
  langsamer weiter; nach 3 Pausen Notbremse (Mail) und an diesem Tag keine automatischen Neustarts mehr
  (`cm run --now` geht). Dieselbe Warn-Mail kommt höchstens einmal pro Tag.
- **Beim Login öffnet sich kurz ein Chrome-Fenster** (FlareSolverr). Unter Windows erkennt Cloudflare das
  versteckte Chrome, deshalb läuft es sichtbar; nach dem Login schließt es sich, die Abrufe laufen ohne Browser.
- Der Price Guide wird jeden Tag gespeichert, auch wenn der Scrape scheitert (bei Bedarf beim nächsten Start erneut,
  bis der Stand von heute da ist). Ein neues Steuerskript gilt sofort, nicht erst beim nächsten Lauf.
- Vor jedem Lauf holt sich der Laptop den neuesten Code von `main` – ein gemergter PR ist ab dem nächsten Lauf aktiv.
- Unvollständige oder ausgefallene Tage (z. B. Laptop war aus) meldet eine einzelne Mail beim nächsten Lauf.
- Die Prüf-Excel jedes Laufs liegt in `Dokumente\CM-Tracker\Review` (und 7 Tage in R2 unter `review/`).
- **Nicht zugeklappt in Rucksack oder Tasche lassen** – der Laptop wacht um 03:30 trotzdem auf.

### Bedienung (PowerShell)

| Befehl | Was passiert |
|---|---|
| `cm test [N]` | Testlauf mit N Produkten (Standard 20), Ausgabe live |
| `cm status` | Stand von heute, Zeitplan, letzte Protokollzeilen |
| `cm logs [N]` | letzte N Zeilen des Protokolls (Dateien: `%LOCALAPPDATA%\cmtracker\logs`) |
| `cm run --now` | täglichen Lauf sofort starten (auch vor 03:30) |
| `cm stop` | laufenden Lauf anhalten (der nächste Start macht dort weiter) |
| `cm secrets` / `cm selftest` / `cm update` | Zugangsdaten ändern / prüfen (Testmail) / Code sofort aktualisieren |

## Alternative: eigener Linux-Rechner zu Hause (z. B. gebrauchter Mini-PC)

Für einen dauerhaft laufenden Rechner mit Ubuntu 24.04 im eigenen Netz. **Nicht** für Cloud-Server
(Oracle, Google, Azure werden von Cardmarket gesperrt). Per SSH anmelden, dann:

```
curl -fsSL https://raw.githubusercontent.com/paul2403e/cardmarket_tracker_v4/main/server/setup.sh -o setup.sh
sudo bash setup.sh
```

Das Skript installiert FlareSolverr (Docker), Python und den Scraper, richtet die Zeitpläne und automatische
Sicherheits-Updates ein und fragt einmal die Zugangsdaten ab (Eingabe verdeckt, gespeichert nur auf dem Server
in `/etc/cmtracker/env`, lesbar nur für den Scraper):

| Zugangsdaten | Wofür |
|---|---|
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Speicher für die Marktdaten |
| `CM_USERNAME`, `CM_PASSWORD` | Cardmarket-Login (Versandkosten an die eigene Adresse) |
| `SMTP_USER`, `SMTP_PASS`, `ALERT_EMAIL_TO` | Warn-Mails (Gmail-Adresse, Gmail-App-Passwort, Empfänger) |
| `HC_PING_URL` | Totmannschalter healthchecks.io (Ping nach jedem vollständig gescrapten Tag) |

Am Ende prüft `cm selftest` R2, FlareSolverr und den Mailversand (Testmail). Das Skript darf jederzeit erneut
ausgeführt werden (repariert, behält die Zugangsdaten).

**Code-Updates:** Vor jedem Lauf holt sich der Server den neuesten Stand von `main`. Ein gemergter PR ist also
ab dem nächsten Lauf aktiv – am Server muss dafür nichts getan werden.

## Faire Preise (Preislogik)

Nach jedem fertigen Tag berechnet `python -m cmtracker price` je Produkt und Sprache vier Preise:
**nur EU / alle Länder × inkl. / exkl. Versand** (für den EU-Schalter auf der Website). Die komplette Logik
steht mit Kommentaren in [`scraper/config/pricing.yaml`](scraper/config/pricing.yaml):

1. ungültige Angebote entfernen – Land (EU-27 beim EU-Schalter) und Kommentar (Mängel, geöffnet, Inhalt fehlt,
   Risikohinweise; ganze Wörter, Verneinungen wie „no damage“, „keine Dellen oder Kratzer“, „damage-free“ zählen nicht)
2. Lockangebote entfernen (pro Zeile: < 0,75 × Median der nächsten bis zu 4 Zeilen, am Preis inkl. Versand)
3. Einzelstücke, sortiert inkl. bzw. exkl. Versand · 4. Korb K = abrunden(0,15 × N), 1–7 ·
5. Lückenschutz (+15 %) · 6. Median

Bleibt nach Schritt 1 ein Angebot übrig, gibt es immer einen Preis. Ergebnis: `prices/<spiel>/date=…parquet`
(Cent). **Jede Änderung an `pricing.yaml` wird beim nächsten Lauf erkannt und alle Tage werden neu berechnet**
(`prices/<spiel>/_meta.json` enthält die Prüfsumme der verwendeten Logik). Von Hand: `cm`-Lauf oder
`python -m cmtracker price --all`.

Prüf-Excel `preise_review_<spiel>_<tag>.xlsx` (Laptop: `Dokumente\CM-Tracker\Review`, R2: 7 Tage unter `review/`):
Preise mit Korb je Variante, alle wegen des Kommentars aussortierten Angebote mit Grund, entfernte Lockangebote.

## Ein weiteres Spiel hinzufügen (z. B. One Piece)

1. `scraper/config/games/pokemon.yaml` kopieren, z. B. als `onepiece.yaml`.
2. `key`, `name`, `cardmarket_id` (Spiel-ID in den Cardmarket-Downloads) und `cardmarket_path`
   (Teil der Website-Adresse, z. B. `OnePiece`) anpassen.
3. Kategorien eintragen: Die Excel-Datei des nächsten Katalog-Laufs listet alle Kategorien des Spiels
   mit ihrer ID; `slug` ist der Teil der Produkt-URL (z. B. `Booster-Boxes`).
4. Fertig – Katalog- und Scrape-Lauf verarbeiten automatisch alle Dateien in diesem Ordner.

## Automatik auf dem Linux-Rechner (Uhrzeiten Berlin)

| Uhrzeit | Lauf |
|---|---|
| 04:41 | Katalog & Price Guide, direkt danach Scrape aller aktiven Produkte (~4 Std.) |
| 11:11, 17:11 | Nachhol-Termine: Katalog, falls er fehlgeschlagen ist; Scrape, falls der Tag nicht fertig ist (sonst Ende nach ~1 Min.) |
| 02:30 | Neustart nur, falls ein Sicherheits-Update ihn verlangt |
| sonntags | FlareSolverr wird auf die neueste Version gebracht |

War der Server zur Terminzeit aus, holt er den Lauf direkt nach dem Hochfahren nach.

**Mails kommen nur bei Problemen:** Notbremse, abgestürzter Lauf (mit den letzten Protokollzeilen),
Katalog-Auffälligkeiten (Price Guide veraltet, aktive Produkte stark gesunken, Speicher > 8 GB), Tag bis 17:11
nicht vollständig, sowie die tägliche Plausibilitätsprüfung (Schwellen in `scraper/config/monitoring.yaml`):
Fehlerquote, fehlende Versandkosten, Füllquoten, Verkäufertyp-Verteilung, falsche Sprache, unvollständige
Zählungen, FlareSolverr-Anteil, nicht gefundene Produkte und geänderte URLs.
Bleibt der tägliche Ping an healthchecks.io aus (z. B. Server ganz ausgefallen), schickt healthchecks.io selbst
eine Mail. Status für das Frontend: `status/pokemon/latest.json` in R2.

## Bedienung auf dem Linux-Rechner (SSH)

| Befehl | Was passiert |
|---|---|
| `cm status` | Zeitpläne, letzter Lauf, letzte Protokollzeilen |
| `cm logs` / `cm logs -f` | Protokoll des täglichen Laufs / live mitlesen |
| `cm test [N]` | Testlauf mit N Produkten (Standard 20) |
| `cm run` / `cm stop` | täglichen Lauf sofort starten / anhalten (macht beim nächsten Termin weiter) |
| `cm scrape --reset-today` | heutige Scrape-Daten löschen und den Tag neu scrapen |
| `cm catalog` | Katalog & Price Guide neu laden |
| `cm discover` | Erkundung: Beispielseiten (bei Layout-Problemen) |
| `cm selftest` / `cm secrets` / `cm update` | Prüfen / Zugangsdaten ändern / sofort aktualisieren |

Die **Review-Excel** jedes Laufs liegt 7 Tage in R2 unter `review/date=…/` – herunterladen im
Cloudflare-Dashboard → R2 → Bucket → Ordner `review` → Datei → Download. Der Scrape setzt einen Katalog-Lauf
am selben oder einem früheren Tag voraus.

Produkte, die Cardmarket in keiner der gewünschten Sprachen führt (z. B. nur Indonesisch/Thailändisch),
erkennt der Scraper beim ersten Abruf; sie werden ab dann dauerhaft aus dem Scope genommen und tauchen
weder in den Daten noch in den Review-Dateien auf.

## Datenablage in R2

```
raw/catalog/pokemon/date=YYYY-MM-DD/products_nonsingles.json.gz     Rohkatalog (unverändert)
raw/priceguide/pokemon/date=YYYY-MM-DD/price_guide_nonsingles.json.gz  Roh-Price-Guide (nur Sealed)
priceguide/pokemon/date=YYYY-MM-DD/part.parquet                     Tagespreise avg, low, trend
catalog/pokemon/products.parquet                                    aktueller Katalog-Zustand
catalog/pokemon/state.json                                          Metadaten des letzten Katalog-Laufs
catalog/pokemon/meta.parquet                                        URL, deutscher Name, Sprachen, Bild je Produkt

scrape/pokemon/snapshots/date=YYYY-MM-DD/day.parquet   je Produkt+Sprache: Status, Infobox (Verfügbare Artikel,
                                                       Trend, Ø 30/7/1), Summen, vollständig gezählt?
scrape/pokemon/offers/date=YYYY-MM-DD/day.parquet      günstigste 50 nach Endpreis + 50 nach Artikelpreis
scrape/pokemon/counts/date=YYYY-MM-DD/day.parquet      Bestand aufgeteilt nach Land, Verkäufertyp, Bewertung
                                                       (für gefilterten Bestand, z. B. nur EU)
scrape/pokemon/progress/date=YYYY-MM-DD.json           Fortschritt des Tages (für Fortsetzung)
debug/pokemon/failed/date=YYYY-MM-DD/…                 Fehlerseiten zur Fehlersuche (max. 20 pro Lauf)
review/date=YYYY-MM-DD/…xlsx                           Review-Excel der Läufe (werden nach 7 Tagen gelöscht)
```

Während eines Tages entstehen Zwischendateien (`part-…`); sobald alle aktiven Produkte erledigt sind,
werden sie zu einer `day.parquet` pro Tabelle zusammengefasst. Preise sind in Cent gespeichert.
Geschätzter Speicherbedarf: rund 1–1,5 GB pro Jahr für ~2.000 Produkte – der Free-Tier (10 GB) reicht
für viele Jahre.

Der Datentag richtet sich nach dem Stand des Price Guides (deutsche Zeit), nicht nach der Uhrzeit des Laufs.
