"""Fairer Kaufpreis je Produkt + Sprache + Tag aus den gespeicherten Angeboten (Logik: config/pricing.yaml).

Rohdaten bleiben unverändert; die Preise sind eine abgeleitete Tabelle:
  prices/<spiel>/date=JJJJ-MM-TT.parquet   je Variante zwei Zeilen (eu_only = True/False)
  prices/<spiel>/_meta.json                Prüfsumme der Logik, mit der gerechnet wurde

Ändert sich pricing.yaml (oder ALGO_VERSION im Code), werden beim nächsten Lauf alle Tage neu berechnet.
Alle Beträge in Cent.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from fractions import Fraction
from pathlib import Path

import pandas as pd
import pyarrow as pa
import yaml

from .scrape import Keys
from .settings import Scope
from .storage import Storage, df_to_parquet, parquet_to_df

ALGO_VERSION = 7   # bei Änderungen an der Rechenlogik im Code erhöhen -> komplette Neuberechnung
PRICING_FILE = Path(__file__).resolve().parents[1] / "config" / "pricing.yaml"

PRICE_SCHEMA = pa.schema([
    ("day", pa.date32()),
    ("id_product", pa.int64()),
    ("language", pa.string()),
    ("eu_only", pa.bool_()),
    ("price_incl_cents", pa.int64()),     # fairer Preis inkl. Versand (nach DE)
    ("price_excl_cents", pa.int64()),     # fairer Preis nur Artikel
    ("cheapest_incl_cents", pa.int64()),  # günstigstes gültiges Stück inkl. Versand (nach allen Filtern)
    ("cheapest_excl_cents", pa.int64()),  # günstigstes gültiges Stück nur Artikel
    ("status", pa.string()),              # ok | alle_aussortiert | alle_gespeicherten_aussortiert
    ("items_total", pa.int64()),          # N: alle gelisteten Stück vor jedem Filter
    ("listings", pa.int64()),             # Listungen (Angebote auf Cardmarket, alle Länder, vor jedem Filter)
    ("k", pa.int64()),                    # Korbgröße laut Formel
    ("basket_incl", pa.int64()),          # tatsächliche Korbgröße nach Lückenschutz
    ("basket_excl", pa.int64()),
    ("lines_stored", pa.int64()),         # gespeicherte Angebotszeilen (günstigste je Sortierung)
    ("lines_valid", pa.int64()),          # nach Land/Kommentar/Lockangeboten
    ("removed_country", pa.int64()),
    ("removed_comment", pa.int64()),
    ("removed_lock", pa.int64()),
    ("removed_trim", pa.int64()),         # Kappung bei vielen Listungen
    ("removed_no_shipping", pa.int64()),
    ("ship_deducted_cents", pa.int64()),  # Schritt 7: abgezogener typischer Inlandsversand (Preis nur Artikel)
    ("ship_source", pa.string()),         # product | product_30d | category | none
    ("de_ship_median_cents", pa.int64()), # Inlandsversand dieses Produkts heute (Median, für den 30-Tage-Rückgriff)
    ("de_ship_n", pa.int64()),            # so viele Inlandsangebote heute
    ("logic_hash", pa.string()),
])


# --- Konfiguration ----------------------------------------------------------------------------
@dataclass
class PricingConfig:
    raw: dict
    eu_countries: frozenset
    comment_filter: "CommentFilter"
    trim: list[tuple[int, int]]   # (über so vielen Listungen, so viele günstigste gültige Zeilen weglassen)
    lock_max_listings: int
    lock_ratio: Fraction
    lock_reference_lines: int
    lock_min_lines: int
    lock_gap: Fraction
    lock_max_group: int
    lock_max_rounds: int
    per_line: bool                # Schritt 3: jedes Angebot zählt einmal (sonst je Stück)
    basket_share: Fraction
    basket_min: int
    basket_max: int
    gap_factor: Fraction
    gap_min_share: Fraction
    domestic_country: str = "DE"
    ship_min_sellers: int = 3
    ship_lookback_days: int = 30
    logic_hash: str = ""


def load_pricing(path: Path = PRICING_FILE) -> PricingConfig:
    text = Path(path).read_text(encoding="utf-8")
    raw = yaml.safe_load(text)
    f = lambda v: Fraction(str(v))  # noqa: E731 – exakte Dezimalzahlen (0,15 × 20 = 3, nicht 2,999…)
    cfg = PricingConfig(
        raw=raw,
        eu_countries=frozenset(c.upper() for c in raw["eu_countries"]),
        comment_filter=CommentFilter(raw["comment_filter"]),
        trim=sorted(((int(t["over"]), int(t["skip"])) for t in raw.get("trim_cheapest", [])), reverse=True),
        lock_max_listings=int(raw["lock_offers"].get("max_listings", 10**9)),
        lock_ratio=f(raw["lock_offers"]["ratio"]),
        lock_reference_lines=int(raw["lock_offers"]["reference_lines"]),
        lock_min_lines=int(raw["lock_offers"]["min_lines"]),
        lock_gap=f(raw["lock_offers"].get("gap", 0.8)),
        lock_max_group=int(raw["lock_offers"].get("max_group", 2)),
        lock_max_rounds=int(raw["lock_offers"].get("max_rounds", 2)),
        per_line=raw.get("pieces", "per_piece") == "per_line",
        basket_share=f(raw["basket"]["share"]),
        basket_min=int(raw["basket"]["min"]),
        basket_max=int(raw["basket"]["max"]),
        gap_factor=f(raw["gap"]["factor"]),
        gap_min_share=f(raw["gap"]["min_share"]),
        domestic_country=str(raw.get("item_only", {}).get("domestic_country", "DE")).upper(),
        ship_min_sellers=int(raw.get("item_only", {}).get("min_sellers", 3)),
        ship_lookback_days=int(raw.get("item_only", {}).get("lookback_days", 30)),
    )
    canonical = json.dumps(raw, sort_keys=True, ensure_ascii=False)
    cfg.logic_hash = hashlib.sha256(f"{ALGO_VERSION}|{canonical}".encode()).hexdigest()[:12]
    return cfg


# --- Schritt 1b: Kommentarfilter --------------------------------------------------------------
class CommentFilter:
    """Erkennt Mängel-/Öffnungs-/Risikohinweise in Angebotskommentaren (ganze Wörter, mit Verneinungen)."""

    CONNECTOR = r"(?:\s*[,/&+]\s*|\s+(?:or|and|nor|oder|und|noch|&)\s+)"

    def __init__(self, conf: dict):
        self.categories: list[tuple[str, re.Pattern]] = []
        alternation = []
        for cat, patterns in conf["defects"].items():
            for p in patterns:
                self.categories.append((cat, re.compile(rf"\b(?:{p})\b", re.IGNORECASE)))
                alternation.append(f"(?:{p})")
        defect_any = r"\b(?:" + "|".join(alternation) + r")\b"
        neg = r"\b(?:" + "|".join(conf["negations_before"]) + r")\b"
        # Verneinung + (ein Wort) + Mangel, dann weitere Mangelwörter per Komma / or / and …
        self.negated_span = re.compile(
            rf"{neg}\s+(?:[\w-]+\s+)?{defect_any}(?:{self.CONNECTOR}(?:[\w-]+\s+)?{defect_any})*", re.IGNORECASE)
        after = "|".join(conf["negations_after"])
        self.negated_after = re.compile(rf"^[\s-]*(?:{after})\b", re.IGNORECASE)
        self.ends_with_free = re.compile(rf"(?:{after})$", re.IGNORECASE)
        self.exceptions = [re.compile(rf"\b(?:{p})\b", re.IGNORECASE) for p in conf.get("exceptions", [])]
        self._cache: dict[str, str | None] = {}

    @staticmethod
    def normalize(text: str) -> str:
        text = text.replace("’", "'").replace("`", "'").replace("´", "'")
        return re.sub(r"\s+", " ", text).strip()

    def reason(self, comment: str | None) -> str | None:
        """Grund, warum das Angebot ungültig ist (z. B. 'B_folie_siegel: lose folie'), sonst None."""
        if not isinstance(comment, str) or not comment.strip():
            return None
        if comment not in self._cache:  # viele Kommentare wiederholen sich (Händler-Standardtexte)
            self._cache[comment] = self._reason(comment)
        return self._cache[comment]

    def _reason(self, comment: str) -> str | None:
        text = self.normalize(comment)
        negated = [m.span() for m in self.negated_span.finditer(text)]
        excepted = [m.span() for ex in self.exceptions for m in ex.finditer(text)]
        for cat, pattern in self.categories:
            for m in pattern.finditer(text):
                s, e = m.span()
                if any(a <= s and e <= b for a, b in negated):
                    continue
                if any(a < e and s < b for a, b in excepted):
                    continue
                if self.ends_with_free.search(m.group(0)) or self.negated_after.search(text[e:]):
                    continue
                return f"{cat}: {m.group(0).lower()}"
        return None


# --- Schritte 1–6 für eine Variante -----------------------------------------------------------
@dataclass
class Line:
    price: int                 # Cent
    shipping: int | None       # Cent (für Lieferung nach DE)
    quantity: int
    country: str | None
    comment: str | None
    article_id: int = 0

    @property
    def total(self) -> int:
        return self.price + (self.shipping or 0)


@dataclass
class PriceResult:
    price_incl: int | None = None
    price_excl: int | None = None
    status: str = "ok"
    k: int = 0
    basket_incl: int = 0
    basket_excl: int = 0
    lines_valid: int = 0
    removed_country: int = 0
    removed_comment: int = 0
    removed_lock: int = 0
    removed_trim: int = 0
    removed_no_shipping: int = 0
    reasons: list[str] = field(default_factory=list)
    # Details für die Prüf-Excel
    comment_removed: list[tuple["Line", str]] = field(default_factory=list)
    lock_removed: list[tuple["Line", Fraction]] = field(default_factory=list)
    trimmed: list["Line"] = field(default_factory=list)
    basket_incl_values: list[int] = field(default_factory=list)
    basket_excl_values: list[int] = field(default_factory=list)
    # Schritt 7 (in price_day gesetzt)
    price_excl_median: int | None = None   # Median der Artikelpreise (alte Rechnung, Untergrenze)
    ship_deducted: int | None = None
    ship_source: str = "none"


def _median_cents(values: list[int]) -> int:
    v = sorted(values)
    n = len(v)
    if n % 2:
        return v[n // 2]
    total = v[n // 2 - 1] + v[n // 2]
    return (total + 1) // 2  # x,5 Cent -> aufrunden


def _basket_price(pieces: list[int], k: int, cfg: PricingConfig) -> tuple[int, list[int]]:
    """Schritte 4–6: Korb der ersten K Stücke, Lückenschutz, Median. Liefert (Preis, Korb)."""
    basket = sorted(pieces)[:k]
    anchor = basket[0]
    tight = [p for p in basket if p <= anchor * cfg.gap_factor]
    if len(tight) >= cfg.gap_min_share * len(basket):
        basket = tight
    return _median_cents(basket), basket


def trim_count(listings: int | None, cfg: PricingConfig) -> int:
    """Wie viele der günstigsten gültigen Zeilen bei so vielen Listungen nicht zählen (0 = keine Kappung)."""
    if listings is None:
        return 0
    return next((skip for over, skip in cfg.trim if listings > over), 0)


def fair_price(lines: list[Line], items_total: int | None, cfg: PricingConfig, eu_only: bool,
               listings: int | None = None) -> PriceResult:
    res = PriceResult()
    # Schritt 1 – ungültige Angebote: ohne Versandangabe, Kommentar (Land erst nach der Lockangebot-Prüfung)
    usable: list[Line] = []
    for ln in lines:
        if ln.shipping is None:
            res.removed_no_shipping += 1
            continue
        why = cfg.comment_filter.reason(ln.comment)
        if why:
            res.removed_comment += 1
            res.reasons.append(why)
            res.comment_removed.append((ln, why))
            continue
        usable.append(ln)
    usable.sort(key=lambda ln: (ln.total, ln.price, ln.article_id))

    skip = trim_count(listings, cfg)
    bait: set[int] = set()
    if not skip and (listings is None or listings <= cfg.lock_max_listings):
        # Schritt 2b – bis max_listings Listungen: Lockangebote (pro Zeile, Gesamtpreis), geprüft über ALLE Länder:
        # Ein günstiges EU-Angebot ist kein Lockangebot, wenn es außerhalb der EU ähnlich günstige gibt.
        # Die günstigste Zeile bzw. die zwei günstigsten als Gruppe fliegen raus, wenn sie (a) unter ratio × Median
        # der nächsten Zeilen liegen UND (b) eine echte Lücke zur nächsten Zeile haben. Höchstens max_rounds Durchgänge.
        pool = usable
        for _ in range(cfg.lock_max_rounds):
            removed = False
            for g in range(1, cfg.lock_max_group + 1):
                if len(pool) < g + cfg.lock_min_lines - 1:
                    break
                group_max = pool[g - 1].total
                ref = _median_cents_exact([ln.total for ln in pool[g:g + cfg.lock_reference_lines]])
                if group_max < cfg.lock_gap * pool[g].total and group_max < cfg.lock_ratio * ref:
                    for ln in pool[:g]:
                        bait.add(id(ln))
                        if not eu_only or _in_eu(ln, cfg):
                            res.lock_removed.append((ln, ref))
                            res.removed_lock += 1
                    pool = pool[g:]
                    removed = True
                    break
            if not removed:
                break

    # Schritt 1c – Land (nur EU beim EU-Schalter)
    valid: list[Line] = []
    for ln in usable:
        if id(ln) in bait:
            continue
        if eu_only and not _in_eu(ln, cfg):
            res.removed_country += 1
            continue
        valid.append(ln)
    if not valid:
        res.status = "alle_aussortiert"
        return res

    if skip:
        # Schritt 2a – viele Listungen: die günstigsten gültigen Zeilen zählen nicht (mind. eine bleibt)
        skip = min(skip, len(valid) - 1)
        res.trimmed, res.removed_trim, valid = valid[:skip], skip, valid[skip:]
    res.lines_valid = len(valid)

    # Schritt 3 – jedes Angebot zählt einmal (per_line) bzw. je Stück
    reps = [1 if cfg.per_line else max(1, ln.quantity) for ln in valid]
    incl = [ln.total for ln, r in zip(valid, reps) for _ in range(r)]
    excl = [ln.price for ln, r in zip(valid, reps) for _ in range(r)]

    # Schritt 4 – K aus N = Zahl der Angebote (Listungen, alle Länder, vor jedem Filter). Bewusst nicht die Stückzahl:
    # Im Korb zählt jedes Angebot einmal – ein Händler mit 21 Stück darf den Korb nicht auf teurere Angebote aufblähen.
    n = listings if listings else len(lines)
    res.k = max(cfg.basket_min, min(cfg.basket_max, int(cfg.basket_share * n)))

    # Schritte 5–6
    res.price_incl, res.basket_incl_values = _basket_price(incl, res.k, cfg)
    res.price_excl, res.basket_excl_values = _basket_price(excl, res.k, cfg)
    res.basket_incl, res.basket_excl = len(res.basket_incl_values), len(res.basket_excl_values)
    return res


def _in_eu(ln: Line, cfg: PricingConfig) -> bool:
    return (ln.country or "").upper() in cfg.eu_countries


def _median_cents_exact(values: list[int]) -> Fraction:
    v = sorted(values)
    n = len(v)
    return Fraction(v[n // 2]) if n % 2 else Fraction(v[n // 2 - 1] + v[n // 2], 2)


# --- Tage berechnen ---------------------------------------------------------------------------
def _read_table(storage: Storage, keys: Keys, table: str) -> pd.DataFrame:
    frames = [parquet_to_df(storage.get(k)) for k in storage.list(keys.day_prefix(table)) if k.endswith(".parquet")]
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


@dataclass
class ShipContext:
    """Für Schritt 7: Produktart je Produkt und Inlandsversand der letzten Tage (Tag -> Produkt -> (Median, Anzahl))."""
    categories: dict[int, int] = field(default_factory=dict)
    history: dict[date, dict[int, tuple[int, int]]] = field(default_factory=dict)


def domestic_shipping(pid: int, day: date, today: dict[int, list[int]], ctx: ShipContext,
                      cfg: PricingConfig) -> tuple[int | None, str]:
    """Typischer Inlandsversand (Cent) für ein Produkt und woher er kommt (Schritt 7)."""
    vals = today.get(pid, [])
    if len(vals) >= cfg.ship_min_sellers:
        return _median_cents(vals), "product"
    pooled = list(vals)
    for d, stats in ctx.history.items():
        if day - timedelta(days=cfg.ship_lookback_days) <= d < day and pid in stats:
            med, n = stats[pid]
            pooled += [med] * n
    if len(pooled) >= cfg.ship_min_sellers:
        return _median_cents(pooled), "product_30d"
    cat = ctx.categories.get(pid)
    if cat is not None:
        same = [v for p, vs in today.items() if ctx.categories.get(p) == cat for v in vs]
        if len(same) >= cfg.ship_min_sellers:
            return _median_cents(same), "category"
    return None, "none"


def item_only_price(r: PriceResult, ship: int | None) -> int | None:
    """Schritt 7: Preis inkl. Versand − Inlandsversand, nie unter dem Median der Artikelpreise, nie über inkl."""
    if r.price_incl is None or r.price_excl is None or ship is None:
        return r.price_excl
    return min(r.price_incl, max(r.price_excl, r.price_incl - ship))


def price_day(scope: Scope, storage: Storage, day: date, cfg: PricingConfig,
              details: list | None = None, ship: ShipContext | None = None) -> pd.DataFrame:
    """Preise eines Tages. Mit `details` (Liste) kommen je Variante (id, Sprache, eu_only, PriceResult) dazu."""
    ship = ship if ship is not None else ShipContext()
    keys = Keys(scope.game_key, day)
    snaps = _read_table(storage, keys, "snapshots")
    offers = _read_table(storage, keys, "offers")
    if snaps.empty:
        return pd.DataFrame(columns=PRICE_SCHEMA.names)
    final = snaps.sort_values("scraped_at").groupby(["id_product", "language"], dropna=False).tail(1)
    final = final[final["status"] == "ok"]
    if not offers.empty:
        offers = offers.merge(final[["id_product", "language", "run_id"]], on=["id_product", "language", "run_id"])
        groups = {k: g for k, g in offers.groupby(["id_product", "language"])}
    else:
        groups = {}
    # Inlandsversand heute je Produkt (alle Sprachen): Versand der Verkäufer aus dem Lieferland
    de_today: dict[int, list[int]] = {}
    if not offers.empty:
        dom = offers[(offers["seller_country"].astype(str).str.upper() == cfg.domestic_country)
                     & offers["shipping_cents"].notna()]
        for pid, g in dom.groupby("id_product"):
            de_today[int(pid)] = [int(v) for v in g["shipping_cents"]]
    ship_cache: dict[int, tuple[int | None, str]] = {}
    rows = []
    for snap in final.itertuples(index=False):
        g = groups.get((snap.id_product, snap.language))
        lines = [] if g is None else [
            Line(price=int(o.price_cents), shipping=None if pd.isna(o.shipping_cents) else int(o.shipping_cents),
                 quantity=int(o.quantity) if not pd.isna(o.quantity) else 1, country=o.seller_country if isinstance(o.seller_country, str) else None,
                 comment=o.comment if isinstance(o.comment, str) else None, article_id=int(o.article_id) if not pd.isna(o.article_id) else 0)
            for o in g.itertuples(index=False)
        ]
        n = None if pd.isna(snap.items_total) else int(snap.items_total)
        listings = None if pd.isna(snap.offers_total) else int(snap.offers_total)
        pid = int(snap.id_product)
        if pid not in ship_cache:
            ship_cache[pid] = domestic_shipping(pid, day, de_today, ship, cfg)
        ship_cents, ship_src = ship_cache[pid]
        for eu_only in (True, False):
            r = fair_price(lines, n, cfg, eu_only, listings)
            # Schritt 7 – Preis nur Artikel aus dem Preis inkl. Versand minus typischem Inlandsversand
            r.price_excl_median = r.price_excl
            r.price_excl = item_only_price(r, ship_cents)
            r.ship_deducted, r.ship_source = (ship_cents, ship_src) if r.price_incl is not None else (None, "none")
            if details is not None:
                details.append((int(snap.id_product), snap.language, eu_only, r))
            status = r.status
            if status == "alle_aussortiert" and n and n > sum(max(1, ln.quantity) for ln in lines):
                status = "alle_gespeicherten_aussortiert"  # teurere, nicht gespeicherte Angebote gäbe es noch
            rows.append({
                "day": day, "id_product": int(snap.id_product), "language": snap.language, "eu_only": eu_only,
                "price_incl_cents": r.price_incl, "price_excl_cents": r.price_excl,
                "cheapest_incl_cents": r.basket_incl_values[0] if r.basket_incl_values else None,
                "cheapest_excl_cents": r.basket_excl_values[0] if r.basket_excl_values else None,
                "status": status,
                "items_total": n, "listings": listings, "k": r.k, "basket_incl": r.basket_incl, "basket_excl": r.basket_excl,
                "lines_stored": len(lines), "lines_valid": r.lines_valid, "removed_country": r.removed_country,
                "removed_comment": r.removed_comment, "removed_lock": r.removed_lock, "removed_trim": r.removed_trim,
                "removed_no_shipping": r.removed_no_shipping,
                "ship_deducted_cents": r.ship_deducted, "ship_source": r.ship_source,
                "de_ship_median_cents": _median_cents(de_today[pid]) if de_today.get(pid) else None,
                "de_ship_n": len(de_today.get(pid, [])), "logic_hash": cfg.logic_hash,
            })
    ship.history[day] = {p: (_median_cents(v), len(v)) for p, v in de_today.items() if v}
    return pd.DataFrame(rows, columns=PRICE_SCHEMA.names)


def _ship_context(storage: Storage, game: str, first_day: date | None, cfg: PricingConfig) -> ShipContext:
    """Produktart je Produkt (Katalog) und Inlandsversand der Tage vor `first_day` aus den gespeicherten Preisen."""
    ctx = ShipContext()
    raw = storage.get(f"catalog/{game}/products.parquet")
    if raw:
        cat = parquet_to_df(raw)
        if "id_category" in cat:
            ctx.categories = {int(p): int(c) for p, c in zip(cat["id_product"], cat["id_category"]) if not pd.isna(c)}
    if first_day is None:
        return ctx
    for i in range(1, cfg.ship_lookback_days + 1):
        d = first_day - timedelta(days=i)
        raw = storage.get(price_key(game, d))
        if not raw:
            continue
        df = parquet_to_df(raw)
        if "de_ship_median_cents" not in df:
            continue
        df = df[df["eu_only"] == False].dropna(subset=["de_ship_median_cents"])  # noqa: E712
        df = df[df["de_ship_n"] > 0].drop_duplicates("id_product")
        ctx.history[d] = {int(p): (int(m), int(n)) for p, m, n in zip(df["id_product"], df["de_ship_median_cents"], df["de_ship_n"])}
    return ctx


def _product_names(storage: Storage, game: str) -> dict[int, str]:
    raw = storage.get(f"catalog/{game}/products.parquet")
    if not raw:
        return {}
    cat = parquet_to_df(raw)
    if "name" not in cat:
        return {}
    return {int(i): str(n) for i, n in zip(cat["id_product"], cat["name"]) if isinstance(n, str)}


def compare_prices(old: pd.DataFrame, new: pd.DataFrame, names: dict[int, str], day: date, top: int = 10) -> str:
    """Wie verändert eine neue Preislogik die fairen Preise (EU, inkl. Versand und nur Artikel) am Tag `day`?"""
    def eur(c) -> str:
        return f"{c / 100:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")

    out = [f"Faire Preise EU am {day:%d.%m.%Y}, alte gegen neue Logik."]
    for col, label in (("price_incl_cents", "inkl. Versand"), ("price_excl_cents", "nur Artikel")):
        cols = ["id_product", "language", col]
        o = old[old["eu_only"] == True][cols]  # noqa: E712 – Spalte kann object sein
        n = new[new["eu_only"] == True][cols]  # noqa: E712
        m = o.merge(n, on=["id_product", "language"], how="outer", suffixes=("_old", "_new"))
        a, b = f"{col}_old", f"{col}_new"
        both = m.dropna(subset=[a, b]).copy()
        both["pct"] = (both[b] / both[a] - 1) * 100
        changed = both[both[b] != both[a]]
        big = changed[changed["pct"].abs() > 20]
        gained = int((m[a].isna() & m[b].notna()).sum())
        lost = int((m[a].notna() & m[b].isna()).sum())
        out += ["", f"{label.upper()}:",
                f"- {len(both)} Varianten mit Preis vorher und nachher, davon {len(changed)} geändert, "
                f"{len(big)} um mehr als 20 %",
                f"- neu mit Preis: {gained}, ohne Preis: {lost}"]
        if len(changed):
            out.append(f"Größte Änderungen (bis zu {top}):")
            for r in changed.reindex(changed["pct"].abs().sort_values(ascending=False).index).head(top).itertuples():
                name = names.get(int(r.id_product), f"#{int(r.id_product)}")
                out.append(f"- {name} ({str(r.language).upper()}, ID {int(r.id_product)}): "
                           f"{eur(getattr(r, a))} → {eur(getattr(r, b))} ({r.pct:+.0f} %)")
    return "\n".join(out)


def scraped_days(storage: Storage, game: str) -> list[date]:
    days = set()
    for key in storage.list(f"scrape/{game}/snapshots/"):
        m = re.search(r"date=(\d{4}-\d{2}-\d{2})/", key)
        if m:
            days.add(date.fromisoformat(m.group(1)))
    return sorted(days)


def price_key(game: str, day: date) -> str:
    return f"prices/{game}/date={day.isoformat()}.parquet"


@dataclass
class PricingRun:
    game: str
    recomputed_all: bool
    days: list[date]
    variants: int = 0
    priced: int = 0
    today_prices: pd.DataFrame | None = None
    changes: str | None = None  # bei geänderter Logik: Vergleich alt/neu für den letzten Tag (Text für die Mail)


def run(scope: Scope, storage: Storage, cfg: PricingConfig, *, today: date, force_all: bool = False,
        details: list | None = None) -> PricingRun:
    """Heute + fehlende frühere Tage berechnen; bei geänderter Logik alle Tage. `details` gilt für heute."""
    meta_key = f"prices/{scope.game_key}/_meta.json"
    raw = storage.get(meta_key)
    old_hash = json.loads(raw).get("logic_hash") if raw else None
    recompute = force_all or old_hash != cfg.logic_hash
    existing = {k for k in storage.list(f"prices/{scope.game_key}/") if k.endswith(".parquet")}
    days = [d for d in scraped_days(storage, scope.game_key) if d <= today]
    targets = [d for d in days if recompute or d == today or price_key(scope.game_key, d) not in existing]
    result = PricingRun(scope.game_key, recompute, targets)
    last = max(targets) if targets else None
    ship_ctx = _ship_context(storage, scope.game_key, min(targets) if targets else None, cfg)
    for d in sorted(targets):
        old = None
        if recompute and old_hash and d == last:
            raw_old = storage.get(price_key(scope.game_key, d))
            old = parquet_to_df(raw_old) if raw_old else None
        df = price_day(scope, storage, d, cfg, details if d == today else None, ship_ctx)
        if old is not None and not old.empty:
            result.changes = compare_prices(old, df, _product_names(storage, scope.game_key), d)
        if d == today:
            result.today_prices = df
        storage.put(price_key(scope.game_key, d), df_to_parquet(df, PRICE_SCHEMA))
        result.variants += int((~df["eu_only"]).sum()) if not df.empty else 0
        result.priced += int(((~df["eu_only"]) & (df["status"] == "ok")).sum()) if not df.empty else 0
    storage.put(meta_key, json.dumps({"logic_hash": cfg.logic_hash, "algo_version": ALGO_VERSION,
                                      "config": cfg.raw}, ensure_ascii=False, indent=1).encode("utf-8"),
                "application/json")
    return result
