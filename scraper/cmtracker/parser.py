"""Parser für Cardmarket-Produktseiten (deutsche Seiten) und die Antworten von "Zeige mehr Angebote".

Aufgebaut an echten Seiten aus der Erkundung vom 05.11.2026. Ändert Cardmarket das Layout,
schlagen die Tests mit den gespeicherten Beispielseiten fehl bzw. der Lauf meldet parse_error.
"""

from __future__ import annotations

import base64
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

from bs4 import BeautifulSoup, Tag

from .cardmarket import COUNTRY_CODES_DE, LANGUAGE_BY_ID, LANGUAGE_NAMES_DE

PARSER_VERSION = "1"

NO_OFFERS_TEXT = "Für diesen Artikel gibt es aktuell leider keine Angebote"

RATINGS = {
    "outstanding": "outstanding", "very-good": "very_good", "good": "good",
    "average": "average", "bad": "bad", "none": "none",
}


class ParseError(RuntimeError):
    pass


@dataclass
class Offer:
    article_id: int
    price_cents: int
    shipping_cents: int | None
    quantity: int
    language: str | None
    seller_country: str | None
    seller_type: str          # private | professional | powerseller
    seller_rating: str | None
    seller_sales: int | None
    comment: str | None


@dataclass
class LoadMore:
    token: str
    page: int
    filter_settings: str
    id_product: int


@dataclass
class ProductPage:
    id_product: int | None
    name_de: str | None
    available_items: int | None       # "Verfügbare Artikel" (alle Sprachen, Stückzahl)
    trend: float | None
    avg30: float | None
    avg7: float | None
    avg1: float | None
    languages: list[str]              # Sprachen, die Cardmarket für das Produkt führt
    seller_country_ids: list[int]     # Länder im Filterformular (für die Aufteilung bei >300 Angeboten)
    offers: list[Offer]
    load_more: LoadMore | None
    no_offers: bool
    logged_in_hint: bool
    raw_title: str = ""
    warnings: list[str] = field(default_factory=list)


@dataclass
class LoadMoreResult:
    offers: list[Offer]
    new_page: int                     # 0 = keine weiteren Seiten
    max_reached: bool                 # Cardmarket-Grenze von 300 Angeboten erreicht


def parse_money(text: str | None) -> int | None:
    """'2.050,00 €' -> 205000 (Cent). 'N/A' oder leer -> None."""
    if not text:
        return None
    m = re.search(r"(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})", text)
    if not m:
        return None
    return int(m.group(1).replace(".", "")) * 100 + int(m.group(2))


def parse_euro(text: str | None) -> float | None:
    cents = parse_money(text)
    return None if cents is None else cents / 100


def parse_int(text: str | None) -> int | None:
    if not text:
        return None
    digits = re.sub(r"[^\d]", "", text)
    return int(digits) if digits else None


def _label(tag: Tag | None) -> str | None:
    if tag is None:
        return None
    return tag.get("aria-label") or tag.get("data-bs-original-title")


def parse_offer_row(row: Tag) -> Offer | None:
    m = re.match(r"articleRow(\d+)", row.get("id") or "")
    if not m:
        return None
    container = row.select_one(".col-offer .price-container") or row.select_one(".price-container")
    if container is None:
        return None
    price_tag = container.select_one("span.color-primary.fw-bold")
    price = parse_money(price_tag.get_text() if price_tag else None)
    if price is None:
        return None
    ship_icon = container.select_one(".fonticon-shipping-methods")
    ship_tag = ship_icon.find_next_sibling("span") if ship_icon else None
    shipping = parse_money(ship_tag.get_text() if ship_tag else None)

    qty_tag = row.select_one(".col-offer .amount-container .item-count") or row.select_one(".item-count")
    quantity = parse_int(qty_tag.get_text() if qty_tag else None) or 1

    lang_label = _label(row.select_one(".product-attributes [aria-label]"))
    language = LANGUAGE_NAMES_DE.get(lang_label, lang_label.lower() if lang_label else None)

    country = None
    loc = row.select_one(".seller-name [aria-label^='Artikelstandort']")
    if loc is not None:
        name = _label(loc).split(":", 1)[-1].strip()
        country = COUNTRY_CODES_DE.get(name, name)

    seller_type = "private"
    for badge in row.select(".seller-name [aria-label], .seller-name [data-bs-original-title]"):
        text = (_label(badge) or "").lower()
        if "powerseller" in text:
            seller_type = "powerseller"
            break
        if "gewerblich" in text:
            seller_type = "professional"

    rating = None
    rating_tag = row.select_one("[class*='fonticon-seller-rating-']")
    if rating_tag is not None:
        cls = next((c for c in rating_tag.get("class", []) if c.startswith("fonticon-seller-rating-")), "")
        rating = RATINGS.get(cls.removeprefix("fonticon-seller-rating-"))

    sales_tag = row.select_one(".sell-count")
    sales = parse_int(sales_tag.get_text() if sales_tag else None)

    comment_tag = row.select_one(".product-comments .text-truncate")
    comment = comment_tag.get_text(" ", strip=True) if comment_tag else None

    return Offer(
        article_id=int(m.group(1)),
        price_cents=price,
        shipping_cents=shipping,
        quantity=quantity,
        language=language,
        seller_country=country,
        seller_type=seller_type,
        seller_rating=rating,
        seller_sales=sales,
        comment=comment or None,
    )


def parse_offer_rows(soup: BeautifulSoup | Tag) -> tuple[list[Offer], int]:
    """Alle Angebotszeilen; zweiter Wert = Zeilen, die nicht gelesen werden konnten."""
    offers, failed, seen = [], 0, set()
    for row in soup.select("div[id^='articleRow']"):
        offer = parse_offer_row(row)
        if offer is None:
            failed += 1
            continue
        if offer.article_id in seen:
            continue
        seen.add(offer.article_id)
        offers.append(offer)
    return offers, failed


def parse_product_page(html: str) -> ProductPage:
    soup = BeautifulSoup(html, "html.parser")
    warnings: list[str] = []

    id_product = None
    id_input = soup.select_one("#FilterForm input[name='idProduct']") or soup.select_one("input[name='idProduct']")
    if id_input is not None and (id_input.get("value") or "").isdigit():
        id_product = int(id_input["value"])

    info: dict[str, str] = {}
    for dt in soup.select("dl dt"):
        dd = dt.find_next_sibling("dd")
        if dd is not None:
            info[dt.get_text(" ", strip=True)] = dd.get_text(" ", strip=True)

    title_tag = soup.find("title")
    raw_title = title_tag.get_text(strip=True) if title_tag else ""
    name_de = raw_title.removesuffix("| Cardmarket").strip() or None

    languages, countries = [], []
    form = soup.find("form", id="FilterForm")
    if form is not None:
        for inp in form.select("input[name^='language[']"):
            m = re.match(r"language\[(\d+)\]", inp.get("name", ""))
            if m:
                languages.append(LANGUAGE_BY_ID.get(int(m.group(1)), f"id{m.group(1)}"))
        for inp in form.select("input[name^='sellerCountry[']"):
            m = re.match(r"sellerCountry\[(\d+)\]", inp.get("name", ""))
            if m:
                countries.append(int(m.group(1)))

    offers, failed = parse_offer_rows(soup)
    if failed:
        warnings.append(f"{failed} Angebotszeilen nicht lesbar")

    load_more = None
    lm_form = soup.select_one("#loadMore form[data-ajax-action='Product_LoadMoreArticles']")
    if lm_form is not None:
        def val(name: str) -> str:
            tag = lm_form.select_one(f"input[name='{name}']")
            return (tag.get("value") or "") if tag else ""
        if val("page").isdigit() and val("idProduct").isdigit():
            load_more = LoadMore(token=val("__cmtkn"), page=int(val("page")),
                                 filter_settings=val("filterSettings"), id_product=int(val("idProduct")))

    return ProductPage(
        id_product=id_product,
        name_de=name_de,
        available_items=parse_int(info.get("Verfügbare Artikel")),
        trend=parse_euro(info.get("Preis-Trend")),
        avg30=parse_euro(info.get("30-Tages-Durchschnitt")),
        avg7=parse_euro(info.get("7-Tages-Durchschnitt")),
        avg1=parse_euro(info.get("1-Tages-Durchschnitt")),
        languages=languages,
        seller_country_ids=countries,
        offers=offers,
        load_more=load_more,
        no_offers=NO_OFFERS_TEXT in html,
        logged_in_hint=bool(re.search(r"Abmelden|Logout|PostGetAction/User_Logout", html)),
        raw_title=raw_title,
        warnings=warnings,
    )


def parse_load_more_response(xml_text: str) -> LoadMoreResult:
    """Antwort von AjaxAction/Product_LoadMoreArticles: XML mit base64-kodierten Angebotszeilen."""
    try:
        root = ET.fromstring(xml_text.strip())
    except ET.ParseError as err:
        raise ParseError(f"Nachlade-Antwort ist kein XML: {xml_text[:200]!r}") from err

    def text_of(tag: str) -> str:
        el = root.find(f".//{tag}")
        return "".join(el.itertext()).strip() if el is not None else ""

    rows_b64 = text_of("rows")
    rows_html = base64.b64decode(rows_b64).decode("utf-8", errors="replace") if rows_b64 else ""
    offers, _ = parse_offer_rows(BeautifulSoup(rows_html, "html.parser")) if rows_html else ([], 0)
    return LoadMoreResult(
        offers=offers,
        new_page=int(text_of("newPage") or 0),
        max_reached=int(text_of("maxPaginatedResultsReached") or 0) > 0,
    )
