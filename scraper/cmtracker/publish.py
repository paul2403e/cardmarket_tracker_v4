"""Veröffentlichen: fertige JSON-Dateien für die Website aus Rohdaten + Preisen.

Die Website liest nur public/<spiel>/… (über eine Weiterleitung von Vercel; der Bucket bleibt privat):
  public/<spiel>/status.json          Stand, Zeitpunkt, Version (zum Neuladen nach Updates)
  public/<spiel>/catalog.json         alle Produkte mit aktuellen Werten je Sprache + Veränderungen (Startseite, Suche)
  public/<spiel>/spark.json           Preisverlauf der letzten 30 Tage je Variante (Mini-Diagramme)
  public/<spiel>/index.json           Marktindex (verkettet) gesamt und je Kategorie
  public/<spiel>/products/<id>.json   kompletter Verlauf + heutige Angebote eines Produkts (Produktseite)

Arbeitsmaterial (nicht öffentlich):
  history/<spiel>/month=JJJJ-MM.parquet   eine Zeile je Tag × Variante (wird täglich ergänzt)
  history/<spiel>/_meta.json              mit welcher Preislogik der Verlauf gebaut wurde

Beträge in den JSON-Dateien in Euro (2 Nachkommastellen). Veränderungen nur, wenn es am Anfang UND am Ende des
Zeitraums einen Preis gab (neue Produkte springen nicht "von 0 auf X").
"""

from __future__ import annotations

import hashlib
import json
import math
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd
import pyarrow as pa

from . import pricing
from .cardmarket import with_language
from .scrape import Keys
from .settings import Scope
from .storage import Storage, df_to_parquet, parquet_to_df

PUBLIC = "public"
PERIODS = {"1d": 1, "7d": 7, "30d": 30, "1y": 365}
SPARK_DAYS = 30
INDEX_TRIM = 0.05          # extremste 5 % oben/unten je Tag nicht mitzählen
INDEX_MIN_TRIM_N = 20      # erst ab so vielen Produkten trimmen

HISTORY_SCHEMA = pa.schema([
    ("day", pa.date32()), ("id_product", pa.int64()), ("language", pa.string()), ("status", pa.string()),
    ("eu_incl", pa.int64()), ("eu_excl", pa.int64()), ("all_incl", pa.int64()), ("all_excl", pa.int64()),
    ("eu_cheapest_incl", pa.int64()), ("eu_cheapest_excl", pa.int64()),
    ("all_cheapest_incl", pa.int64()), ("all_cheapest_excl", pa.int64()),
    ("eu_basket", pa.int64()), ("all_basket", pa.int64()),
    ("items_total", pa.int64()), ("offers_total", pa.int64()),
    ("trend", pa.float64()), ("avg30", pa.float64()), ("avg7", pa.float64()), ("avg1", pa.float64()),
])
PRICE_COLS = {"incl": "price_incl_cents", "excl": "price_excl_cents",
              "cheapest_incl": "cheapest_incl_cents", "cheapest_excl": "cheapest_excl_cents"}


def _read_table(storage: Storage, keys: Keys, table: str) -> pd.DataFrame:
    frames = [parquet_to_df(storage.get(k)) for k in storage.list(keys.day_prefix(table)) if k.endswith(".parquet")]
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


# --- Verlaufstabelle --------------------------------------------------------------------------
def history_rows(scope: Scope, storage: Storage, day: date) -> pd.DataFrame:
    """Eine Zeile je Variante des Tages (auch 'keine Angebote', damit der Bestand auf 0 geht)."""
    snaps = _read_table(storage, Keys(scope.game_key, day), "snapshots")
    if snaps.empty:
        return pd.DataFrame(columns=HISTORY_SCHEMA.names)
    final = snaps.sort_values("scraped_at").groupby(["id_product", "language"], dropna=False).tail(1)
    final = final[final["status"].isin(["ok", "no_offers"])].copy()
    raw = storage.get(pricing.price_key(scope.game_key, day))
    prices = parquet_to_df(raw) if raw else pd.DataFrame(columns=pricing.PRICE_SCHEMA.names)
    out = final[["id_product", "language", "status", "items_total", "offers_total",
                 "trend", "avg30", "avg7", "avg1"]].copy()
    out.insert(0, "day", day)
    for eu, prefix in ((True, "eu"), (False, "all")):
        p = prices[prices["eu_only"] == eu][["id_product", "language", *PRICE_COLS.values(), "basket_incl"]]
        p = p.rename(columns={v: f"{prefix}_{k}" for k, v in PRICE_COLS.items()} | {"basket_incl": f"{prefix}_basket"})
        out = out.merge(p, on=["id_product", "language"], how="left")
    out.loc[out["status"] == "no_offers", ["items_total", "offers_total"]] = 0
    for col in HISTORY_SCHEMA.names:
        if col not in out:
            out[col] = None
    return out[HISTORY_SCHEMA.names]


def _month_key(game: str, month: str) -> str:
    return f"history/{game}/month={month}.parquet"


def load_history(storage: Storage, game: str) -> pd.DataFrame:
    frames = [parquet_to_df(storage.get(k)) for k in sorted(storage.list(f"history/{game}/"))
              if k.endswith(".parquet")]
    if not frames:
        return pd.DataFrame(columns=HISTORY_SCHEMA.names)
    h = pd.concat(frames, ignore_index=True)
    h["day"] = pd.to_datetime(h["day"]).dt.date
    return h


def update_history(scope: Scope, storage: Storage, days: list[date], rebuild: bool) -> None:
    """Tage in die Monatsdateien schreiben (vorhandene Zeilen dieser Tage werden ersetzt)."""
    by_month: dict[str, list[date]] = {}
    for d in days:
        by_month.setdefault(d.strftime("%Y-%m"), []).append(d)
    if rebuild:
        for k in storage.list(f"history/{scope.game_key}/"):
            if k.endswith(".parquet"):
                storage.delete(k)
    for month, mdays in sorted(by_month.items()):
        key = _month_key(scope.game_key, month)
        raw = None if rebuild else storage.get(key)
        old = parquet_to_df(raw) if raw else pd.DataFrame(columns=HISTORY_SCHEMA.names)
        if not old.empty:
            old["day"] = pd.to_datetime(old["day"]).dt.date
            old = old[~old["day"].isin(mdays)]
        new = [history_rows(scope, storage, d) for d in mdays]
        frames = [f for f in [old, *new] if not f.empty]
        df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=HISTORY_SCHEMA.names)
        df = df.sort_values(["day", "id_product", "language"])
        storage.put(key, df_to_parquet(df, HISTORY_SCHEMA))


# --- Kennzahlen -------------------------------------------------------------------------------
def _eur(cents) -> float | None:
    if cents is None or (isinstance(cents, float) and math.isnan(cents)) or pd.isna(cents):
        return None
    return round(float(cents) / 100, 2)


def _num(v, nd: int = 2) -> float | None:
    if v is None or pd.isna(v):
        return None
    return round(float(v), nd)


def _int(v) -> int | None:
    return None if v is None or pd.isna(v) else int(v)


def _str(v) -> str | None:
    """Text oder None – fehlende Werte kommen aus Parquet je nach Datei als None oder NaN."""
    return v if isinstance(v, str) and v else None


def value_at(series: pd.Series, day: date, days_back: int) -> float | None:
    """Letzter Wert am oder vor (day - days_back), höchstens ein paar Tage älter (Laptop war aus).

    `series`: Index = Tage (aufsteigend), Werte ohne Lücken (NaN vorher entfernt)."""
    target = day - timedelta(days=days_back)
    tolerance = 3 if days_back <= 7 else (7 if days_back <= 30 else 21)
    s = series[(series.index <= target) & (series.index >= target - timedelta(days=tolerance))]
    return None if s.empty else float(s.iloc[-1])


def change(series: pd.Series, day: date, days_back: int) -> float | None:
    """Veränderung in Prozent; nur wenn es am Ende (heute) und am Anfang des Zeitraums einen Wert gibt."""
    if series.empty or series.index[-1] != day:
        return None
    end = float(series.iloc[-1])
    start = value_at(series, day, days_back)
    if start is None or start <= 0:
        return None
    return round((end / start - 1) * 100, 1)


def chained_index(h: pd.DataFrame, col: str, groups: dict[str, set[int]] | None = None) -> dict:
    """Verketteter Index (Start 100): je Tag nur Varianten mit Preis gestern UND heute; getrimmter Mittelwert
    der Log-Renditen. Neue Produkte bewegen den Index nur mit ihrer eigenen Veränderung."""
    piv = h.pivot_table(index="day", columns=["id_product", "language"], values=col, aggfunc="last").sort_index()
    days = list(piv.index)
    result = {"days": [d.isoformat() for d in days]}
    sets = {"all": None} | (groups or {})
    for name, ids in sets.items():
        cols = piv.columns if ids is None else [c for c in piv.columns if c[0] in ids]
        sub = piv[cols]
        values, level = [], 100.0
        for i, _ in enumerate(days):
            if i > 0:
                prev, cur = sub.iloc[i - 1], sub.iloc[i]
                ok = prev.notna() & cur.notna() & (prev > 0) & (cur > 0)
                r = np.log(cur[ok].astype(float) / prev[ok].astype(float)).sort_values()
                if len(r) >= INDEX_MIN_TRIM_N:
                    cut = int(len(r) * INDEX_TRIM)
                    r = r.iloc[cut:len(r) - cut] if cut else r
                if len(r):
                    level *= math.exp(float(r.mean()))
            values.append(round(level, 2))
        result[name] = values
    return result


# --- JSON bauen -------------------------------------------------------------------------------
@dataclass
class PublishResult:
    day: date
    products: int
    variants: int
    files_written: int
    rebuilt_history: bool


def _offers_today(scope: Scope, storage: Storage, day: date, cfg: pricing.PricingConfig) -> dict:
    """Heutige gespeicherte Angebote je Variante mit Kennzeichnung, ob/warum sie für den Preis nicht zählen."""
    keys = Keys(scope.game_key, day)
    snaps = _read_table(storage, keys, "snapshots")
    offers = _read_table(storage, keys, "offers")
    if snaps.empty or offers.empty:
        return {}
    final = snaps.sort_values("scraped_at").groupby(["id_product", "language"]).tail(1)
    final = final[final["status"] == "ok"]
    offers = offers.merge(final[["id_product", "language", "run_id", "items_total", "offers_total"]],
                          on=["id_product", "language", "run_id"])
    out: dict = {}
    for (pid, lang), g in offers.groupby(["id_product", "language"]):
        g = g.assign(total=g["price_cents"] + g["shipping_cents"].fillna(0)).sort_values(["total", "price_cents"])
        lines = [pricing.Line(price=int(o.price_cents),
                              shipping=None if pd.isna(o.shipping_cents) else int(o.shipping_cents),
                              quantity=int(o.quantity) if not pd.isna(o.quantity) else 1,
                              country=_str(o.seller_country), comment=_str(o.comment),
                              article_id=int(o.article_id) if not pd.isna(o.article_id) else 0)
                 for o in g.itertuples(index=False)]
        n = _int(g["items_total"].iloc[0])
        listings = _int(g["offers_total"].iloc[0])
        lock, skip = {}, {}
        for eu in (True, False):
            r = pricing.fair_price(lines, n, cfg, eu, listings)
            lock[eu] = {ln.article_id for ln, _ in r.lock_removed}
            skip[eu] = {ln.article_id for ln in r.trimmed}
        rows = []
        for o, ln in zip(g.itertuples(index=False), lines):
            why = cfg.comment_filter.reason(ln.comment)
            rows.append({
                "price": _eur(o.price_cents), "shipping": _eur(o.shipping_cents), "total": _eur(o.total),
                "qty": int(ln.quantity), "country": ln.country, "sellerType": _str(o.seller_type),
                "rating": _str(o.seller_rating), "sales": _int(o.seller_sales), "comment": ln.comment,
                "eu": (ln.country or "").upper() in cfg.eu_countries,
                "excluded": why, "lockEu": ln.article_id in lock[True], "lockAll": ln.article_id in lock[False],
                "skipEu": ln.article_id in skip[True], "skipAll": ln.article_id in skip[False],
            })
        out[(int(pid), lang)] = rows
    return out


def _series(h: pd.DataFrame, col: str) -> pd.Series:
    s = h[["day", col]].dropna().set_index("day")[col]
    return s[~s.index.duplicated(keep="last")].sort_index()


def build(scope: Scope, storage: Storage, day: date, cfg: pricing.PricingConfig, *,
          rebuild_history: bool = False) -> PublishResult:
    game = scope.game_key
    # 1. Verlauf aktualisieren (bei geänderter Preislogik komplett neu)
    meta_raw = storage.get(f"history/{game}/_meta.json")
    old_hash = json.loads(meta_raw).get("logic_hash") if meta_raw else None
    rebuild = rebuild_history or old_hash != cfg.logic_hash
    days = pricing.scraped_days(storage, game) if rebuild else [day]
    days = [d for d in days if d <= day]
    update_history(scope, storage, days, rebuild)
    storage.put(f"history/{game}/_meta.json", json.dumps({"logic_hash": cfg.logic_hash}).encode(),
                "application/json")
    hist = load_history(storage, game)

    # 2. Stammdaten
    keys = Keys(game, day)
    cat_raw, meta = storage.get(keys.catalog_state), storage.get(keys.meta)
    cat = parquet_to_df(cat_raw).set_index("id_product") if cat_raw else pd.DataFrame()
    mdf = parquet_to_df(meta).set_index("id_product") if meta else pd.DataFrame()

    def info(pid: int, col: str, frame: pd.DataFrame):
        if frame.empty or pid not in frame.index or col not in frame.columns:
            return None
        v = frame.at[pid, col]
        return None if (not isinstance(v, (list, np.ndarray)) and pd.isna(v)) else v

    offers_today = _offers_today(scope, storage, day, cfg)
    products: list[dict] = []
    spark: dict = {"days": [], "eu": {}, "all": {}}
    spark_days = sorted({d for d in hist["day"] if d <= day})[-SPARK_DAYS:]
    spark["days"] = [d.isoformat() for d in spark_days]
    files: dict[str, bytes] = {}
    variants = 0
    expansions: dict[int, list[int]] = {}

    for pid, ph in hist.groupby("id_product"):
        pid = int(pid)
        exp = info(pid, "id_expansion", cat)
        if exp is not None:
            expansions.setdefault(int(exp), []).append(pid)

    for pid, ph in hist.groupby("id_product"):
        pid = int(pid)
        url = info(pid, "url", mdf)
        langs_now, langs_full = {}, {}
        for lang, lh in ph.groupby("language"):
            lh = lh.sort_values("day")
            today = lh[lh["day"] == day]
            t = today.iloc[0] if len(today) else None
            s = {k: _series(lh, k) for k in ("eu_incl", "all_incl", "items_total")}
            now = {
                "status": _str(t["status"]) if t is not None else None,
                "price": {"eu": {"incl": _eur(t["eu_incl"]), "excl": _eur(t["eu_excl"])},
                          "all": {"incl": _eur(t["all_incl"]), "excl": _eur(t["all_excl"])}} if t is not None else None,
                "cheapest": {"eu": _eur(t["eu_cheapest_incl"]), "all": _eur(t["all_cheapest_incl"])}
                if t is not None else None,
                "items": _int(t["items_total"]) if t is not None else None,
                "offers": _int(t["offers_total"]) if t is not None else None,
                "basket": {"eu": _int(t["eu_basket"]), "all": _int(t["all_basket"])} if t is not None else None,
                "trend": _num(t["trend"]) if t is not None else None,
                "change": {p: {"eu": change(s["eu_incl"], day, n), "all": change(s["all_incl"], day, n),
                               "items": change(s["items_total"], day, n)} for p, n in PERIODS.items()},
                "url": with_language(url, lang) if isinstance(url, str) and url else None,
            }
            # kein Preis heute: letzter bekannter Preis "nur Artikel" (fürs Portfolio), mit Datum
            last = {}
            for key in ("eu", "all"):
                if now["price"] is None or now["price"][key]["excl"] is None:
                    ex = _series(lh, f"{key}_excl")
                    ex = ex[ex.index <= day]
                    if not ex.empty:
                        last[key] = {"excl": _eur(ex.iloc[-1]), "day": ex.index[-1].isoformat()}
            if last:
                now["last"] = last
            langs_now[lang] = now
            if t is not None:
                variants += 1
            sp = lh.set_index("day")
            for key in ("eu", "all"):
                vals = [(_eur(sp.at[d, f"{key}_incl"]) if d in sp.index else None) for d in spark_days]
                if any(v is not None for v in vals):
                    spark[key][f"{pid}:{lang}"] = vals
            langs_full[lang] = now | {"series": {
                "days": [d.isoformat() for d in lh["day"]],
                **{c: [_eur(v) for v in lh[c]] for c in ("eu_incl", "eu_excl", "all_incl", "all_excl",
                                                          "eu_cheapest_incl", "all_cheapest_incl")},
                "items": [_int(v) for v in lh["items_total"]], "offers": [_int(v) for v in lh["offers_total"]],
                "eu_basket": [_int(v) for v in lh["eu_basket"]], "all_basket": [_int(v) for v in lh["all_basket"]],
                "trend": [_num(v) for v in lh["trend"]], "avg30": [_num(v) for v in lh["avg30"]],
                "avg7": [_num(v) for v in lh["avg7"]], "avg1": [_num(v) for v in lh["avg1"]],
            }, "offersToday": offers_today.get((pid, lang), [])}
        exp = info(pid, "id_expansion", cat)
        base = {
            "id": pid, "name": info(pid, "name", cat), "nameDe": info(pid, "name_de", mdf),
            "category": info(pid, "category_name", cat), "categoryId": _int(info(pid, "id_category", cat)),
            "expansionId": _int(exp), "added": info(pid, "cm_date_added", cat),
            "active": bool(info(pid, "active", cat)) if info(pid, "active", cat) is not None else False,
            "image": info(pid, "image_url", mdf),
        }
        products.append(base | {"languages": langs_now})
        related = [r for r in expansions.get(int(exp), []) if r != pid] if exp is not None else []
        files[f"{PUBLIC}/{game}/products/{pid}.json"] = _json(base | {"languages": langs_full, "related": related})

    groups = {}
    if not cat.empty:
        for cid, cg in cat.groupby("id_category"):
            groups[str(int(cid))] = set(int(i) for i in cg.index)
    index = {"eu": chained_index(hist[hist["day"] <= day], "eu_incl", groups),
             "all": chained_index(hist[hist["day"] <= day], "all_incl", groups)}

    now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")
    version = hashlib.sha256(f"{day}{now_iso}".encode()).hexdigest()[:10]
    files[f"{PUBLIC}/{game}/catalog.json"] = _json({"game": game, "gameName": scope.game_name,
                                                   "day": day.isoformat(), "products": products})
    files[f"{PUBLIC}/{game}/spark.json"] = _json(spark)
    files[f"{PUBLIC}/{game}/index.json"] = _json(index | {"categories": {
        str(c.id): c.name for c in scope.categories}})

    written = _write_changed(storage, game, files)
    # status.json zuletzt: erst wenn alles andere liegt, sieht die Website den neuen Stand
    storage.put(f"{PUBLIC}/{game}/status.json", _json({
        "game": game, "gameName": scope.game_name, "day": day.isoformat(), "updatedAt": now_iso,
        "version": version, "products": len(products), "variants": variants, "logicHash": cfg.logic_hash,
    }), "application/json")
    return PublishResult(day, len(products), variants, written + 1, rebuild)


def _clean(obj):
    """Sicherheitsnetz: NaN/unendlich (= kein Wert) als null schreiben statt das Veröffentlichen abzubrechen."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    return obj


def _json(obj) -> bytes:
    return json.dumps(_clean(obj), ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def _write_changed(storage: Storage, game: str, files: dict[str, bytes]) -> int:
    """Nur geänderte Dateien hochladen (Prüfsummen in public/<spiel>/_manifest.json), parallel."""
    man_key = f"{PUBLIC}/{game}/_manifest.json"
    raw = storage.get(man_key)
    manifest = json.loads(raw) if raw else {}
    todo = {k: v for k, v in files.items() if manifest.get(k) != hashlib.sha256(v).hexdigest()}

    def put(item):
        storage.put(item[0], item[1], "application/json")

    with ThreadPoolExecutor(max_workers=16) as pool:
        list(pool.map(put, todo.items()))
    manifest.update({k: hashlib.sha256(v).hexdigest() for k, v in todo.items()})
    storage.put(man_key, json.dumps(manifest, separators=(",", ":")).encode(), "application/json")
    return len(todo)
