"""Tägliche Plausibilitätsprüfung, sobald ein Tag vollständig gescrapt ist.

Fängt Fälle ab, in denen nichts abstürzt, die Daten aber trotzdem nicht stimmen (z. B. ein Feld wird
nach einer Layout-Änderung nicht mehr gelesen, der Login ist still verloren, Filter greifen nicht).
Ergebnis: Kennzahlen + Liste der Auffälligkeiten; beides landet in status/<spiel>/latest.json.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone

import pandas as pd

from .scrape import Keys
from .settings import Scope
from .storage import Storage, parquet_to_df

ERROR_STATUSES = {"fetch_error", "parse_error", "not_found"}
MIN_OFFERS_FOR_RATIOS = 200  # unter dieser Menge sind Anteile zu zufällig (z. B. sehr kleine Läufe)


@dataclass
class QualityReport:
    game: str
    day: str
    complete: bool
    metrics: dict = field(default_factory=dict)
    issues: list[str] = field(default_factory=list)       # Schwellen überschritten -> Mail
    not_found: list[str] = field(default_factory=list)    # neu nicht gefunden -> Mail
    not_found_ids: list[int] = field(default_factory=list)  # alle heute nicht gefundenen (für den Folgetag)
    still_not_found: int = 0                              # schon gestern nicht gefunden (keine erneute Mail)
    url_changes: list[str] = field(default_factory=list)  # URL geändert -> Mail
    no_language: list[str] = field(default_factory=list)  # neu ausgeschlossen (nur Info)

    @property
    def needs_alert(self) -> bool:
        return bool(self.issues or self.not_found or self.url_changes)

    def email_body(self) -> str:
        lines = [f"Plausibilitätsprüfung {self.game}, {self.day}", ""]
        if not self.needs_alert:
            lines += ["✅ Keine Auffälligkeiten – alle Prüfungen innerhalb der Schwellen.", ""]
        if self.issues:
            lines += ["Auffälligkeiten:"] + [f"- {i}" for i in self.issues] + [""]
        if self.not_found:
            lines += [f"Produktseite neu nicht gefunden ({len(self.not_found)}) – wird täglich weiter gesucht:"] + \
                     [f"- {n}" for n in self.not_found[:50]] + [""]
        if self.still_not_found:
            lines += [f"Weiterhin nicht gefunden (bereits gemeldet): {self.still_not_found}", ""]
        if self.url_changes:
            lines += [f"Produkt-URL hat sich geändert ({len(self.url_changes)}) – neue URL wird automatisch genutzt:"] + \
                     [f"- {u}" for u in self.url_changes[:50]] + [""]
        lines += ["Kennzahlen:"] + [f"- {k}: {v}" for k, v in self.metrics.items()]
        return "\n".join(lines)


def _read_day(storage: Storage, keys: Keys, table: str) -> pd.DataFrame:
    frames = [parquet_to_df(storage.get(k)) for k in storage.list(keys.day_prefix(table)) if k.endswith(".parquet")]
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def _share(part: float, total: float) -> float:
    return round(part / total, 4) if total else 0.0


def check_day(scope: Scope, storage: Storage, keys: Keys, thresholds: dict) -> QualityReport:
    t = thresholds.get("scrape", {})
    report = QualityReport(game=scope.game_key, day=keys.day.isoformat(), complete=True)
    snaps = _read_day(storage, keys, "snapshots")
    offers = _read_day(storage, keys, "offers")
    progress_raw = storage.get(keys.progress)
    progress = json.loads(progress_raw) if progress_raw else {"runs": []}

    names = {}
    cat = storage.get(keys.catalog_state)
    if cat:
        cdf = parquet_to_df(cat)
        names = dict(zip(cdf["id_product"], cdf["name"]))

    if snaps.empty:
        report.issues.append("Keine Snapshots für den Tag gefunden.")
        return report

    # Pro Variante zählt der letzte Versuch (z. B. erfolgreicher zweiter Versuch nach einem Fehler)
    final = snaps.sort_values("scraped_at").groupby(["id_product", "language"], dropna=False).tail(1)
    ok = final[final["status"] == "ok"]
    errors = final[final["status"].isin(ERROR_STATUSES)]
    m = report.metrics
    m["Varianten"] = int(len(final))
    m["davon ok"] = int(len(ok))
    m["davon ohne Angebote"] = int((final["status"] == "no_offers").sum())
    m["davon mit Fehler"] = int(len(errors))

    def flag(label: str, value: float, limit: float, too_high: bool = True) -> None:
        m[label] = f"{value:.1%}"
        if (value > limit) if too_high else (value < limit):
            relation = "über" if too_high else "unter"
            report.issues.append(f"{label}: {value:.1%} ({relation} der Schwelle {limit:.0%})")

    flag("Anteil Varianten mit Fehler", _share(len(errors), len(final)), t.get("error_variants_max", 0.02))
    # "Nicht gefunden" nur melden, wenn es gestern noch nicht so war – sonst käme täglich dieselbe Mail
    missing = final[final["status"] == "not_found"]
    report.not_found_ids = sorted({int(i) for i in missing["id_product"]})
    prev_raw = storage.get(f"status/{keys.game}/date={(keys.day - timedelta(days=1)).isoformat()}.json")
    already = set(json.loads(prev_raw).get("not_found_ids") or []) if prev_raw else set()
    new_ids = [i for i in report.not_found_ids if i not in already]
    report.still_not_found = len(report.not_found_ids) - len(new_ids)
    report.not_found = [f"{names.get(i, i)} (ID {i})" for i in new_ids]
    m["Produkte nicht gefunden"] = len(report.not_found_ids)
    for run in progress.get("runs", []):
        report.url_changes += run.get("url_changes") or []
        report.no_language += run.get("no_language") or []

    if len(ok):
        flag("Anteil nicht vollständig gezählt", _share((~ok["count_complete"].astype(bool)).sum(), len(ok)),
             t.get("incomplete_counts_max", 0.02))
        flag("Füllquote Verfügbare Artikel", _share(ok["available_items"].notna().sum(), len(ok)),
             t.get("field_fill_min", 0.95), too_high=False)
        if "offers_wrong_language" in ok and ok["offers_total"].sum() >= MIN_OFFERS_FOR_RATIOS:
            flag("Anteil Angebote in falscher Sprache",
                 _share(ok["offers_wrong_language"].fillna(0).sum(), ok["offers_total"].sum()),
                 t.get("wrong_language_max", 0.02))

    if len(offers) >= MIN_OFFERS_FOR_RATIOS:
        n = len(offers)
        flag("Anteil Angebote ohne Versandkosten", _share(offers["shipping_cents"].isna().sum(), n),
             t.get("shipping_missing_max", 0.05))
        fill_min = t.get("field_fill_min", 0.95)
        flag("Füllquote Land", _share(offers["seller_country"].notna().sum(), n), fill_min, too_high=False)
        flag("Füllquote Bewertung", _share(offers["seller_rating"].notna().sum(), n), fill_min, too_high=False)
        flag("Füllquote Verkaufsanzahl", _share(offers["seller_sales"].notna().sum(), n), fill_min, too_high=False)
        flag("Anteil gewerblicher Verkäufer",
             _share(offers["seller_type"].isin(["professional", "powerseller"]).sum(), n),
             t.get("professional_share_min", 0.05), too_high=False)

    requests = sum(r.get("requests", 0) for r in progress.get("runs", []))
    fallbacks = sum(r.get("fallbacks", 0) for r in progress.get("runs", []))
    m["Abrufe"] = requests
    if requests >= MIN_OFFERS_FOR_RATIOS:
        flag("Anteil Abrufe über FlareSolverr", _share(fallbacks, requests), t.get("flaresolverr_share_max", 0.10))
    return report


def write_status(storage: Storage, keys: Keys, report: QualityReport, extra: dict | None = None) -> None:
    """Kleine Statusdatei für das Frontend ('zuletzt aktualisiert', Warnungen)."""
    status = asdict(report) | {"updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")} | (extra or {})
    data = json.dumps(status, indent=1, ensure_ascii=False).encode("utf-8")
    storage.put(f"status/{keys.game}/latest.json", data, "application/json")
    storage.put(f"status/{keys.game}/date={keys.day.isoformat()}.json", data, "application/json")
