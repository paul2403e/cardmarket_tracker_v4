# Pauls CM Scraper

Markt-Tracker für Sealed-Produkte auf Cardmarket: tägliche Preise, Bestände und Verkaufsdurchschnitte,
dazu ein Portfolio mit Einkaufs- und Verkaufshistorie und Preis-Alerts.

## Architektur

| Teil | Technik | Inhalt |
|---|---|---|
| Datensammlung | Python in GitHub Actions | Katalog & Price Guide (täglich), später Scraper und Rechenschritt |
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
.github/workflows/      Automatische Läufe
```

## Fortschritt

- [x] **Meilenstein 1 – Katalog & Price Guide:** täglicher Abgleich aller Pokémon-Sealed-Produkte,
      Scope, aktive Produkte (mit Angeboten), Tagespreise avg/low/trend, Review-Datei
- [x] **Meilenstein 2 – Scraper-Kern:** Login, Produktseiten EN/DE/JA, alle Angebote (inkl. Nachladen
      und Aufteilung über 300), Bestandszählung, günstigste 50 nach Endpreis und Artikelpreis, Notbremse
- [ ] Meilenstein 3 – Orchestrierung & Monitoring
- [ ] Meilenstein 4 – Rechenschritt (Fair Price, Tageskennzahlen, Frontend-Dateien)
- [ ] Meilenstein 5 – Frontend-Basis
- [ ] Meilenstein 6 – Nutzerbereich (Depots, Transaktionen, Historien, Excel)
- [ ] Meilenstein 7 – Portfolio-Auswertung
- [ ] Meilenstein 8 – Alerts

## Einrichtung

GitHub-Secrets unter **Settings → Secrets and variables → Actions**:

| Secret | Wofür |
|---|---|
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Speicher für die Marktdaten |
| `CM_USERNAME`, `CM_PASSWORD` | Cardmarket-Login (Versandkosten an die eigene Adresse) |

Ohne R2-Secrets läuft der Katalog-Workflow trotzdem und liefert die Review-Datei – die Daten werden dann
aber nicht dauerhaft gespeichert.

## Ein weiteres Spiel hinzufügen (z. B. One Piece)

1. `scraper/config/games/pokemon.yaml` kopieren, z. B. als `onepiece.yaml`.
2. `key`, `name`, `cardmarket_id` (Spiel-ID in den Cardmarket-Downloads) und `cardmarket_path`
   (Teil der Website-Adresse, z. B. `OnePiece`) anpassen.
3. Kategorien eintragen: Die Excel-Datei des nächsten Katalog-Laufs listet alle Kategorien des Spiels
   mit ihrer ID; `slug` ist der Teil der Produkt-URL (z. B. `Booster-Boxes`).
4. Fertig – Katalog- und Scrape-Lauf verarbeiten automatisch alle Dateien in diesem Ordner.

## Läufe manuell starten

- **Actions → Katalog & Price Guide → Run workflow** – Zusammenfassung oben auf der Ergebnisseite,
  Excel-Datei mit allen Produkten unter **Artifacts**.
- **Actions → Scrape (Angebote & Preise) → Run workflow** – `limit` begrenzt die Produktanzahl (Testlauf),
  leer = alle aktiven. Die Zusammenfassung enthält eine Stichprobe zum Gegenprüfen auf Cardmarket.
  Der Scrape setzt einen Katalog-Lauf am selben oder einem früheren Tag voraus.

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
scrape/pokemon/counts/date=YYYY-MM-DD/day.parquet      Angebote/Stück je Land, Verkäufertyp, Bewertung
scrape/pokemon/progress/date=YYYY-MM-DD.json           Fortschritt des Tages (für Fortsetzung)
debug/pokemon/failed/date=YYYY-MM-DD/…                 Fehlerseiten zur Fehlersuche (max. 20 pro Lauf)
```

Während eines Tages entstehen Zwischendateien (`part-…`); sobald alle aktiven Produkte erledigt sind,
werden sie zu einer `day.parquet` pro Tabelle zusammengefasst. Preise sind in Cent gespeichert.
Geschätzter Speicherbedarf: rund 1–1,5 GB pro Jahr für ~2.000 Produkte – der Free-Tier (10 GB) reicht
für viele Jahre.

Der Datentag richtet sich nach dem Stand des Price Guides (deutsche Zeit), nicht nach der Uhrzeit des Laufs.
