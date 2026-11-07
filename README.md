# Pauls CM Scraper

Markt-Tracker für Sealed-Produkte auf Cardmarket: tägliche Preise, Bestände und Verkaufsdurchschnitte,
dazu ein Portfolio mit Einkaufs- und Verkaufshistorie und Preis-Alerts.

## Architektur

| Teil | Technik | Inhalt |
|---|---|---|
| Datensammlung | Python auf einem Oracle-Cloud-Server (Always Free) | Katalog, Price Guide und Scrape (täglich), später Rechenschritt |
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
server/                 Einrichtung und Zeitpläne des Scraper-Servers (setup.sh, cm, systemd)
```

## Fortschritt

- [x] **Meilenstein 1 – Katalog & Price Guide:** täglicher Abgleich aller Pokémon-Sealed-Produkte,
      Scope, aktive Produkte (mit Angeboten), Tagespreise avg/low/trend, Review-Datei
- [x] **Meilenstein 2 – Scraper-Kern:** Login, Produktseiten EN/DE/JA, alle Angebote (inkl. Nachladen
      und Aufteilung über 300), Bestandszählung, günstigste 50 nach Endpreis und Artikelpreis, Notbremse
- [x] **Meilenstein 3 – Automatik & Überwachung:** feste Startzeiten, Mail bei Problemen,
      tägliche Plausibilitätsprüfung, status.json, Totmannschalter (healthchecks.io);
      seit 11/2026 auf eigenem Server statt GitHub Actions
- [ ] Meilenstein 4 – Rechenschritt (Fair Price, Tageskennzahlen, Frontend-Dateien)
- [ ] Meilenstein 5 – Frontend-Basis
- [ ] Meilenstein 6 – Nutzerbereich (Depots, Transaktionen, Historien, Excel)
- [ ] Meilenstein 7 – Portfolio-Auswertung
- [ ] Meilenstein 8 – Alerts

## Server einrichten (einmalig)

Ubuntu 24.04 auf Oracle Cloud (Ampere A1, Region Frankfurt). In der Oracle Cloud Shell per SSH anmelden, dann:

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

## Ein weiteres Spiel hinzufügen (z. B. One Piece)

1. `scraper/config/games/pokemon.yaml` kopieren, z. B. als `onepiece.yaml`.
2. `key`, `name`, `cardmarket_id` (Spiel-ID in den Cardmarket-Downloads) und `cardmarket_path`
   (Teil der Website-Adresse, z. B. `OnePiece`) anpassen.
3. Kategorien eintragen: Die Excel-Datei des nächsten Katalog-Laufs listet alle Kategorien des Spiels
   mit ihrer ID; `slug` ist der Teil der Produkt-URL (z. B. `Booster-Boxes`).
4. Fertig – Katalog- und Scrape-Lauf verarbeiten automatisch alle Dateien in diesem Ordner.

## Automatik (Uhrzeiten Berlin)

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

## Bedienung (Oracle Cloud Shell → SSH zum Server)

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
