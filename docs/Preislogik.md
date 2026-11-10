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
  und die **Listungen**: wie viele Angebote es gibt (Menge egal) – beides vor jedem Filter, alle Länder;
- **die günstigsten Angebote im Detail** (je 50 nach Gesamtpreis und nach Artikelpreis): Preis, Versand,
  Menge, Land, Verkäufer, Kommentar im Volltext.

## Schritt 1 – Ungültige Angebote aussortieren

Ein Angebot zählt nicht, wenn …

- **das Land nicht passt:** Bei „EU only“ zählen nur Verkäufer aus den 27 EU-Ländern (kein Zoll).
  Schweiz, Großbritannien, Norwegen usw. fallen dann raus. **Wichtig:** Der Länderfilter greift erst **nach**
  der Prüfung auf Lockangebote (Schritt 2) – siehe dort.
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

## Schritt 2 – Ausreißer nach unten entfernen

Sortiert wird nach Gesamtpreis inkl. Versand. Was passiert, hängt von der Zahl der **Listungen** ab
(Angebote auf Cardmarket, alle Länder, vor jedem Filter – nicht die Stückzahl):

**Über 100 Listungen – feste Kappung.** Die günstigsten **gültigen** Angebote (nach Schritt 1) zählen nicht:

| Listungen | über 100 | über 200 | über 300 |
|---|---|---|---|
| günstigste Angebote, die nicht zählen | 1 | 2 | 3 |

Ein gekapptes Angebot zählt komplett nicht, egal wie viele Stück es hat. Es bleibt immer mindestens ein Angebot.

**Bis 100 Listungen – nur klare Lockangebote.** Die günstigste Zeile – oder die zwei günstigsten zusammen –
fliegt raus, wenn **beides** gilt:

1. Sie liegt **unter 50 %** des Medians der nächsten 4 Angebote, **und**
2. direkt darüber ist eine **echte Lücke**: Sie liegt **unter 80 %** des nächsten Angebots.

Höchstens zwei Durchgänge. Geprüft wird **pro Zeile**, nicht pro Stück, und **über alle Länder** (vor dem
EU-Filter): Ein günstiges EU-Angebot ist kein Lockangebot, wenn es außerhalb der EU ähnlich günstige Angebote
gibt. Was als Lockangebot erkannt wird, zählt weder bei „EU only“ noch bei „alle Länder“.

> Echter Fall: 93,69 € (DE) · 94,30 € (GB) · 94,87 € (CH) · 220,90 € (AT) · 221,90 € (AT). Früher wurde bei
> „EU only“ zuerst GB/CH entfernt – dann sah 93,69 € neben 220,90 € wie ein Köder aus und der EU-Preis lag bei
> 220,90 €. Jetzt bleibt 93,69 € drin.

> Gute Deals bleiben drin: 21,39 € · 28,30 € · 28,62 € · 28,80 € … (−24 %) oder
> 22,90 € · 33,87 € · 36,78 € · 42,37 € (−32 %) → nichts fliegt raus.
> Klare Köder fliegen raus: 15 € · 40 € · 41 € · 42 € oder 5.000 € · 60.000 € · 62.000 € · 65.000 €.

## Schritt 3 – Jedes Angebot zählt einmal

Jede gültige Zeile zählt **genau einmal**, egal wie viele Stück sie hat – sortiert **inkl. Versand** nach
Gesamtpreis und **nur Artikel** nach Artikelpreis (zwei getrennte Rechnungen). So bestimmt ein Händler mit
5 Stück nicht allein den Preis.

## Schritt 4 – Korbgröße K

K = 15 % von N (abgerundet), mindestens 1, höchstens 7.
N = alle **Angebote** (Listungen) vor jedem Filter, alle Länder – **nicht die Stückzahl**. Im Korb zählt jedes
Angebot einmal (Schritt 3), also richtet sich auch die Korbgröße nach Angeboten.

> Echter Fall: 90,18 € (21 Stück) · 172,90 € · 182,65 €. Früher: 23 Stück → K = 3 → Median der drei = 172,90 €,
> obwohl jeder 21 Stück für 90,18 € kaufen kann. Jetzt: 3 Angebote → K = 1 → 90,18 €.

| N (Angebote am Markt) | 1–13 | 14–19 | 20–26 | 27–33 | 34–39 | 40–46 | ab 47 |
|---|---|---|---|---|---|---|---|
| K | 1 | 2 | 3 | 4 | 5 | 6 | 7 |

Der Korb sind die K günstigsten gültigen Angebote (je Angebot ein Wert, siehe Schritt 3).

## Schritt 5 – Lückenschutz nach oben

Liegen mindestens die Hälfte der Angebote im Korb **höchstens 15 % über dem günstigsten**, zählen nur
diese. So zieht ein einzelnes viel teureres Angebot im Korb den Preis nicht nach oben.

## Schritt 6 – Ergebnis

**Fairer Preis = Median des Korbs** (bei gerader Anzahl der Mittelwert der beiden mittleren), auf Cent gerundet.

---

## Was die Website dazu zeigt

- **Verlässlichkeit** nach der Zahl **aller Angebote** auf Cardmarket in dieser Sprache (alle Länder, vor jedem
  Filter – also auch Nicht-EU und Beschädigtes): „Reliable“ ab 50, „Fair“ 10–49, „Shaky“ 2–9, „Single offer“ bei
  genau einem, „No price“ ohne Preis. Im Portfolio (Analysis) gibt es dazu eine Übersicht der eigenen Bestände.
- **Angebotstabelle:** mit dem Schalter „Show offers left out“ sieht man jedes aussortierte Angebot mit Grund.
- **Veränderungen** (1 Tag bis 1 Jahr) gibt es nur, wenn am Anfang **und** am Ende des Zeitraums ein Preis
  existiert – neue Produkte springen nicht „von 0 auf X“.

## Bekannte Grenzen

- Bis 100 Listungen werden nur klare Lockangebote (mehr als 50 % unter Markt) erkannt; gute Deals 20–40 % unter
  Markt bleiben bewusst drin. Darüber zählen die 1–3 günstigsten Angebote nie mit.
- Sehr dünne Märkte (wenige Stück) haben K = 1: Der Preis ist dann das günstigste gültige Angebot.
- Der Wortfilter erkennt nur, was im Kommentar steht. Mängel, die nur auf Fotos zu sehen sind, erkennt er nicht.
