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
from datetime import date
from fractions import Fraction
from pathlib import Path

import pandas as pd
import pyarrow as pa
import yaml

from .scrape import Keys
from .settings import Scope
from .storage import Storage, df_to_parquet, parquet_to_df

ALGO_VERSION = 4   # bei Änderungen an der Rechenlogik im Code erhöhen -> komplette Neuberechnung
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
    ("k", pa.int64()),                    # Korbgröße laut Formel
    ("basket_incl", pa.int64()),          # tatsächliche Korbgröße nach Lückenschutz
    ("basket_excl", pa.int64()),
    ("lines_stored", pa.int64()),         # gespeicherte Angebotszeilen (günstigste je Sortierung)
    ("lines_valid", pa.int64()),          # nach Land/Kommentar/Lockangeboten
    ("removed_country", pa.int64()),
    ("removed_comment", pa.int64()),
    ("removed_lock", pa.int64()),
    ("removed_no_shipping", pa.int64()),
    ("logic_hash", pa.string()),
])


# --- Konfiguration ----------------------------------------------------------------------------
@dataclass
class PricingConfig:
    raw: dict
    eu_countries: frozenset
    comment_filter: "CommentFilter"
    lock_ratio: Fraction
    lock_ratio_few: Fraction
    lock_reference_lines: int
    lock_min_lines: int
    lock_gap: Fraction
    lock_max_group: int
    lock_max_rounds: int
    basket_share: Fraction
    basket_min: int
    basket_max: int
    gap_factor: Fraction
    gap_min_share: Fraction
    logic_hash: str = ""


def load_pricing(path: Path = PRICING_FILE) -> PricingConfig:
    text = Path(path).read_text(encoding="utf-8")
    raw = yaml.safe_load(text)
    f = lambda v: Fraction(str(v))  # noqa: E731 – exakte Dezimalzahlen (0,15 × 20 = 3, nicht 2,999…)
    cfg = PricingConfig(
        raw=raw,
        eu_countries=frozenset(c.upper() for c in raw["eu_countries"]),
        comment_filter=CommentFilter(raw["comment_filter"]),
        lock_ratio=f(raw["lock_offers"]["ratio"]),
        lock_ratio_few=f(raw["lock_offers"].get("ratio_few_lines", raw["lock_offers"]["ratio"])),
        lock_reference_lines=int(raw["lock_offers"]["reference_lines"]),
        lock_min_lines=int(raw["lock_offers"]["min_lines"]),
        lock_gap=f(raw["lock_offers"].get("gap", 0.8)),
        lock_max_group=int(raw["lock_offers"].get("max_group", 2)),
        lock_max_rounds=int(raw["lock_offers"].get("max_rounds", 2)),
        basket_share=f(raw["basket"]["share"]),
        basket_min=int(raw["basket"]["min"]),
        basket_max=int(raw["basket"]["max"]),
        gap_factor=f(raw["gap"]["factor"]),
        gap_min_share=f(raw["gap"]["min_share"]),
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
    removed_no_shipping: int = 0
    reasons: list[str] = field(default_factory=list)
    # Details für die Prüf-Excel
    comment_removed: list[tuple["Line", str]] = field(default_factory=list)
    lock_removed: list[tuple["Line", Fraction]] = field(default_factory=list)
    basket_incl_values: list[int] = field(default_factory=list)
    basket_excl_values: list[int] = field(default_factory=list)


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


def fair_price(lines: list[Line], items_total: int | None, cfg: PricingConfig, eu_only: bool) -> PriceResult:
    res = PriceResult()
    # Schritt 1 – ungültige Angebote
    valid: list[Line] = []
    for ln in lines:
        if ln.shipping is None:
            res.removed_no_shipping += 1
            continue
        if eu_only and (ln.country or "").upper() not in cfg.eu_countries:
            res.removed_country += 1
            continue
        why = cfg.comment_filter.reason(ln.comment)
        if why:
            res.removed_comment += 1
            res.reasons.append(why)
            res.comment_removed.append((ln, why))
            continue
        valid.append(ln)
    if not valid:
        res.status = "alle_aussortiert"
        return res

    # Schritt 2 – Lockangebote (pro Zeile, Gesamtpreis): die günstigste Zeile bzw. die zwei günstigsten als
    # Gruppe, wenn sie (a) unter ratio × Median der nächsten Zeilen liegen UND (b) eine echte Lücke zur
    # nächsten Zeile haben. Höchstens max_rounds Durchgänge – keine Kettenreaktion bei Treppen-Märkten.
    # Dünner Markt (weniger Vergleichszeilen als reference_lines): dort liegen auch echte Preise weit
    # auseinander, darum zählt erst ein deutlich tieferer Preis (ratio_few_lines) als Lockangebot.
    valid.sort(key=lambda ln: (ln.total, ln.price, ln.article_id))
    for _ in range(cfg.lock_max_rounds):
        removed = False
        for g in range(1, cfg.lock_max_group + 1):
            if len(valid) < g + cfg.lock_min_lines - 1:
                break
            group_max = valid[g - 1].total
            refs = [ln.total for ln in valid[g:g + cfg.lock_reference_lines]]
            ref = _median_cents_exact(refs)
            ratio = cfg.lock_ratio if len(refs) >= cfg.lock_reference_lines else cfg.lock_ratio_few
            if group_max < cfg.lock_gap * valid[g].total and group_max < ratio * ref:
                res.lock_removed.extend((ln, ref) for ln in valid[:g])
                res.removed_lock += g
                valid = valid[g:]
                removed = True
                break
        if not removed:
            break
    res.lines_valid = len(valid)

    # Schritt 3 – Einzelstücke
    incl = [ln.total for ln in valid for _ in range(max(1, ln.quantity))]
    excl = [ln.price for ln in valid for _ in range(max(1, ln.quantity))]

    # Schritt 4 – K aus N (alle gelisteten Stück vor jedem Filter)
    n = items_total if items_total else sum(max(1, ln.quantity) for ln in lines)
    res.k = max(cfg.basket_min, min(cfg.basket_max, int(cfg.basket_share * n)))

    # Schritte 5–6
    res.price_incl, res.basket_incl_values = _basket_price(incl, res.k, cfg)
    res.price_excl, res.basket_excl_values = _basket_price(excl, res.k, cfg)
    res.basket_incl, res.basket_excl = len(res.basket_incl_values), len(res.basket_excl_values)
    return res


def _median_cents_exact(values: list[int]) -> Fraction:
    v = sorted(values)
    n = len(v)
    return Fraction(v[n // 2]) if n % 2 else Fraction(v[n // 2 - 1] + v[n // 2], 2)


# --- Tage berechnen ---------------------------------------------------------------------------
def _read_table(storage: Storage, keys: Keys, table: str) -> pd.DataFrame:
    frames = [parquet_to_df(storage.get(k)) for k in storage.list(keys.day_prefix(table)) if k.endswith(".parquet")]
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def price_day(scope: Scope, storage: Storage, day: date, cfg: PricingConfig,
              details: list | None = None) -> pd.DataFrame:
    """Preise eines Tages. Mit `details` (Liste) kommen je Variante (id, Sprache, eu_only, PriceResult) dazu."""
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
    rows = []
    for snap in final.itertuples(index=False):
        g = groups.get((snap.id_product, snap.language))
        lines = [] if g is None else [
            Line(price=int(o.price_cents), shipping=None if pd.isna(o.shipping_cents) else int(o.shipping_cents),
                 quantity=int(o.quantity) if not pd.isna(o.quantity) else 1, country=o.seller_country,
                 comment=o.comment if isinstance(o.comment, str) else None, article_id=int(o.article_id) if not pd.isna(o.article_id) else 0)
            for o in g.itertuples(index=False)
        ]
        n = None if pd.isna(snap.items_total) else int(snap.items_total)
        for eu_only in (True, False):
            r = fair_price(lines, n, cfg, eu_only)
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
                "items_total": n, "k": r.k, "basket_incl": r.basket_incl, "basket_excl": r.basket_excl,
                "lines_stored": len(lines), "lines_valid": r.lines_valid, "removed_country": r.removed_country,
                "removed_comment": r.removed_comment, "removed_lock": r.removed_lock,
                "removed_no_shipping": r.removed_no_shipping, "logic_hash": cfg.logic_hash,
            })
    return pd.DataFrame(rows, columns=PRICE_SCHEMA.names)


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
    for d in targets:
        df = price_day(scope, storage, d, cfg, details if d == today else None)
        if d == today:
            result.today_prices = df
        storage.put(price_key(scope.game_key, d), df_to_parquet(df, PRICE_SCHEMA))
        result.variants += int((~df["eu_only"]).sum()) if not df.empty else 0
        result.priced += int(((~df["eu_only"]) & (df["status"] == "ok")).sum()) if not df.empty else 0
    storage.put(meta_key, json.dumps({"logic_hash": cfg.logic_hash, "algo_version": ALGO_VERSION,
                                      "config": cfg.raw}, ensure_ascii=False, indent=1).encode("utf-8"),
                "application/json")
    return result
