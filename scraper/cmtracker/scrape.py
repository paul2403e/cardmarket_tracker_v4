"""Meilenstein 2: Täglicher Scrape aller aktiven Produkte (Angebote, Preise, Bestand).

Pro Produkt und Sprache (EN, DE, JA – sofern Cardmarket die Sprache führt):
1. Produktseite mit Sprachfilter laden (direkt, bei Cloudflare-Prüfung über FlareSolverr).
2. Über "Zeige mehr Angebote" alle Angebote nachladen (Cardmarket zeigt höchstens 300 pro Ansicht;
   darüber wird nach Verkäufertyp und notfalls nach Land aufgeteilt).
3. Snapshot (Infobox, Status, Summen), Zähltabelle (alle Angebote) und die günstigsten Angebote speichern.

Der Lauf merkt sich, welche Produkte heute erledigt sind, und hört nach seinem Zeitbudget
sauber auf; der nächste Termin macht dort weiter. Notbremse bei Sperre oder Fehlerserie.
"""

from __future__ import annotations

import gzip
import json
import random
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any, Protocol
from urllib.parse import urlsplit

import pandas as pd
import pyarrow as pa
from bs4 import BeautifulSoup

from . import cardmarket
from .discovery import redact
from .fetcher import FetchError, LoginError, Page, is_challenge_error, looks_like_challenge
from .parser import PARSER_VERSION, Offer, ParseError, ProductPage, parse_load_more_response, parse_product_page
from .settings import Scope
from .sources import BERLIN
from .storage import Storage, df_to_parquet, parquet_to_df

MAX_ROWS_PER_VIEW = 300          # Cardmarket-Grenze pro Filteransicht
MAX_CONSECUTIVE_ERRORS = 10      # Notbremse
# Tempo – Standardwerte; überschrieben durch "pace" in config/monitoring.yaml (configure_pace)
PAUSE_RANGE_S = (1.0, 2.0)       # Pause vor jedem Abruf (zufällig im Bereich)
COOLDOWN_MIN = 30                # Abkühlpause, wenn Cardmarket eine Prüfung zeigt, die FlareSolverr nicht löst
MAX_COOLDOWNS = 3                # danach Notbremse
SLOWDOWN_STEP = 1.5              # nach jeder Abkühlpause werden die Pausen so viel länger
FLUSH_EVERY_PRODUCTS = 200       # Zwischenspeichern
MAX_FAILED_PAGES_SAVED = 20      # HTML von Fehlerseiten zur Fehlersuche (pro Lauf)
SELLER_TYPES = {0: "private", 1: "professional", 2: "powerseller"}

# Status pro Variante
OK, NO_OFFERS, FETCH_ERROR, PARSE_ERROR, NOT_FOUND = "ok", "no_offers", "fetch_error", "parse_error", "not_found"

SNAPSHOT_SCHEMA = pa.schema([
    ("run_id", pa.string()), ("scraped_at", pa.timestamp("s", tz="UTC")), ("id_product", pa.int64()),
    ("language", pa.string()), ("status", pa.string()), ("http_status", pa.int32()), ("url", pa.string()),
    ("url_changed", pa.bool_()), ("available_items", pa.int32()), ("trend", pa.float64()),
    ("avg30", pa.float64()), ("avg7", pa.float64()), ("avg1", pa.float64()),
    ("offers_total", pa.int32()), ("items_total", pa.int32()), ("count_complete", pa.bool_()),
    ("offers_stored", pa.int32()), ("offers_wrong_language", pa.int32()),
    ("requests", pa.int32()), ("duration_ms", pa.int32()),
    ("parser_version", pa.string()), ("note", pa.string()),
])
OFFER_SCHEMA = pa.schema([
    ("run_id", pa.string()), ("id_product", pa.int64()), ("language", pa.string()),
    ("rank_total", pa.int32()), ("rank_price", pa.int32()), ("article_id", pa.int64()),
    ("price_cents", pa.int32()), ("shipping_cents", pa.int32()), ("quantity", pa.int32()),
    ("seller_country", pa.string()), ("seller_type", pa.string()), ("seller_rating", pa.string()),
    ("seller_sales", pa.int32()), ("comment", pa.string()),
])
COUNT_SCHEMA = pa.schema([
    ("run_id", pa.string()), ("id_product", pa.int64()), ("language", pa.string()),
    ("seller_country", pa.string()), ("seller_type", pa.string()), ("seller_rating", pa.string()),
    ("offers", pa.int32()), ("items", pa.int32()),
])
META_SCHEMA = pa.schema([
    ("id_product", pa.int64()), ("url", pa.string()), ("url_source", pa.string()), ("name_de", pa.string()),
    ("languages", pa.list_(pa.string())), ("image_url", pa.string()), ("last_ok", pa.date32()),
    ("languages_checked", pa.date32()),
])


class Session(Protocol):
    requests: int
    def ensure_login(self) -> None: ...
    def login(self) -> None: ...
    def get(self, url: str) -> Page: ...
    def get_direct(self, url: str) -> Page: ...
    def post_ajax(self, url: str, data: dict[str, str], referer: str) -> str: ...


class EmergencyStop(RuntimeError):
    """Notbremse: Sperre, Captcha, verlorener Login oder Fehlerserie."""


class DeadlineReached(RuntimeError):
    """Zeitbudget endet während einer Abkühlpause – sauber aufhören, der nächste Lauf macht weiter."""


@dataclass
class Keys:
    game: str
    day: date

    def day_prefix(self, table: str) -> str:
        return f"scrape/{self.game}/{table}/date={self.day.isoformat()}/"

    def part(self, table: str, run_id: str, n: int) -> str:
        return f"{self.day_prefix(table)}part-{run_id}-{n:03d}.parquet"

    def day_file(self, table: str) -> str:
        return f"{self.day_prefix(table)}day.parquet"

    @property
    def progress(self) -> str:
        return f"scrape/{self.game}/progress/date={self.day.isoformat()}.json"

    @property
    def meta(self) -> str:
        return f"catalog/{self.game}/meta.parquet"

    @property
    def catalog_state(self) -> str:
        return f"catalog/{self.game}/products.parquet"

    def failed_page(self, id_product: int, language: str | None) -> str:
        return f"debug/{self.game}/failed/date={self.day.isoformat()}/{id_product}-{language or 'all'}.html.gz"


@dataclass
class ScrapeResult:
    game: str
    day: date
    run_id: str
    products_total: int
    products_done_before: int
    products_done_now: int = 0
    status_counts: Counter = field(default_factory=Counter)
    url_changes: list[str] = field(default_factory=list)
    no_language: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    samples: list[dict] = field(default_factory=list)
    requests: int = 0
    fallbacks: int = 0
    seconds: float = 0.0
    day_complete: bool = False
    stopped_reason: str | None = None   # None = Tag vollständig; sonst Zeitlimit/Notbremse/Limit
    emergency: bool = False
    nothing_to_do: bool = False
    cooldowns: int = 0                  # Abkühlpausen wegen Cloudflare-Prüfung


class Recorder:
    def __init__(self, storage: Storage, keys: Keys, run_id: str):
        self.storage, self.keys, self.run_id = storage, keys, run_id
        self.snapshots: list[dict] = []
        self.offers: list[dict] = []
        self.counts: list[dict] = []
        self.parts = 0

    def flush(self) -> None:
        if not self.snapshots:
            return
        self.parts += 1
        for table, rows, schema in (("snapshots", self.snapshots, SNAPSHOT_SCHEMA),
                                    ("offers", self.offers, OFFER_SCHEMA),
                                    ("counts", self.counts, COUNT_SCHEMA)):
            df = pd.DataFrame(rows, columns=schema.names)
            self.storage.put(self.keys.part(table, self.run_id, self.parts), df_to_parquet(df, schema))
        self.snapshots, self.offers, self.counts = [], [], []


def _same_path(a: str, b: str) -> bool:
    return urlsplit(a).path.rstrip("/") == urlsplit(b).path.rstrip("/")


_SLOWDOWN = 1.0   # wächst nach jeder Abkühlpause (pro Lauf)
_sleep = time.sleep


def configure_pace(pace: dict | None) -> None:
    """Tempo aus config/monitoring.yaml übernehmen (fehlende Werte: Standard)."""
    global PAUSE_RANGE_S, COOLDOWN_MIN, MAX_COOLDOWNS
    pace = pace or {}
    lo = float(pace.get("pause_min_s", PAUSE_RANGE_S[0]))
    hi = float(pace.get("pause_max_s", PAUSE_RANGE_S[1]))
    PAUSE_RANGE_S = (max(0.0, min(lo, hi)), max(lo, hi))
    COOLDOWN_MIN = float(pace.get("cooldown_min", COOLDOWN_MIN))
    MAX_COOLDOWNS = int(pace.get("max_cooldowns", MAX_COOLDOWNS))


def _pause() -> None:
    lo, hi = PAUSE_RANGE_S
    time.sleep(random.uniform(lo, hi) * _SLOWDOWN)


class ProductScraper:
    def __init__(self, scope: Scope, session: Session, storage: Storage, keys: Keys, run_id: str,
                 recorder: Recorder, meta: dict[int, dict], result: ScrapeResult):
        self.scope, self.session, self.storage, self.keys = scope, session, storage, keys
        self.run_id, self.rec, self.meta, self.result = run_id, recorder, meta, result
        self.consecutive_errors = 0
        self.failed_saved = 0
        self.login_marker_seen: bool | None = None
        self.failed_pids: set[int] = set()
        self.deadline = float("inf")

    # --- Abruf ---------------------------------------------------------------------------------
    def fetch(self, url: str) -> Page:
        _pause()
        try:
            page = self.session.get_direct(url)
        except FetchError:
            page = None
        if page is None or looks_like_challenge(page):
            page = self.session.get(url)  # FlareSolverr löst die Prüfung und erneuert die Cookies
            while looks_like_challenge(page):
                if self._try_visible():
                    try:
                        self.session.login()
                        page = self.session.get(url)
                        continue
                    except (LoginError, FetchError) as err:
                        print(f"   Auch mit sichtbarem Chrome nicht gelöst: {err}", flush=True)
                page = self._cool_down(url, page)
        return page

    def _try_visible(self) -> bool:
        switch = getattr(self.session, "go_visible", None)
        if switch and switch():
            print("👁️  Unsichtbares Chrome kommt nicht durch – wechsle auf sichtbares Chrome-Fenster "
                  "(bitte nicht schließen, es geht nach dem Lauf von selbst zu)", flush=True)
            return True
        return False

    def login(self) -> None:
        """Anmelden; zeigt Cardmarket dabei eine Prüfung: sichtbares Chrome, dann Abkühlpausen, sonst Notbremse."""
        while True:
            try:
                self.session.ensure_login()
                return
            except (LoginError, FetchError) as err:
                if not is_challenge_error(err):
                    raise
                if self._try_visible():
                    continue
                self._wait_cooldown(str(err))

    def _wait_cooldown(self, what: str) -> None:
        """Abkühlpause (oder Notbremse, wenn alle Pausen verbraucht sind; oder Zeitlimit)."""
        global _SLOWDOWN
        if self.result.cooldowns >= MAX_COOLDOWNS:
            raise EmergencyStop(f"Cardmarket blockiert den Zugriff ({what}) – "
                                f"auch nach {MAX_COOLDOWNS} Abkühlpausen à {COOLDOWN_MIN} Min.")
        wait = COOLDOWN_MIN * 60
        if time.time() + wait >= self.deadline:
            raise DeadlineReached()
        self.result.cooldowns += 1
        print(f"🧊 Cardmarket prüft den Zugriff ({what}) – Abkühlpause {COOLDOWN_MIN} Min. "
              f"({self.result.cooldowns}/{MAX_COOLDOWNS}), danach langsamer weiter", flush=True)
        _sleep(wait)
        _SLOWDOWN *= SLOWDOWN_STEP

    def _cool_down(self, url: str, page: Page) -> Page:
        """Prüfung, die FlareSolverr nicht löst: warten, neu anmelden, langsamer weiter – oder Notbremse."""
        self._wait_cooldown(f"{page.status}, '{page.title}'")
        try:
            self.session.login()  # frische FlareSolverr-Sitzung und neuer Login
        except (LoginError, FetchError) as err:
            print(f"   Neuanmeldung nach der Pause fehlgeschlagen: {err}", flush=True)
            return page
        return self.session.get(url)

    def fetch_product_page(self, url: str) -> tuple[Page, ProductPage]:
        page = self.fetch(url)
        parsed = parse_product_page(page.html)
        self._check_login(parsed)
        return page, parsed

    def _check_login(self, parsed: ProductPage) -> None:
        if self.login_marker_seen is None:
            self.login_marker_seen = parsed.logged_in_hint
            return
        if self.login_marker_seen and not parsed.logged_in_hint:
            try:
                self.session.login()
            except Exception as err:
                raise EmergencyStop(f"Login verloren und erneuter Login fehlgeschlagen: {err}") from err

    def save_failed(self, html: str, id_product: int, language: str | None) -> None:
        if self.failed_saved >= MAX_FAILED_PAGES_SAVED or not html:
            return
        self.failed_saved += 1
        cleaned = redact(html, "")
        self.storage.put(self.keys.failed_page(id_product, language), gzip.compress(cleaned.encode("utf-8")),
                         "application/gzip")

    # --- URL ------------------------------------------------------------------------------------
    def resolve_url(self, product: dict, known: dict | None) -> tuple[str | None, str]:
        if known and known.get("url"):
            return cardmarket.normalize_url(known["url"]), known.get("url_source") or "known"
        cat = self.scope.category(int(product["id_category"]))
        url = cardmarket.product_url(self.scope.cardmarket_path, cat.slug if cat else "", product["name"])
        return url, "rule"

    def search_url(self, product: dict) -> str | None:
        """Produkt über die Cardmarket-Suche finden und anhand der Produkt-ID bestätigen.

        Probiert mehrere Suchbegriffe (voller Name, Name ohne Präfix vor ":", ohne Sonderzeichen).
        Gibt es nur einen Treffer, leitet Cardmarket direkt auf die Produktseite weiter."""
        pid = int(product["id_product"])
        tried: set[str] = set()
        for term in cardmarket.search_terms(product["name"]):
            page = self.fetch(cardmarket.search_url(self.scope.cardmarket_path, term))
            direct = parse_product_page(page.html)
            if direct.id_product == pid:
                return cardmarket.normalize_url(page.final_url)
            soup = BeautifulSoup(page.html, "html.parser")
            candidates: list[str] = []
            for a in soup.select("a[href*='/Products/']"):
                href = (a.get("href") or "").split("?")[0]
                parts = href.strip("/").split("/")
                # nur Produktseiten in der deutschen Ansicht: /de/<Spiel>/Products/<Kategorie>/<Produkt>
                if len(parts) != 5 or parts[0] != cardmarket.LOCALE or "Search" in parts:
                    continue
                url = cardmarket.normalize_url(href)
                if url not in candidates and url not in tried:
                    candidates.append(url)
            for url in candidates[:6]:
                tried.add(url)
                _, parsed = self.fetch_product_page(url)
                if parsed.id_product == pid:
                    return url
        return None

    # --- Angebote nachladen --------------------------------------------------------------------
    def collect_view(self, url: str, first: ProductPage) -> tuple[list[Offer], bool, bool]:
        """Alle Angebote einer Filteransicht. Rückgabe: Angebote, vollständig?, Grenze erreicht?"""
        offers = list(first.offers)
        lm = first.load_more
        ajax = cardmarket.ajax_url(self.scope.cardmarket_path, "Product_LoadMoreArticles")
        page_no = lm.page if lm else 0
        while lm and page_no > 0:
            _pause()
            xml = self.session.post_ajax(ajax, {
                "__cmtkn": lm.token, "page": str(page_no), "filterSettings": lm.filter_settings,
                "idProduct": str(lm.id_product)}, referer=url)
            try:
                res = parse_load_more_response(xml)
            except ParseError:
                return offers, False, False
            offers.extend(res.offers)
            if res.max_reached:
                return offers, False, True
            if res.new_page <= 0 or not res.offers:
                break
            page_no = res.new_page
        capped = len(offers) >= MAX_ROWS_PER_VIEW and lm is not None
        return offers, not capped, capped

    def collect_all(self, product_url: str, language: str, first: ProductPage) -> tuple[list[Offer], bool, str | None]:
        """Alle Angebote einer Sprache; bei mehr als 300 nach Verkäufertyp und notfalls nach Land aufteilen.

        Rückgabe: Angebote, vollständig gezählt?, Hinweis (warum unvollständig / wie aufgeteilt)."""
        view_url = cardmarket.with_filters(product_url, language=language)
        offers, complete, capped = self.collect_view(view_url, first)
        if not capped:
            return offers, complete, None if complete else "Nachladen unvollständig"
        merged: dict[int, Offer] = {o.article_id: o for o in offers}
        complete, notes = True, ["über 300 Angebote: nach Verkäufertyp aufgeteilt"]
        for seller_type, type_name in SELLER_TYPES.items():
            url = cardmarket.with_filters(product_url, language=language, seller_type=seller_type)
            _, page = self.fetch_product_page(url)
            if not filter_applied(page, "sellerstatus", "sellertype"):
                # Cardmarket hat den Filter nicht übernommen – lieber unvollständig als doppelt zählen
                settings = page.load_more.filter_settings if page.load_more else "-"
                return list(merged.values()), False, f"Verkäufertyp-Filter nicht übernommen ({settings[:150]})"
            part, part_complete, part_capped = self.collect_view(url, page)
            merged.update({o.article_id: o for o in part})
            if not part_capped:
                complete = complete and part_complete
                continue
            notes.append(f"{type_name} zusätzlich nach Land")
            for country in page.seller_country_ids:
                curl = cardmarket.with_filters(product_url, language=language, seller_type=seller_type,
                                               seller_country=country)
                _, cpage = self.fetch_product_page(curl)
                if not filter_applied(cpage, "idcountries", "sellercountry"):
                    settings = cpage.load_more.filter_settings if cpage.load_more else "-"
                    return list(merged.values()), False, f"Länder-Filter nicht übernommen ({settings[:150]})"
                cpart, c_complete, c_capped = self.collect_view(curl, cpage)
                merged.update({o.article_id: o for o in cpart})
                complete = complete and c_complete and not c_capped
        return list(merged.values()), complete, "; ".join(notes)

    # --- Produkt --------------------------------------------------------------------------------
    def scrape_product(self, product: dict) -> None:
        pid = int(product["id_product"])
        known = self.meta.get(pid)
        url, source = self.resolve_url(product, known)
        wanted = list(self.scope.languages)
        known_langs = list(known.get("languages") or []) if known else []
        first_lang = next((lang for lang in wanted if lang in known_langs), wanted[0]) if known_langs else wanted[0]

        started = time.monotonic()
        req_before = self.session.requests

        page = parsed = None
        url_changed = False
        try:
            if url:
                page, parsed = self.fetch_product_page(cardmarket.with_filters(url, language=first_lang))
            if not url or page.status == 404 or parsed.id_product != pid:
                found = self.search_url(product)
                if not found:
                    self._record_failure(pid, wanted, NOT_FOUND, page, url, "Produktseite nicht gefunden")
                    return
                url, source, url_changed = found, "search", True
                page, parsed = self.fetch_product_page(cardmarket.with_filters(url, language=first_lang))
            elif not _same_path(page.final_url, url):
                url, url_changed = cardmarket.normalize_url(page.final_url), True
        except FetchError as err:
            self._record_failure(pid, wanted, FETCH_ERROR, page, url, str(err))
            return

        if url_changed:
            self.result.url_changes.append(f"{product['name']} (ID {pid}) → {url}")
        languages = [lang for lang in wanted if lang in parsed.languages]
        self.meta[pid] = {
            "id_product": pid, "url": url, "url_source": source, "name_de": parsed.name_de,
            "languages": parsed.languages,
            "image_url": cardmarket.image_url(int(product["id_category"]), pid),
            "last_ok": (known or {}).get("last_ok"),
            "languages_checked": self.keys.day,
        }
        if not languages:
            # Cardmarket führt das Produkt nur in anderen Sprachen (z. B. Indonesisch/Thailändisch):
            # keine Daten speichern; der Katalog nimmt es ab sofort dauerhaft aus dem Scope.
            self.result.no_language.append(f"{product['name']} (ID {pid}, nur {'/'.join(parsed.languages)})")
            self.consecutive_errors = 0
            return

        for i, lang in enumerate(languages):
            # Der erste Sprach-Abruf ist schon passiert – seine Zeit und Abrufe zählen mit
            v_started, v_req = (started, req_before) if i == 0 and lang == first_lang else (
                time.monotonic(), self.session.requests)
            lang_url = cardmarket.with_filters(url, language=lang)
            try:
                if lang != first_lang or page is None:
                    page, parsed = self.fetch_product_page(lang_url)
                if parsed.id_product != pid:
                    raise ParseError("Produkt-ID auf der Seite passt nicht")
                note = None
                if parsed.no_offers or not parsed.offers:
                    status, offers, complete = NO_OFFERS, [], True
                else:
                    offers, complete, note = self.collect_all(url, lang, parsed)
                    status = OK if offers else PARSE_ERROR
            except FetchError as err:
                self._record_failure(pid, [lang], FETCH_ERROR, page, lang_url, str(err))
                page = None
                continue
            except ParseError as err:
                self._record_failure(pid, [lang], PARSE_ERROR, page, lang_url, str(err))
                page = None
                continue
            self._snapshot(pid, lang, status, page, lang_url, url_changed, parsed, offers, complete,
                           v_started, v_req, note=note, product_name=product["name"])
            self.meta[pid]["last_ok"] = self.keys.day
            self.consecutive_errors = 0
            page = None  # nächste Sprache neu laden

    # --- Speichern ------------------------------------------------------------------------------
    def _record_failure(self, pid: int, languages: list[str], status: str, page: Page | None,
                        url: str | None, note: str) -> None:
        for lang in languages:
            self._snapshot(pid, lang, status, page, url, False, None, [], False, time.monotonic(),
                           self.session.requests, note=note[:300])
        if page is not None:
            self.save_failed(page.html, pid, languages[0] if languages else None)
        self.result.errors.append(f"ID {pid} {'/'.join(languages)}: {status} – {note[:120]}")
        if status in (FETCH_ERROR, PARSE_ERROR):
            self.failed_pids.add(pid)
        self.consecutive_errors += 1
        if self.consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
            raise EmergencyStop(f"{MAX_CONSECUTIVE_ERRORS} Fehler in Folge – zuletzt: {note[:200]}")

    def _snapshot(self, pid: int, lang: str | None, status: str, page: Page | None, url: str | None,
                  url_changed: bool, parsed: ProductPage | None, offers: list[Offer], complete: bool,
                  started: float, req_before: int, note: str | None = None, product_name: str | None = None) -> None:
        stored = select_stored_offers(offers, self.scope.offers_to_store)
        self.rec.snapshots.append({
            "run_id": self.run_id,
            "scraped_at": datetime.now(timezone.utc).replace(microsecond=0),
            "id_product": pid, "language": lang, "status": status,
            "http_status": page.status if page else None, "url": url, "url_changed": url_changed,
            "available_items": parsed.available_items if parsed else None,
            "trend": parsed.trend if parsed else None, "avg30": parsed.avg30 if parsed else None,
            "avg7": parsed.avg7 if parsed else None, "avg1": parsed.avg1 if parsed else None,
            "offers_total": len(offers), "items_total": sum(o.quantity for o in offers),
            "count_complete": complete, "offers_stored": len(stored),
            "offers_wrong_language": sum(1 for o in offers if lang and o.language and o.language != lang),
            "requests": self.session.requests - req_before,
            "duration_ms": int((time.monotonic() - started) * 1000),
            "parser_version": PARSER_VERSION, "note": note,
        })
        for row in stored:
            self.rec.offers.append({"run_id": self.run_id, "id_product": pid, "language": lang, **row})
        for (country, stype, rating), (n, items) in count_table(offers).items():
            self.rec.counts.append({"run_id": self.run_id, "id_product": pid, "language": lang,
                                    "seller_country": country, "seller_type": stype, "seller_rating": rating,
                                    "offers": n, "items": items})
        self.result.status_counts[status] += 1
        if status == OK and len(self.result.samples) < 15:
            cheapest_total = min(o.price_cents + (o.shipping_cents or 0) for o in offers)
            cheapest_item = min(o.price_cents for o in offers)
            self.result.samples.append({
                "name": product_name or str(pid), "language": lang, "offers": len(offers),
                "items": sum(o.quantity for o in offers), "complete": complete,
                "cheapest_total": cheapest_total / 100, "cheapest_item": cheapest_item / 100,
                "trend": parsed.trend if parsed else None, "avg30": parsed.avg30 if parsed else None,
                "url": url,
            })


def filter_applied(page: ProductPage, *keys: str) -> bool:
    """Hat Cardmarket den Filter übernommen? Steht in den Filtereinstellungen des Nachlade-Formulars,
    z. B. {"sellerStatus":[0],"idLanguage":{"1":1}} für Verkäufertyp "privat" bzw. "idCountries":[23]
    für ein Land. Ohne Nachlade-Formular
    gibt es höchstens 50 Angebote – dann ist die Ansicht ohnehin vollständig."""
    if page.load_more is None:
        return True
    settings = page.load_more.filter_settings.lower()
    return any(k in settings for k in keys)


def _to_date(value: Any) -> date | None:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return pd.Timestamp(value).date()


def select_stored_offers(offers: list[Offer], n: int) -> list[dict]:
    """Die n günstigsten nach Endpreis UND die n günstigsten nach Artikelpreis (Vereinigung)."""
    if not offers:
        return []
    by_total = sorted(offers, key=lambda o: (o.price_cents + (o.shipping_cents or 0), o.price_cents))
    by_price = sorted(offers, key=lambda o: (o.price_cents, o.shipping_cents or 0))
    rank_total = {o.article_id: i + 1 for i, o in enumerate(by_total)}
    rank_price = {o.article_id: i + 1 for i, o in enumerate(by_price)}
    keep = {o.article_id for o in by_total[:n]} | {o.article_id for o in by_price[:n]}
    rows = []
    for o in by_total:
        if o.article_id not in keep:
            continue
        rows.append({
            "rank_total": rank_total[o.article_id], "rank_price": rank_price[o.article_id],
            "article_id": o.article_id, "price_cents": o.price_cents, "shipping_cents": o.shipping_cents,
            "quantity": o.quantity, "seller_country": o.seller_country, "seller_type": o.seller_type,
            "seller_rating": o.seller_rating, "seller_sales": o.seller_sales, "comment": o.comment,
        })
    return rows


def count_table(offers: list[Offer]) -> dict[tuple, tuple[int, int]]:
    """Angebote und Stückzahl je (Land, Verkäufertyp, Bewertung) – Grundlage für jeden Bestandsfilter."""
    table: dict[tuple, list[int]] = defaultdict(lambda: [0, 0])
    for o in offers:
        key = (o.seller_country, o.seller_type, o.seller_rating)
        table[key][0] += 1
        table[key][1] += o.quantity
    return {k: (v[0], v[1]) for k, v in sorted(table.items(), key=lambda kv: tuple(str(x) for x in kv[0]))}


TABLES = (("snapshots", SNAPSHOT_SCHEMA), ("offers", OFFER_SCHEMA), ("counts", COUNT_SCHEMA))


def compact_day(storage: Storage, keys: Keys) -> int:
    """Zwischendateien eines abgeschlossenen Tages zu einer Datei pro Tabelle zusammenfassen.

    Erst wird die zusammengefasste Datei geschrieben, dann werden die Teile gelöscht. Bricht das
    dazwischen ab, entfernt der nächste Durchgang die doppelten Zeilen wieder (drop_duplicates)."""
    removed = 0
    for table, schema in TABLES:
        keys_ = [k for k in storage.list(keys.day_prefix(table)) if k.endswith(".parquet")]
        if not keys_ or keys_ == [keys.day_file(table)]:
            continue
        frames = [parquet_to_df(storage.get(k)) for k in keys_]
        df = pd.concat(frames, ignore_index=True).drop_duplicates(ignore_index=True)
        storage.put(keys.day_file(table), df_to_parquet(df, schema))
        for k in keys_:
            if k != keys.day_file(table):
                storage.delete(k)
                removed += 1
    return removed


def no_language_ids(meta: dict[int, dict], scope: Scope) -> set[int]:
    """Produkte, die Cardmarket in keiner der gewünschten Sprachen führt (bekannt aus früheren Abrufen)."""
    return {pid for pid, m in meta.items()
            if m.get("languages") and not any(lang in m["languages"] for lang in scope.languages)}


def reset_day(storage: Storage, keys: Keys) -> int:
    """Alle Scrape-Daten eines Tages löschen (Snapshots, Angebote, Zählungen, Fortschritt)."""
    removed = 0
    for table, _ in TABLES:
        for k in storage.list(keys.day_prefix(table)):
            storage.delete(k)
            removed += 1
    if storage.get(keys.progress) is not None:
        storage.delete(keys.progress)
        removed += 1
    return removed


def load_meta(storage: Storage, keys: Keys) -> dict[int, dict]:
    data = storage.get(keys.meta)
    if not data:
        return {}
    df = parquet_to_df(data)
    out = {}
    for row in df.to_dict("records"):
        langs = row.get("languages")
        row["languages"] = list(langs) if langs is not None else []
        out[int(row["id_product"])] = row
    return out


def save_meta(storage: Storage, keys: Keys, meta: dict[int, dict]) -> None:
    rows = sorted(meta.values(), key=lambda r: r["id_product"])
    df = pd.DataFrame(rows, columns=META_SCHEMA.names)
    storage.put(keys.meta, df_to_parquet(df, META_SCHEMA))


def ordered_active_products(scope: Scope, storage: Storage, keys: Keys) -> list[dict]:
    data = storage.get(keys.catalog_state)
    if not data:
        raise RuntimeError(f"Kein Katalog für {scope.game_name} gefunden – zuerst den Katalog-Lauf ausführen.")
    df = parquet_to_df(data)
    df = df[df["active"]]
    # Produkte ohne gewünschte Sprache sofort überspringen (der Katalog schließt sie beim nächsten Lauf aus)
    skip = no_language_ids(load_meta(storage, keys), scope)
    df = df[~df["id_product"].isin(skip)]
    order = {c.id: i for i, c in enumerate(scope.categories)}
    df = df.assign(_cat=df["id_category"].map(order).fillna(99))
    df = df.sort_values(["_cat", "id_product"], ascending=[True, False])
    return df[["id_product", "name", "id_category", "category_name"]].to_dict("records")


def run(scope: Scope, storage: Storage, session: Session, *, deadline: float, limit: int | None = None,
        now: datetime | None = None, reset: bool = False) -> ScrapeResult:
    """deadline = Uhrzeit als time.time()-Wert (Wanduhr, zählt auch Zeit im Energiesparmodus mit)."""
    global _SLOWDOWN
    _SLOWDOWN = 1.0
    started = time.monotonic()
    now = now or datetime.now(timezone.utc)
    day = now.astimezone(BERLIN).date()
    run_id = now.strftime("%Y%m%dT%H%M%S")
    keys = Keys(scope.game_key, day)
    if reset:
        removed = reset_day(storage, keys)
        print(f"🗑️  Heutige Scrape-Daten gelöscht ({removed} Dateien) – der Tag wird neu gescrapt.", flush=True)

    products = ordered_active_products(scope, storage, keys)
    progress_raw = storage.get(keys.progress)
    progress: dict[str, Any] = json.loads(progress_raw) if progress_raw else {"products_done": [], "runs": []}
    done = set(progress["products_done"])
    todo = [p for p in products if int(p["id_product"]) not in done]
    if limit:
        todo = todo[:limit]

    result = ScrapeResult(game=scope.game_key, day=day, run_id=run_id, products_total=len(products),
                          products_done_before=len(done))
    if not todo:
        result.nothing_to_do = True
        result.day_complete = len(done) >= len(products)
        return result

    meta = load_meta(storage, keys)
    rec = Recorder(storage, keys, run_id)
    scraper = ProductScraper(scope, session, storage, keys, run_id, rec, meta, result)
    scraper.deadline = deadline
    req_start = session.requests
    fb_start = getattr(session, "fallbacks", 0)

    def checkpoint() -> None:
        rec.flush()
        save_meta(storage, keys, meta)
        progress["products_done"] = sorted(done)
        storage.put(keys.progress, json.dumps(progress, indent=1).encode("utf-8"), "application/json")

    try:
        scraper.login()
        for i, product in enumerate(todo, 1):
            if time.time() >= deadline:
                result.stopped_reason = "Zeitlimit erreicht – der nächste Lauf macht hier weiter."
                break
            scraper.scrape_product(product)
            done.add(int(product["id_product"]))
            result.products_done_now += 1
            if i % FLUSH_EVERY_PRODUCTS == 0:
                checkpoint()
                print(f"   … {i}/{len(todo)} Produkte, {session.requests - req_start} Abrufe", flush=True)
        # Produkte mit Abruf- oder Lesefehlern am Ende ein zweites Mal versuchen
        retry = [p for p in todo if int(p["id_product"]) in scraper.failed_pids]
        if retry and result.stopped_reason is None:
            print(f"🔁 Zweiter Versuch für {len(retry)} Produkte", flush=True)
            scraper.consecutive_errors = 0
            for product in retry:
                if time.time() >= deadline:
                    break
                scraper.scrape_product(product)
    except DeadlineReached:
        result.stopped_reason = "Zeitlimit erreicht (während einer Abkühlpause) – der nächste Lauf macht hier weiter."
    except EmergencyStop as err:
        result.emergency = True
        result.stopped_reason = f"Notbremse: {err}"
    finally:
        progress["runs"].append({
            "run_id": run_id, "products": result.products_done_now,
            "stopped": result.stopped_reason, "emergency": result.emergency,
            "requests": session.requests - req_start,
            "fallbacks": getattr(session, "fallbacks", 0) - fb_start,
            "cooldowns": result.cooldowns,
            "no_language": result.no_language, "url_changes": result.url_changes,
        })
        checkpoint()

    if result.stopped_reason is None and len(done) < len(products):
        result.stopped_reason = (f"Testlauf mit Limit {limit} beendet." if limit
                                 else "Noch nicht alle Produkte erledigt.")
    if len(done) >= len(products):
        compact_day(storage, keys)
        result.day_complete = True
    result.requests = session.requests - req_start
    result.fallbacks = getattr(session, "fallbacks", 0) - fb_start
    result.seconds = round(time.monotonic() - started, 1)
    return result


def summary_markdown(result: ScrapeResult, scope: Scope) -> str:
    total_done = result.products_done_before + result.products_done_now
    lines = [f"# Scrape {scope.game_name} – {result.day:%d.%m.%Y} (Lauf {result.run_id})", ""]
    if result.nothing_to_do:
        lines.append(f"✅ Heute sind bereits alle {result.products_total} aktiven Produkte erledigt.")
        return "\n".join(lines) + "\n"
    if result.emergency:
        lines += [f"> 🛑 **{result.stopped_reason}**", ""]
    elif result.stopped_reason:
        lines += [f"> ⏸️ {result.stopped_reason}", ""]
    else:
        lines += ["> ✅ Alle aktiven Produkte für heute erledigt.", ""]
    per_req = result.seconds / result.requests if result.requests else 0
    lines += [
        f"- Produkte in diesem Lauf: **{result.products_done_now}** · heute insgesamt: "
        f"**{total_done} von {result.products_total}**",
        f"- Abrufe: {result.requests} in {result.seconds / 60:.1f} Min. (Ø {per_req:.2f} s pro Abruf)"
        + (f" · Abkühlpausen: {result.cooldowns}" if result.cooldowns else ""),
        "- Varianten nach Status: " + ", ".join(f"{k}: {v}" for k, v in result.status_counts.most_common()),
        "",
    ]
    if result.samples:
        lines += ["## Stichprobe zum Gegenprüfen auf Cardmarket", "",
                  "| Produkt | Sprache | Angebote | Stück | vollständig | günstigster Endpreis | "
                  "günstigster Artikelpreis | Trend | Ø 30 Tage |",
                  "|---|:-:|---:|---:|:-:|---:|---:|---:|---:|"]
        for s in result.samples:
            def eur(v):
                return "–" if v is None else f"{v:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")
            lines.append(f"| [{s['name']}]({s['url']}) | "
                         f"{s['language']} | {s['offers']} | {s['items']} | {'ja' if s['complete'] else 'nein'} | "
                         f"{eur(s['cheapest_total'])} | {eur(s['cheapest_item'])} | {eur(s['trend'])} | "
                         f"{eur(s['avg30'])} |")
        lines.append("")
    if result.no_language:
        lines += [f"## Dauerhaft ausgeschlossen – keine der Sprachen {'/'.join(scope.languages)} "
                  f"({len(result.no_language)})", ""]
        lines += [f"- {n}" for n in result.no_language[:30]] + [""]
    if result.url_changes:
        lines += [f"## Geänderte Produkt-URLs ({len(result.url_changes)})", ""]
        lines += [f"- {u}" for u in result.url_changes[:30]] + [""]
    if result.errors:
        lines += [f"## Fehler ({len(result.errors)})", ""]
        lines += [f"- {e}" for e in result.errors[:30]]
        if len(result.errors) > 30:
            lines.append(f"- … und {len(result.errors) - 30} weitere")
    return "\n".join(lines) + "\n"
