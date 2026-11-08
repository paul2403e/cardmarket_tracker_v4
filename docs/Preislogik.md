# So entsteht der faire Preis

Der faire Preis beantwortet die Frage: **Was zahle ich heute realistisch, wenn ich dieses Produkt in dieser
Sprache auf Cardmarket kaufe?** Er wird jeden Tag für jedes Produkt und jede Sprache (EN, DE, JP) berechnet –
einmal **inkl. Versand** nach Deutschland und einmal **nur Artikelpreis**, jeweils für **nur EU** und
**alle Länder** (Schalter „EU only“ auf der Website).

Alle Zahlen und Wortlisten stehen in [`scraper/config/pricing.yaml`](../scraper/config/pricing.yaml).
Wird dort etwas geändert, rechnet der nächste Lauf **alle bisherigen Tage neu**, damit der Verlauf einheitlich bleibt.

---

## Grundlage

Jeden Morgen liest der Scraper pro Produkt und Sprache:

- **alle Angebote zum Zählen** – daraus **N**: wie viele Stück insgesamt gelistet sind (Menge 3 = 3 Stück),
  vor jedem Filter, alle Länder;
- **die günstigsten Angebote im Detail** (je 50 nach Gesamtpreis und nach Artikelpreis): Preis, Versand,
  Menge, Land, Verkäufer, Kommentar im Volltext.

## Schritt 1 – Ungültige Angebote aussortieren

Ein Angebot zählt nicht, wenn …

- **das Land nicht passt:** Bei „EU only“ zählen nur Verkäufer aus den 27 EU-Ländern (kein Zoll).
  Schweiz, Großbritannien, Norwegen usw. fallen dann raus.
- **der Kommentar einen Mangel nennt.** Vier Gruppen:
  - **A Schäden:** Delle, Kratzer, Knick, Loch, beschädigt, dent, damage, scratch, crease, bent …
  - **B Folie/Siegel:** Riss, lose Folie, ohne Folie, resealed, tear, torn, rip, cut, „gap in the seal“ …
  - **C Geöffnet oder unvollständig:** geöffnet, zum Öffnen, opened, empty/leer, „box only“, Promo fehlt …
  - **D Mängel nicht ausgeschlossen:** „not mint“, „Dellen möglich“, „kann Lagerspuren aufweisen“ …

  Dazu Wörter auf Italienisch, Spanisch und Französisch (ammaccatura, desperfecto, abîmé …).
  Es zählen nur **ganze Wörter**: „unopened“, „undamaged“ oder „Luftpolsterfolie“ lösen nichts aus.

  **Verneinungen** heben einen Treffer auf: „No damage“, „keine Dellen oder Kratzer“, „no scratches, dents or
  holes“, „never opened“, „damage-free“, „kratzerfrei“. Die Verneinung endet aber bei „but/aber“:
  „no damage, but small dent“ bleibt ungültig.

  **Ausnahmen**, die kein Mangel sind: „tear strip“ (Aufreißstreifen), „hang hole“ (Aufhängeloch bei Blistern).

Bewertungen und Verkaufszahlen der Verkäufer werden **nicht** gefiltert.

**Bleibt nach Schritt 1 mindestens ein Angebot übrig, gibt es immer einen Preis.**

## Schritt 2 – Lockangebote entfernen

Manche Angebote stehen auffällig weit unter dem Markt (Lockangebote, Fehler, Betrug). Geprüft wird die
günstigste Zeile – oder die zwei günstigsten zusammen –, sortiert nach Gesamtpreis inkl. Versand.
Sie fliegt raus, wenn **beides** gilt:

1. Sie liegt **unter 75 %** des Medians der nächsten 4 Angebote, **und**
2. direkt darüber ist eine **echte Lücke**: Sie liegt **unter 80 %** des nächsten Angebots.

Höchstens zwei Durchgänge. Geprüft wird **pro Zeile**, nicht pro Stück – sonst würde sich
„3 Stück zum Lockpreis“ selbst tarnen.

> Beispiel: 50 € · 100 € · 101 € · 102 € → 50 € fliegt raus (Lücke zu 100 €).
> Beispiel: 27,40 € · 28,30 € · 33,18 € · 47,18 € … → nichts fliegt raus, denn 27,40 € und 28,30 € liegen
> dicht beieinander – das ist ein echter, günstiger Markt.
>
> Ein Angebot 20 % unter Markt bleibt drin: Das lässt sich nicht von einem echten guten Deal unterscheiden.

## Schritt 3 – In Einzelstücke aufteilen

Jede Zeile wird zu so vielen Stücken, wie ihre Menge angibt, und nach Preis sortiert –
**inkl. Versand** nach Gesamtpreis, **nur Artikel** nach Artikelpreis (zwei getrennte Rechnungen).

## Schritt 4 – Korbgröße K

K = 15 % von N (abgerundet), mindestens 1, höchstens 7.
N = alle gelisteten Stück vor jedem Filter.

| N (Stück am Markt) | 1–13 | 14–19 | 20–26 | 27–33 | 34–39 | 40–46 | ab 47 |
|---|---|---|---|---|---|---|---|
| K | 1 | 2 | 3 | 4 | 5 | 6 | 7 |

Der Korb sind die K günstigsten gültigen Stücke.

## Schritt 5 – Lückenschutz nach oben

Liegen mindestens die Hälfte der Stücke im Korb **höchstens 15 % über dem günstigsten Stück**, zählen nur
diese. So zieht ein einzelnes viel teureres Stück im Korb den Preis nicht nach oben.

## Schritt 6 – Ergebnis

**Fairer Preis = Median des Korbs** (bei gerader Anzahl der Mittelwert der beiden mittleren), auf Cent gerundet.

---

## Was die Website dazu zeigt

- **Verlässlichkeit:** „Reliable“ bei Korb ≥ 5 und ≥ 20 Stück am Markt, „Fair“ bei wenigen Angeboten,
  „Shaky“ bei sehr wenigen – dann ist der Preis praktisch das günstigste gültige Angebot.
- **Angebotstabelle:** mit dem Schalter „Show offers left out“ sieht man jedes aussortierte Angebot mit Grund.
- **Veränderungen** (1 Tag bis 1 Jahr) gibt es nur, wenn am Anfang **und** am Ende des Zeitraums ein Preis
  existiert – neue Produkte springen nicht „von 0 auf X“.

## Bekannte Grenzen

- Lockangebote ab etwa 25 % unter Markt mit klarer Lücke werden erkannt; ein einzelnes Angebot 20 % unter
  Markt bleibt bewusst drin.
- Sehr dünne Märkte (wenige Stück) haben K = 1: Der Preis ist dann das günstigste gültige Angebot.
- Der Wortfilter erkennt nur, was im Kommentar steht. Mängel, die nur auf Fotos zu sehen sind, erkennt er nicht.
