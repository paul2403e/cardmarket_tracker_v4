# Übergabe für neue Chats und andere KI-Assistenten

Diese Datei gibt einem neuen Chat (oder einer anderen KI) den vollen Überblick, damit die Arbeit direkt weitergehen
kann. **Zuerst diese Datei lesen, dann das [README](README.md)** (Technik, Einrichtung, Bedienung im Detail).
Sie wird in jedem PR mit aktualisiert, genau wie das README.

> Das Repository ist öffentlich: hier stehen keine Schlüssel, Passwörter, E-Mail-Adressen oder Portfolio-Inhalte.

## Worum es geht

Privater Markt-Tracker für **Sealed-Produkte auf Cardmarket** (Pokémon, One Piece, Flesh and Blood): jeden Tag
faire Preise, Bestände und Veränderungen, dazu ein Portfolio (Käufe/Verkäufe, Performance), Watchlist und
Preisalarme per Mail. Website: https://cardmarket-tracker-v4.vercel.app (privat genutzt, Registrierung offen).
Repository: `paul2403e/cardmarket_tracker_v4`, Branch `main`.

## Zusammenarbeit (so arbeiten wir)

- **Sprache:** mit dem Nutzer (Paul) immer **Deutsch**. Die Website selbst ist auf **Englisch**.
- **Vor jedem Code die Logik erklären** und auf sein Okay warten („passt so“ oder was anders sein soll).
  Kleine, eindeutige Korrekturen nach seinem Feedback dürfen direkt umgesetzt werden.
- Arbeit kommt als **Pull Request**, Paul merged selbst. Jeder gemergte PR geht automatisch live (Vercel) und ist
  ab dem nächsten Laptop-Lauf aktiv.
- **README und diese Datei in jedem PR aktuell halten.**
- Antworten kurz und verständlich, ohne Fachjargon; Paul ist kein Programmierer, versteht aber die Fachlogik gut.
- Er gibt Feedback oft als nummerierte Liste mit Screenshots. Jeden Punkt beantworten.
- Vor dem Mergen nötige Schritte (z. B. SQL in Supabase ausführen, `cm secrets`) klar als Liste nennen.

## Feste Regeln (nicht ändern ohne ausdrückliche Zustimmung)

- **Keine Zugangsdaten im Chat.** Schlüssel kommen nur auf den Laptop (`cm secrets`, mit Windows verschlüsselt)
  oder in Vercel (Environment Variables). Der **Supabase secret key nur auf den Laptop** – nie Vercel, nie Chat.
  Geheime Werte nie ausgeben oder loggen.
- **Scraping nur auf dem Laptop** über den Heimanschluss – nicht auf GitHub Actions oder Cloud-Servern
  (Cardmarket sperrt Cloud-Netze). Keine Proxys oder Tricks gegen Sperren; bei Prüfungen Abkühlpause.
- **Keine Verkäufernamen speichern.**
- **Unwiderrufliches** (Daten löschen) nur mit Probelauf und Bestätigung; auf der Website mit 2,5 s gehaltenem
  Knopf (`components/HoldButton.tsx`) oder eingetipptem Satz.
- **Kein Impressum / keine Datenschutzseite** – die Website bleibt privat.
- Kästen eckig-gerundet (`rounded-lg`), keine Pillen-/Ovalform für Hinweis- und Infokästen.

## Architektur in einem Satz je Teil

| Teil | Wo | Was |
|---|---|---|
| Datensammlung | Windows-Laptop, `windows/cmwin.py` (Befehl `cm`), Python-Paket `scraper/cmtracker` | 03:30 täglich: Katalog → Scrape je Spiel → faire Preise → Website-Dateien → Preisalarme |
| Marktdaten | Cloudflare R2, Bucket `cm-market-data` | Rohdaten, Preise (`prices/`), Verlauf (`history/`), fertige Website-Dateien (`public/<spiel>/`) |
| Website | `web/` (Next.js 16, Vercel) | liest `public/<spiel>/…` über `/api/data/…` mit Nur-Lese-Schlüssel |
| Nutzerdaten | Supabase (Frankfurt), `supabase/migrations/*.sql` | Konten, Einstellungen, Depots, Transaktionen, Watchlist, Alarme; RLS auf jeder Tabelle |
| Mails | Gmail-Konto (SMTP) vom Laptop | Tagesberichte, Warn-Mails, Preisalarm-Sammelmail |

## Wichtige fachliche Entscheidungen (mit Grund)

- **Fairer Preis** (Logik 7, `scraper/config/pricing.yaml`, erklärt in `docs/Preislogik.md` und auf der Website
  unter `/how-prices-work` – **bei Logik-Änderungen alle drei Stellen anpassen**): Kommentarfilter, Lockangebote
  (über **alle Länder** geprüft, erst danach EU-Filter) bzw. Kappung bei >100 Listungen, jedes Angebot zählt einmal,
  Korb = 15 % der **Angebote** (nicht Stück; 1–7), Lückenschutz +15 %, Median. Vier Preise je Tag: EU/alle ×
  inkl./exkl. Versand. **Nur Artikel** (Schritt 7) = Preis inkl. Versand − typischer Inlandsversand des Produkts
  (Median Versand deutscher Verkäufer: heute ≥ 3 Angebote, sonst letzte 30 Tage, sonst gleiche Produktart), nie unter
  dem Median der Artikelpreise – weil Auslandsverkäufer oft billig listen und über Versand kassieren (Paul, 10.11.).
  Logik-Änderung (`ALGO_VERSION` oder pricing.yaml) → alle Tage neu + Vergleichs-Mail alt/neu (inkl. und nur Artikel).
- **Verlässlichkeit** nach der Zahl gültiger Angebote **im Korb** (aus der Preisberechnung, je EU-Schalter;
  `basket` im Katalog): Reliable 5–7 · Fair 3–4 · Thin 2 · Very thin 1 · No price 0 (`web/lib/series.ts`). Daneben
  „offers“ = alle Angebote auf Cardmarket (alle Länder, vor Filtern; Hinweis beim Darüberfahren). Verworfen: Stufen
  nach Angebotszahl (gemischt mit Nicht-EU/Beschädigtem) und Hochrechnen gültiger Angebote.
- **Portfolio-Bewertung** zum fairen Preis **„nur Artikel“** (nach EU-Schalter); ohne Preis heute der letzte
  bekannte. Kaufpreis = pro Stück inkl. Versand/Gebühren. Verkäufe nach **FIFO**.
- **Performance = einfache Rendite**: Gewinn im Zeitraum ÷ (Wert am Anfang + Käufe im Zeitraum). Über „All“ =
  (Wert − Einstand) ÷ Einstand. Bewusst **nicht zeitgewichtet** (das ergab für Paul unverständliche Werte, weil frühe
  kleine Käufe die Kurve dominierten). Kauftag = Kaufpreis; vor Trackingbeginn linear geschätzt (gestrichelt, „≈“).
  Standard: nur heutiger Bestand; „Include sold items“ zählt Verkäufe mit.
- **Preisalarme** prüft der Laptop nach dem Veröffentlichen; ein Alarm meldet sich einmal und erst wieder, nachdem
  die Bedingung zwischendurch nicht erfüllt war; eine Sammel-Mail pro Nutzer.
- **Produktbilder**: Adresse aus der Produktseite (Cardmarket nutzt .jpg und .png); Platzhalter-Symbol je
  Produktart, wenn kein Bild lädt.
- **Tabellen-Sortierung** (Spaltenköpfe) gilt nur für den Besuch und springt beim Neuladen auf den Standard;
  gespeichert werden nur Einstellungen wie Listen-Größen, Zeiträume, EU-Schalter (`lib/settings.tsx`).
- **Portfolio-Kopf** (`components/portfolio/Shell.tsx`, auf allen Portfolio-Reitern): Zeile „Portfolio“ (Auswahl,
  am gewählten Portfolio ein Stift → Umbenennen/Löschen) und Zeile „Games“ (Spiele-Chips, auch auf der Watchlist).
- **Positionsseite** `/portfolio/position/<spiel>/<id>/<sprache>` (6d) ↔ Produktseite gegenseitig verlinkt
  („Product page →“ bzw. „Position history →“ unter „In your portfolio“). Graph wie Performance: Performance % (Standard), Wert, Preis pro Stück.
- **Verlässlichkeits-Stufe** steht klein neben dem Preis in All products, als Kästchen auf der Produktseite und in
  Analysis (`components/ReliabilityBadge.tsx`).
- **Holdings (Overview), Analysis und Winners/Losers** fassen dasselbe Produkt (gleiche Sprache) über Portfolios zusammen; Aufteilung je Portfolio gibt es
  über die Portfolio-Auswahl oben bzw. den Kuchen „Portfolio“.
- Spiele-Reihenfolge und Sprachen in `scraper/config/games/*.yaml` und `web/lib/gameList.ts`.

## Stand

Erledigt: Meilensteine 1–8 (inkl. 6d Historie je Position) und Feedback-Runde 9 (Details: README → Fortschritt).

Offen / Ideen:
- Weitere Wünsche kommen meist als Feedback-Liste von Paul.

## Arbeiten am Code

- Tests: `cd scraper && python -m pytest -q` (ohne Netz; Fixtures = echte, anonymisierte Cardmarket-Seiten).
  Website: `cd web && npx tsc --noEmit && npm run build`. CI (`.github/workflows/tests.yml`) prüft pytest,
  Website-Build, Windows-Runner und Shellcheck.
- Website lokal mit Daten: `DATA_DIR=/pfad/mit/public-ordner npm run dev` (Ordner mit `public/<spiel>/…`).
  Ohne echte Supabase: einen kleinen Mock-Server für `/auth/v1/*` und `/rest/v1/*` nutzen und
  `NEXT_PUBLIC_SUPABASE_URL` darauf zeigen lassen.
- Laptop-Runner `windows/cmwin.py`: Marker je Tag und Spiel in `%LOCALAPPDATA%\cmtracker\state`
  (`{tag}.price.{spiel}.ok`, `.publish.`, `.alerts.`); `cm tool <befehl>` führt `python -m cmtracker <befehl>` aus.
- Stolpersteine: In Next.js 16 heißt die Middleware `proxy.ts`. Dialoge per Portal an `<body>` (sonst erben sie
  Tabellen-Ausrichtung). Absolut positionierte `sr-only`-Elemente in scrollbaren Tabellen brauchen einen
  `relative`-Container (sonst seitliches Scrollen am Handy). NaN darf nie in JSON landen (`publish._clean`).
- Neue Spalten in der Verlaufstabelle (`HISTORY_SCHEMA`) werden für alte Monatsdateien mit leeren Werten ergänzt.
