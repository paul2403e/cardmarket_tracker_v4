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
  config/scope.yaml     Welche Spiele, Kategorien und Sprachen erfasst werden
  cmtracker/            Paket (catalog, sources, storage, review …)
  tests/                Tests ohne Netzwerkzugriff
web/                    Next.js-Frontend (ab Meilenstein 5)
supabase/               SQL-Migrationen (ab Meilenstein 6)
.github/workflows/      Automatische Läufe
```

## Fortschritt

- [x] **Meilenstein 1 – Katalog & Price Guide:** täglicher Abgleich aller Pokémon-Sealed-Produkte,
      Scope, aktive Produkte (mit Angeboten), Tagespreise avg/low/trend, Review-Datei
- [ ] Meilenstein 2 – Scraper-Kern (Login, Produktseiten, Angebote, Bestand)
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

Ohne R2-Secrets läuft der Katalog-Workflow trotzdem und liefert die Review-Datei – die Daten werden dann
aber nicht dauerhaft gespeichert.

## Katalog-Lauf manuell starten

**Actions → Katalog & Price Guide → Run workflow.** Nach dem Lauf steht oben auf der Ergebnisseite eine
Zusammenfassung, darunter unter **Artifacts** die Excel-Datei mit allen Produkten.

## Datenablage in R2

```
raw/catalog/pokemon/date=YYYY-MM-DD/products_nonsingles.json.gz     Rohkatalog (unverändert)
raw/priceguide/pokemon/date=YYYY-MM-DD/price_guide_nonsingles.json.gz  Roh-Price-Guide (nur Sealed)
priceguide/pokemon/date=YYYY-MM-DD/part.parquet                     Tagespreise avg, low, trend
catalog/pokemon/products.parquet                                    aktueller Katalog-Zustand
catalog/pokemon/state.json                                          Metadaten des letzten Laufs
```

Der Datentag richtet sich nach dem Stand des Price Guides (deutsche Zeit), nicht nach der Uhrzeit des Laufs.
