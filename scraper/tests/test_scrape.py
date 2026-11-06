"""Tests für den Scraper-Lauf mit einer simulierten Cardmarket-Sitzung (echte Beispielseiten, kein Netzwerk)."""

from __future__ import annotations

import base64
import gzip
import json
import time
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pandas as pd
import pytest

from cmtracker import scrape
from cmtracker.catalog import STATE_SCHEMA
from cmtracker.fetcher import Page
from cmtracker.parser import Offer
from cmtracker.settings import Category, Scope
from cmtracker.storage import LocalStorage, df_to_parquet, parquet_to_df

FIXTURES = Path(__file__).parent / "fixtures"
SCOPE = Scope(
    game_key="pokemon", game_name="Pokémon", cardmarket_game_id=6, cardmarket_path="Pokemon",
    categories=(Category(53, "Pokémon Display", "Booster-Boxes"),
                Category(1016, "Pokémon Elite Trainer Boxes", "Elite-Trainer-Boxes")),
    languages=("en", "de", "ja"), offers_to_store=50,
)
NOW = datetime(2026, 11, 6, 9, 0, tzinfo=timezone.utc)


def fixture(name: str) -> str:
    with gzip.open(FIXTURES / f"{name}.html.gz", "rt", encoding="utf-8") as fh:
        return fh.read()


# URL-Pfad -> Beispielseite je Sprachfilter
PAGES = {
    "Destined-Rivals-Booster-Box": {"1": "display_en", "3": "display_all"},
    "VSTAR-Universe-Booster-Box": {"1": "jp_ja", "7": "jp_ja"},
    "Aura-Seeker-Booster-Box-Case": {"1": "display_no_offers", "7": "display_no_offers"},
    "Champions-Path-10-Elite-Trainer-Box-Case": {"1": "url_etb_case", "3": "url_etb_case"},
}


class FakeSession:
    def __init__(self, blocked: bool = False):
        self.requests = 0
        self.blocked = blocked
        self.logins = 0
        self.ajax_calls = 0
        self.urls = []

    def ensure_login(self):
        self.logins += 1

    def login(self):
        self.logins += 1

    def _page(self, url: str) -> Page:
        self.requests += 1
        self.urls.append(url)
        if self.blocked:
            return Page(url, url, 403, "<title>Just a moment...</title>", "direct", 0.1)
        parts = urlsplit(url)
        slug = parts.path.rsplit("/", 1)[-1]
        lang = parse_qs(parts.query).get("language", ["1"])[0]
        name = PAGES.get(slug, {}).get(lang)
        if not name:
            return Page(url, url, 404, "<title>Nicht gefunden</title>", "direct", 0.1)
        return Page(url, url, 200, fixture(name), "direct", 0.1)

    def get(self, url):
        return self._page(url)

    def get_direct(self, url):
        return self._page(url)

    def post_ajax(self, url, data, referer):
        self.requests += 1
        self.ajax_calls += 1
        # Eine weitere Seite mit 2 neuen Angeboten, danach Ende
        if data["page"] == "1":
            row = ('<div class="row g-0 article-row" id="articleRow99000000{n}"><div class="col-offer">'
                   '<div class="price-container"><span class="color-primary small fw-bold">999,00 €</span>'
                   '<span class="fonticon-shipping-methods"></span><span class="ms-1">5,00 €</span></div>'
                   '<div class="amount-container"><span class="item-count">3</span></div></div></div>')
            rows = row.format(n=1) + row.format(n=2)
            return (f"<?xml version='1.0'?><r><rows>{base64.b64encode(rows.encode()).decode()}</rows>"
                    "<newPage>2</newPage><maxPaginatedResultsReached>0</maxPaginatedResultsReached></r>")
        return "<?xml version='1.0'?><r><rows></rows><newPage>0</newPage><maxPaginatedResultsReached>0</maxPaginatedResultsReached></r>"


def catalog_state(storage):
    rows = [
        (818574, "Destined Rivals Booster Box", 53, "Pokémon Display", True),
        (681796, "VSTAR Universe Booster Box", 53, "Pokémon Display", True),
        (918804, "Aura Seeker Booster Box Case", 53, "Pokémon Display", True),
        (690876, "Champion’s Path 10 Elite Trainer Box Case", 1016, "Pokémon Elite Trainer Boxes", True),
        (111111, "Nicht aktiv", 53, "Pokémon Display", False),
    ]
    df = pd.DataFrame([{
        "id_product": pid, "name": name, "id_category": cat, "category_name": cname, "id_expansion": 1,
        "id_metacard": 0, "cm_date_added": "2025-01-01", "first_seen": date(2026, 11, 5),
        "last_seen": date(2026, 11, 6), "removed_since": None, "in_scope": True, "has_offers": active,
        "active": active, "offerless_since": None,
    } for pid, name, cat, cname, active in rows], columns=STATE_SCHEMA.names)
    storage.put("catalog/pokemon/products.parquet", df_to_parquet(df, STATE_SCHEMA))


@pytest.fixture
def storage(tmp_path, monkeypatch):
    monkeypatch.setattr(scrape, "_pause", lambda: None)
    st = LocalStorage(tmp_path / "data")
    catalog_state(st)
    return st


def read(storage, table):
    files = sorted((Path(storage._root) / f"scrape/pokemon/{table}/date=2026-11-06").glob("*.parquet"))
    return pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)


def test_full_run(storage):
    session = FakeSession()
    res = scrape.run(SCOPE, storage, session, deadline=time.monotonic() + 600, now=NOW)

    assert res.products_total == 4 and res.products_done_now == 4
    assert not res.emergency and res.stopped_reason is None
    snaps = read(storage, "snapshots")
    by = {(r.id_product, r.language): r for r in snaps.itertuples()}
    # Display: EN und DE (Sprachen laut Filterformular), JA gibt es für das Produkt nicht
    assert set(k for k in by if k[0] == 818574) == {(818574, "en"), (818574, "de")}
    en = by[(818574, "en")]
    assert en.status == "ok" and en.offers_total == 52 and en.count_complete  # 50 + 2 nachgeladen
    assert en.available_items == 1355 and en.avg30 == 298.80
    # Japanisches Produkt: nur JA
    assert set(k for k in by if k[0] == 681796) == {(681796, "ja")}
    # Ohne Angebote
    assert by[(918804, "ja")].status == "no_offers"
    # Ein Angebot, kein Nachladen
    assert by[(690876, "en")].offers_total == 1

    offers = read(storage, "offers")
    en_offers = offers[(offers.id_product == 818574) & (offers.language == "en")]
    # Gespeichert: die 50 günstigsten nach Endpreis bzw. Artikelpreis; die zwei teuren nachgeladenen nicht
    assert len(en_offers) == 50 and 99900 not in set(en_offers.price_cents)
    assert en_offers.rank_total.min() == 1 and en_offers.rank_price.min() == 1

    counts = read(storage, "counts")
    en_counts = counts[(counts.id_product == 818574) & (counts.language == "en")]
    assert en_counts.offers.sum() == 52 and en_counts["items"].sum() == en.items_total

    meta = parquet_to_df(storage.get("catalog/pokemon/meta.parquet"))
    m = meta.set_index("id_product").loc[818574]
    assert m["name_de"] == "Ewige Rivalen Display" and "en" in list(m["languages"])
    assert m["image_url"].endswith("/53/818574/818574.jpg")

    # Tag vollständig -> eine Datei pro Tabelle
    for table in ("snapshots", "offers", "counts"):
        assert storage.list(f"scrape/pokemon/{table}/date=2026-11-06/") == [
            f"scrape/pokemon/{table}/date=2026-11-06/day.parquet"]

    progress = json.loads(storage.get("scrape/pokemon/progress/date=2026-11-06.json"))
    assert len(progress["products_done"]) == 4

    # Zweiter Start am selben Tag: nichts mehr zu tun
    again = scrape.run(SCOPE, storage, FakeSession(), deadline=time.monotonic() + 600, now=NOW)
    assert again.nothing_to_do
    assert "bereits alle" in scrape.summary_markdown(again, SCOPE)


def test_limit_and_resume(storage):
    res = scrape.run(SCOPE, storage, FakeSession(), deadline=time.monotonic() + 600, limit=2, now=NOW)
    assert res.products_done_now == 2 and "Limit" in res.stopped_reason
    rest = scrape.run(SCOPE, storage, FakeSession(), deadline=time.monotonic() + 600, now=NOW)
    assert rest.products_done_before == 2 and rest.products_done_now == 2 and rest.stopped_reason is None


def test_deadline_stops_cleanly(storage):
    res = scrape.run(SCOPE, storage, FakeSession(), deadline=time.monotonic() - 1, now=NOW)
    assert res.products_done_now == 0 and "Zeitlimit" in res.stopped_reason


def test_emergency_stop_when_blocked(storage):
    res = scrape.run(SCOPE, storage, FakeSession(blocked=True), deadline=time.monotonic() + 600, now=NOW)
    assert res.emergency and "blockiert" in res.stopped_reason
    assert "Notbremse" in scrape.summary_markdown(res, SCOPE)


def test_known_url_and_language_reused(storage):
    scrape.run(SCOPE, storage, FakeSession(), deadline=time.monotonic() + 600, now=NOW)
    # Nächster Tag: Sprachen sind bekannt, JP-Produkt wird direkt auf Japanisch geladen
    session = FakeSession()
    scrape.run(SCOPE, storage, session, deadline=time.monotonic() + 600,
               now=datetime(2026, 11, 7, 9, 0, tzinfo=timezone.utc))
    snaps = pd.concat([pd.read_parquet(f) for f in
                       (Path(storage._root) / "scrape/pokemon/snapshots/date=2026-11-07").glob("*.parquet")])
    jp = snaps[snaps.id_product == 681796]
    assert list(jp.language) == ["ja"]
    jp_urls = [u for u in session.urls if "VSTAR-Universe" in u]
    assert jp_urls and all("language=7" in u for u in jp_urls)  # keine Extra-Seite auf Englisch


def test_select_stored_offers_union():
    def offer(i, price, ship):
        return Offer(i, price, ship, 1, "en", "DE", "private", "good", 10, None)
    # Günstigster Artikelpreis hat hohen Versand -> taucht erst über die Artikelpreis-Liste auf
    offers = [offer(1, 1000, 100), offer(2, 1050, 100), offer(3, 900, 2000)]
    rows = scrape.select_stored_offers(offers, 1)
    assert {r["article_id"] for r in rows} == {1, 3}
    assert next(r for r in rows if r["article_id"] == 3)["rank_price"] == 1


def test_count_table_groups():
    offers = [Offer(1, 100, 0, 2, "en", "DE", "private", "good", 1, None),
              Offer(2, 100, 0, 5, "en", "DE", "private", "good", 1, None),
              Offer(3, 100, 0, 1, "en", "IT", "professional", "outstanding", 1, None)]
    table = scrape.count_table(offers)
    assert table[("DE", "private", "good")] == (2, 7)
    assert table[("IT", "professional", "outstanding")] == (1, 1)


def test_compaction_after_resumed_runs(storage):
    scrape.run(SCOPE, storage, FakeSession(), deadline=time.monotonic() + 600, limit=1, now=NOW)
    scrape.run(SCOPE, storage, FakeSession(), deadline=time.monotonic() + 600, limit=1,
               now=NOW.replace(hour=12))
    assert len(storage.list("scrape/pokemon/snapshots/date=2026-11-06/")) == 2  # Tag noch offen
    scrape.run(SCOPE, storage, FakeSession(), deadline=time.monotonic() + 600, now=NOW.replace(hour=15))
    files = storage.list("scrape/pokemon/snapshots/date=2026-11-06/")
    assert files == ["scrape/pokemon/snapshots/date=2026-11-06/day.parquet"]
    snaps = read(storage, "snapshots")
    assert snaps.groupby(["id_product", "language"]).size().max() == 1 and snaps.id_product.nunique() == 4


# --- Aufteilung bei mehr als 300 Angeboten -------------------------------------------------------

def _rows(ids, price="999,00 €"):
    row = ('<div class="row g-0 article-row" id="articleRow{n}"><div class="col-offer">'
           '<div class="price-container"><span class="color-primary small fw-bold">{p}</span>'
           '<span class="fonticon-shipping-methods"></span><span class="ms-1">5,00 €</span></div>'
           '<div class="amount-container"><span class="item-count">2</span></div></div></div>')
    return "".join(row.format(n=n, p=price) for n in ids)


class CappedSession(FakeSession):
    """Display auf EN hat 'mehr als 300' Angebote; Cardmarket übernimmt den Verkäufertyp-Filter."""

    def __init__(self, seller_filter_works=True):
        super().__init__()
        self.seller_filter_works = seller_filter_works

    def _page(self, url):
        page = super()._page(url)
        stype = parse_qs(urlsplit(url).query).get("sellerType")
        if stype and self.seller_filter_works:
            # echtes Format laut Live-Lauf: {"sellerStatus":[0],"idLanguage":{"1":1}}
            page.html = page.html.replace('{"idLanguage":{"1":1}}',
                                          '{"sellerStatus":[%s],"idLanguage":{"1":1}}' % stype[0])
        return page

    def post_ajax(self, url, data, referer):
        self.requests += 1
        fs = data["filterSettings"]
        if "sellerStatus" in fs:
            t = int(fs.split('"sellerStatus":[')[1][0])
            if data["page"] == "1":
                rows = _rows([800000000 + t * 10 + i for i in range(3)])
                return (f"<?xml version='1.0'?><r><rows>{base64.b64encode(rows.encode()).decode()}</rows>"
                        "<newPage>0</newPage><maxPaginatedResultsReached>0</maxPaginatedResultsReached></r>")
        if data["idProduct"] == "818574" and "sellerStatus" not in fs:
            rows = _rows([700000000 + int(data["page"]) * 100 + i for i in range(50)])
            if int(data["page"]) >= 5:  # 50 + 5x50 = 300 -> Grenze
                return (f"<?xml version='1.0'?><r><rows>{base64.b64encode(rows.encode()).decode()}</rows>"
                        "<newPage>0</newPage><maxPaginatedResultsReached>1</maxPaginatedResultsReached></r>")
            return (f"<?xml version='1.0'?><r><rows>{base64.b64encode(rows.encode()).decode()}</rows>"
                    f"<newPage>{int(data['page']) + 1}</newPage><maxPaginatedResultsReached>0</maxPaginatedResultsReached></r>")
        return "<?xml version='1.0'?><r><rows></rows><newPage>0</newPage><maxPaginatedResultsReached>0</maxPaginatedResultsReached></r>"


def test_split_by_seller_type_when_capped(storage):
    session = CappedSession()
    scrape.run(SCOPE, storage, session, deadline=time.monotonic() + 600, limit=2, now=NOW)
    snaps = read(storage, "snapshots")
    en = snaps[(snaps.id_product == 818574) & (snaps.language == "en")].iloc[0]
    assert en.count_complete and "Verkäufertyp" in en.note
    # 300 aus der Gesamtansicht + 3 je Verkäufertyp (Seite selbst liefert dieselben 50 wie vorher)
    assert en.offers_total == 300 + 9
    dr = [u for u in session.urls if "Destined-Rivals" in u]
    assert dr and all(u.count("language=") == 1 for u in dr)
    assert sum("sellerType=" in u and "language=1" in u for u in dr) == 3


def test_split_incomplete_when_filter_ignored(storage):
    scrape.run(SCOPE, storage, CappedSession(seller_filter_works=False), deadline=time.monotonic() + 600,
               limit=2, now=NOW)
    snaps = read(storage, "snapshots")
    en = snaps[(snaps.id_product == 818574) & (snaps.language == "en")].iloc[0]
    assert not en.count_complete and "nicht übernommen" in en.note


def test_scrape_review_excel(storage, tmp_path):
    from cmtracker import scrape_review

    res = scrape.run(SCOPE, storage, FakeSession(), deadline=time.monotonic() + 600, now=NOW)
    path = scrape_review.write_scrape_excel(res, SCOPE, storage, tmp_path / "out" / "r.xlsx")
    variants = pd.read_excel(path, sheet_name="Varianten")
    offers = pd.read_excel(path, sheet_name="Angebote")
    stock = pd.read_excel(path, sheet_name="Bestand nach Land")
    assert len(variants) == 6 and set(variants["Status"]) == {"ok", "keine Angebote"}
    en = variants[(variants["ID"] == 818574) & (variants["Sprache"] == "en")].iloc[0]
    assert en["Produkt"] == "Destined Rivals Booster Box" and en["günstigster Endpreis"] == 349.55
    assert len(offers[(offers["ID"] == 818574) & (offers["Sprache"] == "en")]) == 50
    assert stock["Stück"].sum() > 0
    md = scrape.summary_markdown(res, SCOPE)
    assert "?language=1?language" not in md


def test_direct_page_has_countries_and_seller_types():
    """Direkt abgerufene Seiten tragen Tooltips als title-Attribut (nicht aria-label)."""
    from cmtracker.parser import parse_product_page

    p = parse_product_page(fixture("direct_display_en"))
    assert all(o.seller_country for o in p.offers)
    assert {o.seller_type for o in p.offers} == {"private", "professional"}
    assert {o.language for o in p.offers} == {"en"}


def test_products_without_wanted_language_are_rechecked_weekly(storage):
    meta = {999: {"id_product": 999, "url": "https://www.cardmarket.com/de/Pokemon/Products/Booster-Boxes/X",
                  "url_source": "rule", "name_de": "X", "languages": ["id", "th"], "image_url": "",
                  "last_ok": None, "languages_checked": date(2026, 11, 4)}}
    keys = scrape.Keys("pokemon", date(2026, 11, 6))
    scrape.save_meta(storage, keys, meta)
    session = FakeSession()
    res = scrape.ScrapeResult("pokemon", keys.day, "r", 1, 0)
    ps = scrape.ProductScraper(SCOPE, session, storage, keys, "r", scrape.Recorder(storage, keys, "r"),
                               scrape.load_meta(storage, keys), res)
    ps.scrape_product({"id_product": 999, "name": "X", "id_category": 53})
    assert session.requests == 0 and "nächste Prüfung" in ps.rec.snapshots[0]["note"]
    ps.keys = scrape.Keys("pokemon", date(2026, 11, 12))  # 8 Tage später -> neu prüfen
    ps.scrape_product({"id_product": 999, "name": "X", "id_category": 53})
    assert session.requests >= 1
