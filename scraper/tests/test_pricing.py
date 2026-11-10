"""Tests für die Preislogik (config/pricing.yaml, cmtracker/pricing.py)."""

from __future__ import annotations

import copy
import json
import time
from datetime import date

import pytest
import yaml

from cmtracker import pricing, scrape
from cmtracker.pricing import Line, fair_price, load_pricing
from cmtracker.storage import LocalStorage, parquet_to_df

from test_scrape import NOW, SCOPE, FakeSession, catalog_state

CFG = load_pricing()


def L(price, shipping=0, qty=1, country="DE", comment=None):
    return Line(price=int(round(price * 100)), shipping=int(round(shipping * 100)), quantity=qty,
                country=country, comment=comment)


# --- Kommentarfilter --------------------------------------------------------------------------
@pytest.mark.parametrize("comment", [
    None, "", "SEALED No Damage", "No tears in seal", "no scratches, dents or holes", "no rips/dents",
    "Keine Dellen oder Kratzer", "keine sichtbaren Mängel", "ohne Beschädigung", "without any defect",
    "never opened", "unopened", "undamaged", "Schneller Versand in Luftpolsterfolie", "in Folie verpackt",
    "OVP Sealed in Brown Box!", "Sealed brown box", "Ovp Sealed in Cardboard", "Binder Collection sealed",
    "Bubble wrap", "damage-free", "dent free", "kratzerfrei", "Tear strip intact", "Manavortex ES",
    "New | OVP | Sealed | Fast shipping", "Factory sealed case", "clean seal no rips", "nothing missing",
    "not damaged", "nicht beschädigt",
])
def test_comment_ok(comment):
    assert CFG.comment_filter.reason(comment) is None, comment


@pytest.mark.parametrize("comment, category", [
    ("Loose foil - no holes", "B_"),
    ("small tear in front of seal", "B_"),
    ("sealed mit mini Loch an der Seite inkl. Pet Case", "A_"),
    ("Sealed. One with small hole on seal. One without.", "A_"),
    ("48H shipping - Has a tiny tear, feel free to ask for pictures.", "B_"),
    ("no damage, but small dent", "A_"),
    ("perfect for opening", "C_"),
    ("perfekt zum öffnen", "C_"),
    ("ohne Folie", "B_"),
    ("no shrink wrap", "B_"),
    ("Resealed", "B_"),
    ("re-sealed box", "B_"),
    ("leere Box", "C_"),
    ("promo missing", "C_"),
    ("not for collectors", "C_"),
    ("Dellen möglich", "A_"),
    ("not mint", "D_"),
    ("kann Lagerspuren aufweisen", "D_"),
    ("rough corners", "A_"),
    ("geöffnet", "C_"),
    ("DMG on corner", "A_"),
    ("ESP Sellado. Pequeño desperfecto en wrap", "A_"),
    ("SEALED con minuscolo taglio nella pellicola", "B_"),
    ("Sigillato/Sealed con piccola ammaccatura ad un solo angolo", "A_"),
    ("Slight gap in the seal on the side.", "B_"),
    ("difetto pellicola", "A_"),
    ("sealed, bit bent front of the box", "A_"),
    ("Sealed Binder Only", "C_"), ("BINDER ONLY", "C_"), ("Sealed Binder only!", "C_"), ("nur der Ordner", "C_"),
    ("Tin only, no boosters", "C_"),
])
def test_comment_rejected(comment, category):
    reason = CFG.comment_filter.reason(comment)
    assert reason and reason.startswith(category), (comment, reason)


# --- Schritte 2–6 ----------------------------------------------------------------------------
@pytest.mark.parametrize("n, k", [(2, 1), (5, 1), (12, 1), (14, 2), (18, 2), (20, 3), (30, 4), (35, 5),
                                  (44, 6), (47, 7), (500, 7)])
def test_basket_size(n, k):
    # N = Zahl der Angebote (Listungen), nicht der Stück
    r = fair_price([L(10)], 999, CFG, eu_only=True, listings=n)
    assert r.k == k


def test_always_a_price_when_something_survives_the_filters():
    for lines in ([L(100)], [L(10), L(100)], [L(1), L(100), L(100)]):
        r = fair_price(lines, 3, CFG, eu_only=True)
        assert r.status == "ok" and r.price_incl is not None and r.price_excl is not None


def test_no_price_when_everything_filtered():
    r = fair_price([L(10, country="CH"), L(11, comment="opened")], 2, CFG, eu_only=True)
    assert r.status == "alle_aussortiert" and r.price_incl is None
    assert r.removed_country == 1 and r.removed_comment == 1


def test_eu_switch():
    lines = [L(50, 5, country="CH"), L(60, 5, country="DE")]
    assert fair_price(lines, 2, CFG, eu_only=True).price_incl == 6500
    assert fair_price(lines, 2, CFG, eu_only=False).price_incl == 5500
    assert fair_price([L(50, country="JP")], 1, CFG, eu_only=True).status == "alle_aussortiert"


def test_lock_offer_removed_per_line_even_with_quantity():
    # Zeile 1: 3 Stück zum Lockpreis 40 (< 0,5 × 100) -> ganze Zeile weg
    lines = [L(40, qty=3), L(100), L(101), L(102), L(103), L(104)]
    r = fair_price(lines, 40, CFG, eu_only=True)
    assert r.removed_lock == 1 and r.price_incl >= 10000


def test_no_chain_reaction_in_staircase_market():
    # Echte Fälle (Gesamtpreise): früher wurden hier 6 bzw. 4 echte Angebote als Lockangebote entfernt
    ex1 = [L(t) for t in (27.40, 28.30, 33.18, 47.18, 47.19, 52.19, 74.07, 77.18, 77.18, 88.39, 103.87)]
    r = fair_price(ex1, 14, CFG, eu_only=True, listings=14)
    assert r.removed_lock == 0 and r.price_incl == 2785
    ex2 = [L(t) for t in (217.19, 257.19, 271.65, 312.65, 506.19, 522.65, 553.18)]
    r = fair_price(ex2, 10, CFG, eu_only=True, listings=10)
    assert r.removed_lock == 0 and r.price_incl == 21719


def test_single_and_double_bait_removed():
    r = fair_price([L(p) for p in (45, 100, 101, 102, 103)], 40, CFG, eu_only=True)
    assert r.removed_lock == 1 and r.price_incl >= 10000
    r = fair_price([L(p) for p in (45, 48, 100, 101, 102, 104)], 40, CFG, eu_only=True)
    assert r.removed_lock == 2 and r.price_incl >= 10000


def test_good_deals_from_screenshots_stay():
    # Echte Fälle (nur EU, gültige Gesamtpreise): 24–39 % unter dem Rest sind gute Deals, keine Köder
    for prices in ((21.39, 28.30, 28.62, 28.80, 28.81, 29.10),
                   (19.29, 26.17, 27.29, 35.85, 48.80),
                   (22.90, 33.87, 36.78, 42.37, 42.46, 48.39, 54.98, 60.06),
                   (26.18, 28.08, 45.98, 46.98, 47.94, 53.00, 56.97)):
        r = fair_price([L(p) for p in prices], 20, CFG, eu_only=True, listings=30)
        assert r.removed_lock == 0, prices
        assert r.price_incl == round(prices[0] * 100) or r.basket_incl_values[0] == round(prices[0] * 100)


def test_many_listings_skip_cheapest():
    prices = [50, 51, 52, 53, 54, 55, 56, 57]
    for listings, skip in ((100, 0), (101, 1), (200, 1), (201, 2), (300, 2), (301, 3)):
        r = fair_price([L(p) for p in prices], 1000, CFG, eu_only=True, listings=listings)
        assert r.removed_trim == skip, listings
        assert r.basket_incl_values[0] == prices[skip] * 100
        if skip:
            assert r.removed_lock == 0  # Kappung statt Lockangebot-Erkennung
    # Kappung zählt nur gültige Zeilen: aussortierte (Ausland, Kommentar) zählen nicht mit
    lines = [L(5, country="CH"), L(8, comment="dented box"), L(20), L(30), L(40)]
    r = fair_price(lines, 1000, CFG, eu_only=True, listings=150)
    assert r.removed_trim == 1 and r.basket_incl_values[0] == 3000
    # es bleibt immer ein Angebot
    r = fair_price([L(20), L(30)], 1000, CFG, eu_only=True, listings=400)
    assert r.removed_trim == 1 and r.price_incl == 3000


def test_each_offer_counts_once():
    # Händler mit 5 Stück zu 30 € bestimmt nicht allein den Preis (K = 7)
    lines = [L(30, qty=5), L(32), L(33), L(34), L(34.5), L(35), L(36)]
    r = fair_price(lines, 50, CFG, eu_only=True, listings=50)
    # Korb: 7 Angebote, nach Lückenschutz (bis +15 % über dem günstigsten) 5 – je Angebot ein Wert
    assert r.k == 7 and r.basket_incl_values == [3000, 3200, 3300, 3400, 3450]
    assert r.price_incl == 3300  # früher (je Stück): Korb 30,30,30,30,30,32,33 -> 30 €


def test_thin_market_keeps_real_offers():
    # Echter Fall (4 Angebote, alle in DE): die zwei günstigsten sind keine Lockangebote
    lines = [L(39900, 150, qty=2), L(45000, 150), L(59999.99, 150), L(69000, 150)]
    r = fair_price(lines, 5, CFG, eu_only=True)
    assert r.removed_lock == 0 and r.price_incl == 4005000
    # ein echter Köder fliegt auch im dünnen Markt raus
    r = fair_price([L(p) for p in (5000, 60000, 62000, 65000)], 4, CFG, eu_only=True)
    assert r.removed_lock == 1 and r.price_incl == 6000000


def test_good_deal_twenty_percent_below_stays():
    r = fair_price([L(p) for p in (80, 100, 101, 102)], 5, CFG, eu_only=True)
    assert r.removed_lock == 0 and r.price_incl == 8000


def test_at_most_two_rounds():
    # drei getrennte "Stufen" mit großen Lücken: nach 2 Durchgängen ist Schluss
    r = fair_price([L(p) for p in (10, 30, 100, 101, 102, 103, 104)], 40, CFG, eu_only=True)
    assert r.removed_lock == 2


def test_lock_check_stops_with_two_lines_left():
    r = fair_price([L(10), L(100)], 2, CFG, eu_only=True)
    assert r.removed_lock == 0 and r.price_incl == 1000


def test_gap_protection_and_median():
    # N=47 -> K=7; Korb 100,101,102,103,150,160,170: 4 von 7 liegen <= 115 -> Korb = eng -> Median 101,50 -> 101,50 €
    lines = [L(p) for p in (100, 101, 102, 103, 150, 160, 170, 180)]
    r = fair_price(lines, 47, CFG, eu_only=True, listings=47)
    assert r.basket_incl == 4 and r.price_incl == 10150
    # nur 3 von 7 eng -> Korb bleibt -> Median = 4. Wert
    lines = [L(p) for p in (100, 101, 102, 140, 150, 160, 170)]
    r = fair_price(lines, 47, CFG, eu_only=True, listings=47)
    assert r.basket_incl == 7 and r.price_incl == 14000


def test_incl_and_excl_sorted_separately():
    lines = [L(100, 20), L(110, 5), L(112, 5)]
    r = fair_price(lines, 2, CFG, eu_only=True)
    assert r.price_incl == 11500 and r.price_excl == 10000


# --- ganze Tage, Neuberechnung bei Logik-Änderung --------------------------------------------
@pytest.fixture
def storage(tmp_path, monkeypatch):
    monkeypatch.setattr(scrape, "_pause", lambda: None)
    monkeypatch.setattr(scrape, "_sleep", lambda seconds: None)
    st = LocalStorage(tmp_path / "data")
    catalog_state(st)
    scrape.run(SCOPE, st, FakeSession(), deadline=time.time() + 600, now=NOW)
    return st


def test_price_day_and_recompute_on_config_change(storage, tmp_path):
    day = date(2026, 11, 6)
    res = pricing.run(SCOPE, storage, CFG, today=day)
    assert res.days == [day] and res.recomputed_all and res.changes is None  # erste Berechnung: kein Vergleich
    df = parquet_to_df(storage.get(pricing.price_key("pokemon", day)))
    ok = df[(df.status == "ok") & ~df.eu_only]
    assert len(ok) > 0 and (ok.price_incl_cents >= ok.price_excl_cents).all()
    assert set(df.eu_only) == {True, False}

    # gleiche Logik: nur heute neu, keine Komplett-Neuberechnung
    assert not pricing.run(SCOPE, storage, CFG, today=day).recomputed_all

    # Logik geändert (z. B. share in pricing.yaml) -> alles neu
    raw = copy.deepcopy(CFG.raw)
    raw["basket"]["share"] = 0.2
    path = tmp_path / "pricing.yaml"
    path.write_text(yaml.safe_dump(raw, allow_unicode=True), encoding="utf-8")
    cfg2 = load_pricing(path)
    assert cfg2.logic_hash != CFG.logic_hash
    res2 = pricing.run(SCOPE, storage, cfg2, today=day)
    assert res2.recomputed_all
    # Vergleich alt/neu für die Mail
    assert res2.changes and "alte gegen neue Logik" in res2.changes and "Varianten mit Preis" in res2.changes
    meta = json.loads(storage.get("prices/pokemon/_meta.json"))
    assert meta["logic_hash"] == cfg2.logic_hash


def test_price_command_writes_review_excel(storage, tmp_path, monkeypatch):
    from openpyxl import load_workbook

    from cmtracker import __main__ as cli

    for k in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path / "data"))
    out = tmp_path / "out"
    assert cli.main(["price", "--day", "2026-11-06", "--out", str(out), "--publish-review"]) == 0
    xlsx = out / "preise_review_pokemon_2026-11-06.xlsx"
    wb = load_workbook(xlsx)
    assert wb.sheetnames == ["Übersicht", "Preise", "Aussortiert (Kommentar)", "Lockangebote"]
    rows = list(wb["Preise"].iter_rows(values_only=True))
    assert rows[0][:3] == ("ID", "Produkt", "Sprache") and len(rows) > 1
    assert any(k.endswith("preise_review_pokemon_2026-11-06.xlsx") for k in storage.list("review/"))


def test_bait_check_looks_at_all_countries():
    # Echter Fall (10.11.2026): das günstige DE-Angebot liegt neben GB/CH-Angeboten – kein Lockangebot.
    # Früher (Prüfung erst nach dem EU-Filter) wurde es entfernt und der EU-Preis lag bei 220,90 statt 93,69.
    lines = [L(85, 8.69, country="DE", comment="Geschäftsaufgabe"), L(70, 24.30, qty=2, country="GB"),
             L(59.99, 34.88, qty=6, country="CH"), L(199, 21.90, country="AT"), L(200, 21.90, country="AT")]
    eu = fair_price(lines, 11, CFG, eu_only=True)
    assert eu.removed_lock == 0 and eu.price_incl == 9369
    assert fair_price(lines, 11, CFG, eu_only=False).price_incl == 9369


def test_bait_without_cheap_neighbours_anywhere_still_removed():
    lines = [L(40, 5, country="DE"), L(100, 5, country="GB"), L(101, 5, country="FR"), L(102, 5, country="AT"),
             L(103, 5, country="IT")]
    eu = fair_price(lines, 30, CFG, eu_only=True)
    assert eu.removed_lock == 1 and eu.price_incl >= 10500
    # Lockangebot außerhalb der EU: zählt in der EU-Ansicht nicht als "entfernt", fehlt aber in beiden
    lines = [L(40, 5, country="CH"), L(100, 5), L(101, 5), L(102, 5), L(103, 5)]
    assert fair_price(lines, 30, CFG, eu_only=True).removed_lock == 0
    assert fair_price(lines, 30, CFG, eu_only=False).removed_lock == 1


def test_basket_size_follows_offers_not_pieces():
    # Echter Fall (Generic Level Ball Tin EN, 10.11.2026): 21 Stück bei einem Händler zu 90,18 €.
    # Früher K aus 23 Stück = 3 -> Median der 3 Angebote = 172,90 €. Jetzt K aus 3 Angeboten = 1 -> 90,18 €.
    lines = [L(82.99, 7.19, qty=21, country="DE"), L(149, 23.90, country="FI"), L(160, 22.65, country="BE")]
    r = fair_price(lines, 23, CFG, eu_only=True, listings=3)
    assert r.k == 1 and r.price_incl == 9018


def test_compare_prices_text():
    import pandas as pd
    old = pd.DataFrame({"eu_only": [True, True, True, False], "id_product": [1, 2, 3, 1], "language": ["en"] * 4,
                        "price_incl_cents": [22090, 10000, 5000, 9369]})
    new = old.copy()
    new.loc[0, "price_incl_cents"] = 9369
    new.loc[2, "price_incl_cents"] = None
    text = pricing.compare_prices(old, new, {1: "Box A"}, date(2026, 11, 10))
    assert "2 Varianten mit Preis vorher und nachher, davon 1 geändert, 1 um mehr als 20 %" in text
    assert "ohne Preis: 1" in text and "Box A (EN, ID 1): 220,90 € → 93,69 € (-58 %)" in text
