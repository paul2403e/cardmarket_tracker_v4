"""Parser-Tests mit echten Cardmarket-Seiten (Erkundung vom 05.11.2026, Verkäufernamen anonymisiert)."""

from __future__ import annotations

import base64
import gzip
from pathlib import Path

import pytest

from cmtracker.parser import (ParseError, parse_load_more_response, parse_money, parse_product_page)

FIXTURES = Path(__file__).parent / "fixtures"


def page(name: str):
    with gzip.open(FIXTURES / f"{name}.html.gz", "rt", encoding="utf-8") as fh:
        return fh.read()


def test_parse_money():
    assert parse_money("2.050,00 €") == 205000
    assert parse_money("330,00 €") == 33000
    assert parse_money("15.000,00 €") == 1500000
    assert parse_money("N/A") is None
    assert parse_money("") is None


def test_display_english():
    p = parse_product_page(page("display_en"))
    assert p.id_product == 818574
    assert p.name_de == "Ewige Rivalen Display"
    assert p.available_items == 1355
    assert (p.trend, p.avg30, p.avg7, p.avg1) == (288.07, 298.80, 293.85, 213.26)
    assert p.languages == ["en", "fr", "de", "es", "it", "pt"]
    assert len(p.offers) == 50 and not p.warnings
    assert all(o.language == "en" for o in p.offers)
    first = p.offers[0]
    assert (first.article_id, first.price_cents, first.shipping_cents, first.quantity) == (2187527630, 33000, 1955, 1)
    assert first.seller_country == "NL" and first.seller_rating == "none"
    assert first.comment == "small tear in front of seal"
    # Cardmarket sortiert nach Endpreis inkl. Versand
    totals = [o.price_cents + (o.shipping_cents or 0) for o in p.offers]
    assert totals == sorted(totals)
    assert p.load_more is not None and p.load_more.page == 1 and p.load_more.id_product == 818574
    assert '"idLanguage"' in p.load_more.filter_settings


def test_seller_types_and_languages_unfiltered():
    p = parse_product_page(page("display_all"))
    types = {o.seller_type for o in p.offers}
    assert types == {"private", "professional", "powerseller"}
    assert {o.language for o in p.offers} <= {"en", "fr", "de", "es", "it", "pt"}
    assert {o.seller_rating for o in p.offers} <= {"outstanding", "very_good", "good", "average", "bad", "none"}
    assert all(o.seller_country and len(o.seller_country) == 2 for o in p.offers)


def test_price_with_tracking_icon_and_quantity():
    p = parse_product_page(page("jp_ja"))
    assert p.languages[0] == "ja" and "en" not in p.languages
    big = next(o for o in p.offers if o.quantity == 20)
    assert big.price_cents == 16370 and big.shipping_cents == 495


def test_no_offers_page():
    p = parse_product_page(page("display_no_offers"))
    assert p.no_offers and p.offers == [] and p.load_more is None
    assert p.available_items == 0 and p.avg30 is None


def test_single_offer_without_load_more():
    p = parse_product_page(page("url_etb_case"))
    assert p.id_product == 690876 and len(p.offers) == 1 and p.load_more is None
    assert p.offers[0].price_cents == 1500000


def test_load_more_response():
    html = page("display_en")
    start = html.index('<div class="row g-0 article-row"')
    rows = html[start:start + 40000]
    b64 = base64.b64encode(rows.encode("utf-8")).decode()
    xml = f"<?xml version='1.0'?><response><rows>{b64}</rows><newPage>2</newPage>" \
          f"<maxPaginatedResultsReached>0</maxPaginatedResultsReached></response>"
    res = parse_load_more_response(xml)
    assert res.new_page == 2 and not res.max_reached and len(res.offers) >= 3
    end = parse_load_more_response("<response><rows></rows><newPage>0</newPage>"
                                   "<maxPaginatedResultsReached>1</maxPaginatedResultsReached></response>")
    assert end.offers == [] and end.new_page == 0 and end.max_reached
    with pytest.raises(ParseError):
        parse_load_more_response("<html>Just a moment</html")


def test_image_url_from_page_keeps_real_extension():
    # Cardmarket speichert manche Bilder als .png – die Adresse kommt aus der Seite, nicht aus einer Vermutung
    assert parse_product_page(page("jp_ja")).image_url == "https://product-images.s3.cardmarket.com/53/681796/681796.png"
    assert parse_product_page(page("display_en")).image_url.endswith("/818574/818574.jpg")
    assert parse_product_page("<html><body></body></html>").image_url is None
