"""Prüf-Excel für die fairen Preise eines Tages: Preise, aussortierte Kommentare, Lockangebote, Körbe.

Liegt 7 Tage in R2 unter review/ (siehe __main__.publish_review) und auf dem Laptop in Dokumente\\CM-Tracker\\Review.
"""

from __future__ import annotations

from collections import Counter
from datetime import date
from pathlib import Path

import pandas as pd
from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell

from .cardmarket import with_language
from .pricing import PricingConfig, PriceResult
from .scrape import Keys
from .scrape_review import _row, _sheet
from .settings import Scope
from .storage import Storage, parquet_to_df

STATUS_DE = {"ok": "ok", "alle_aussortiert": "alle aussortiert",
             "alle_gespeicherten_aussortiert": "alle gespeicherten aussortiert"}


def _eur(cents) -> float | None:
    return None if cents is None or (isinstance(cents, float) and pd.isna(cents)) else cents / 100


def _basket_text(values: list[int]) -> str:
    return " · ".join(f"{v / 100:.2f}".replace(".", ",") for v in values)


def write_pricing_excel(scope: Scope, storage: Storage, day: date, prices: pd.DataFrame,
                        details: list[tuple[int, str, bool, PriceResult]], cfg: PricingConfig,
                        path: Path) -> Path | None:
    if prices.empty:
        return None
    keys = Keys(scope.game_key, day)
    names, urls = {}, {}
    cat = storage.get(keys.catalog_state)
    if cat:
        cdf = parquet_to_df(cat)
        names = dict(zip(cdf["id_product"], cdf["name"]))
    meta = storage.get(keys.meta)
    if meta:
        mdf = parquet_to_df(meta)
        urls = dict(zip(mdf["id_product"], mdf["url"]))

    def link(pid: int, lang: str) -> str | None:
        url = urls.get(pid)
        return with_language(url, lang) if isinstance(url, str) and url else None

    by_key = {(pid, lang, eu): r for pid, lang, eu, r in details}
    eu = prices[prices["eu_only"]].set_index(["id_product", "language"])
    al = prices[~prices["eu_only"]].set_index(["id_product", "language"])
    wb = Workbook(write_only=True)

    # Übersicht
    ov = wb.create_sheet("Übersicht")
    ov.column_dimensions["A"].width = 52
    ov.column_dimensions["B"].width = 16
    ov.append([WriteOnlyCell(ov, value=f"Faire Preise {scope.game_name} – {day:%d.%m.%Y} (Logik {cfg.logic_hash})")])
    ov.append([])
    reasons = Counter(why.split(":")[0] for (_, _, e), r in by_key.items() if not e for _, why in r.comment_removed)
    for label, value in (
        ("Varianten (Produkt × Sprache) mit Angeboten", len(al)),
        ("… mit Preis (nur EU)", int((eu["status"] == "ok").sum())),
        ("… mit Preis (alle Länder)", int((al["status"] == "ok").sum())),
        ("Angebotszeilen aussortiert wegen Kommentar", int(al["removed_comment"].sum())),
        ("   davon A Schäden", reasons.get("A_schaden", 0)),
        ("   davon B Folie/Siegel", reasons.get("B_folie_siegel", 0)),
        ("   davon C Öffnen/Inhalt", reasons.get("C_oeffnen_inhalt", 0)),
        ("   davon D Risiko", reasons.get("D_risiko", 0)),
        ("Angebotszeilen aussortiert wegen Land (nur EU)", int(eu["removed_country"].sum())),
        ("Lockangebote entfernt (nur EU)", int(eu["removed_lock"].sum())),
    ):
        ov.append([label, value])
    ov.append([])
    for text in (
        "Preise: je Produkt und Sprache die vier fairen Preise, N (alle Stück vor jedem Filter), K (Korbgröße) "
        "und die Stückpreise im Korb (nach Lückenschutz).",
        "Aussortiert (Kommentar): alle wegen des Kommentars entfernten Angebote mit Grund (Kategorie: Wort).",
        "Lockangebote: entfernte Zeilen mit Gesamtpreis und Referenz (Median der nächsten bis zu 4 Zeilen).",
        "Logik und Wortliste: scraper/config/pricing.yaml – Änderungen gelten ab dem nächsten Lauf für alle Tage.",
    ):
        ov.append([text])

    # Preise
    ws = _sheet(wb, "Preise", [
        ("ID", 10), ("Produkt", 46), ("Sprache", 9), ("N", 7), ("K", 5),
        ("EU inkl. Versand", 14), ("EU nur Artikel", 14), ("alle inkl. Versand", 14), ("alle nur Artikel", 14),
        ("Status EU", 18), ("Korb EU inkl. (€)", 44), ("Korb EU nur Artikel (€)", 44),
        ("gespeicherte Zeilen", 11), ("raus: Land", 10), ("raus: Kommentar", 11), ("raus: Lock", 10), ("Link", 8),
    ])
    for (pid, lang), a in al.sort_index(ascending=[False, True]).iterrows():
        e = eu.loc[(pid, lang)]
        r_eu = by_key.get((pid, lang, True))
        url = link(pid, lang)
        _row(ws, [
            int(pid), names.get(pid, ""), lang, a["items_total"], int(e["k"]),
            _eur(e["price_incl_cents"]), _eur(e["price_excl_cents"]),
            _eur(a["price_incl_cents"]), _eur(a["price_excl_cents"]),
            STATUS_DE.get(e["status"], e["status"]),
            _basket_text(r_eu.basket_incl_values) if r_eu else "", _basket_text(r_eu.basket_excl_values) if r_eu else "",
            int(a["lines_stored"]), int(e["removed_country"]), int(a["removed_comment"]), int(e["removed_lock"]),
            "öffnen" if url else None,
        ], euro_cols={5, 6, 7, 8}, link_col=16, link_url=url)

    # Aussortiert (Kommentar) – aus der Rechnung "alle Länder", damit kein Angebot fehlt
    ws = _sheet(wb, "Aussortiert (Kommentar)", [
        ("ID", 10), ("Produkt", 40), ("Sprache", 9), ("Grund", 32), ("Kommentar", 70), ("Artikelpreis", 12),
        ("Versand", 10), ("Menge", 7), ("Land", 6),
    ])
    for (pid, lang, e), r in sorted(by_key.items(), key=lambda kv: (-kv[0][0], kv[0][1])):
        if e:
            continue
        for ln, why in r.comment_removed:
            _row(ws, [pid, names.get(pid, ""), lang, why, ln.comment, ln.price / 100,
                      _eur(ln.shipping), ln.quantity, ln.country], euro_cols={5, 6})

    # Lockangebote
    ws = _sheet(wb, "Lockangebote", [
        ("ID", 10), ("Produkt", 40), ("Sprache", 9), ("Rechnung", 12), ("Gesamtpreis", 12), ("Referenz", 12),
        ("Anteil", 8), ("Artikelpreis", 12), ("Versand", 10), ("Menge", 7), ("Land", 6), ("Kommentar", 50),
    ])
    for (pid, lang, e), r in sorted(by_key.items(), key=lambda kv: (-kv[0][0], kv[0][1], not kv[0][2])):
        for ln, ref in r.lock_removed:
            _row(ws, [pid, names.get(pid, ""), lang, "nur EU" if e else "alle Länder", ln.total / 100,
                      float(ref) / 100, f"{ln.total / float(ref):.0%}", ln.price / 100, _eur(ln.shipping),
                      ln.quantity, ln.country, ln.comment], euro_cols={4, 5, 7, 8})

    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(path)
    return path
