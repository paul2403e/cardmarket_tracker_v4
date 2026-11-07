"""Review-Excel für einen Scrape-Lauf: alle Varianten und gespeicherten Angebote dieses Laufs.

Der Server legt die Datei 7 Tage lang in R2 unter review/ ab (siehe __main__.publish_review).
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter

from .scrape import Keys, ScrapeResult
from .settings import Scope
from .storage import Storage, parquet_to_df

FONT = "Arial"
HEADER_FONT = Font(name=FONT, bold=True, color="FFFFFF")
HEADER_FILL = PatternFill("solid", fgColor="1F3864")
BODY = Font(name=FONT)
LINK = Font(name=FONT, color="0563C1", underline="single")
EURO = '#,##0.00 "€";-#,##0.00 "€";-'
STATUS_DE = {"ok": "ok", "no_offers": "keine Angebote", "fetch_error": "Abruffehler",
             "parse_error": "Lesefehler", "not_found": "nicht gefunden"}


def load_run_tables(storage: Storage, keys: Keys, run_id: str) -> dict[str, pd.DataFrame]:
    tables = {}
    for table in ("snapshots", "offers"):
        frames = [parquet_to_df(storage.get(k)) for k in storage.list(keys.day_prefix(table))
                  if k.endswith(".parquet")]
        df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
        tables[table] = df[df["run_id"] == run_id].reset_index(drop=True) if len(df) else df
    return tables


def _sheet(wb: Workbook, title: str, columns: list[tuple[str, int]]):
    ws = wb.create_sheet(title)
    for i, (_, width) in enumerate(columns, 1):
        ws.column_dimensions[get_column_letter(i)].width = width
    ws.freeze_panes = "C2"
    header = []
    for name, _ in columns:
        c = WriteOnlyCell(ws, value=name)
        c.font, c.fill = HEADER_FONT, HEADER_FILL
        header.append(c)
    ws.append(header)
    return ws


def _row(ws, values: list, euro_cols: set[int] = frozenset(), link_col: int | None = None,
         link_url: str | None = None) -> None:
    cells = []
    for i, v in enumerate(values):
        if isinstance(v, float) and pd.isna(v):
            v = None
        c = WriteOnlyCell(ws, value=v)
        c.font = BODY
        if i in euro_cols:
            c.number_format = EURO
        if link_col is not None and i == link_col and link_url:
            c.hyperlink = link_url
            c.font = LINK
        cells.append(c)
    ws.append(cells)


def write_scrape_excel(result: ScrapeResult, scope: Scope, storage: Storage, path: Path) -> Path | None:
    keys = Keys(scope.game_key, result.day)
    t = load_run_tables(storage, keys, result.run_id)
    snaps, offers = t["snapshots"], t["offers"]
    if snaps.empty:
        return None

    names = {}
    cat = storage.get(keys.catalog_state)
    if cat:
        cdf = parquet_to_df(cat)
        names = dict(zip(cdf["id_product"], cdf["name"]))
    meta_raw = storage.get(keys.meta)
    names_de = {}
    if meta_raw:
        mdf = parquet_to_df(meta_raw)
        names_de = dict(zip(mdf["id_product"], mdf["name_de"]))

    cheapest = pd.DataFrame()
    if not offers.empty:
        o = offers.assign(total=offers["price_cents"] + offers["shipping_cents"].fillna(0))
        cheapest = o.groupby(["id_product", "language"]).agg(
            min_total=("total", "min"), min_price=("price_cents", "min")).reset_index()
    v = snaps.merge(cheapest, on=["id_product", "language"], how="left") if not cheapest.empty else snaps

    wb = Workbook(write_only=True)

    # Übersicht
    ov = wb.create_sheet("Übersicht")
    ov.column_dimensions["A"].width = 40
    ov.column_dimensions["B"].width = 18
    ov.append([WriteOnlyCell(ov, value=f"Scrape {scope.game_name} – {result.day:%d.%m.%Y}, Lauf {result.run_id}")])
    ov.append([f"Produkte in diesem Lauf: {result.products_done_now}",
               f"heute insgesamt: {result.products_done_before + result.products_done_now} von {result.products_total}"])
    ov.append([f"Abrufe: {result.requests} in {result.seconds / 60:.1f} Minuten"])
    if result.stopped_reason:
        ov.append([result.stopped_reason])
    ov.append([])
    last = len(v) + 1
    ov.append(["Status", "Varianten"])
    for status_de in STATUS_DE.values():
        ov.append([status_de, f'=COUNTIF(Varianten!$D$2:$D${last},"{status_de}")'])
    ov.append(["davon nicht vollständig gezählt", f'=COUNTIF(Varianten!$I$2:$I${last},"nein")'])
    ov.append([])
    ov.append(["Erläuterung"])
    for text in (
        "Varianten: je Produkt und Sprache ein Eintrag mit Infobox-Werten, Summen und günstigsten Preisen.",
        "Angebote: gespeichert werden die 50 günstigsten nach Endpreis (inkl. Versand) und die 50 günstigsten "
        "nach Artikelpreis – Rang 1 = günstigstes.",
        "Bestand: Spalten 'Angebote' und 'Stück' im Blatt Varianten – Summe über alle Angebote der Sprache.",
        "Versandkosten gelten für die Lieferadresse des Cardmarket-Accounts.",
    ):
        ov.append([text])

    # Varianten
    ws = _sheet(wb, "Varianten", [
        ("ID", 10), ("Produkt", 48), ("Sprache", 9), ("Status", 15), ("Verfügbare Artikel (alle Sprachen)", 16),
        ("Angebote", 10), ("Stück", 9), ("Angebote gespeichert", 12), ("vollständig gezählt", 12),
        ("günstigster Endpreis", 14), ("günstigster Artikelpreis", 14), ("Trend", 12), ("Ø 30 Tage", 12),
        ("Ø 7 Tage", 12), ("Ø 1 Tag", 12), ("Abrufe", 8), ("Hinweis", 40), ("Deutscher Name", 36), ("Link", 10),
    ])
    for r in v.sort_values(["id_product", "language"], ascending=[False, True]).itertuples(index=False):
        min_total = getattr(r, "min_total", None)
        min_price = getattr(r, "min_price", None)
        _row(ws, [
            int(r.id_product), names.get(r.id_product, ""), r.language, STATUS_DE.get(r.status, r.status),
            r.available_items, r.offers_total, r.items_total, r.offers_stored,
            "ja" if r.count_complete else "nein",
            None if min_total is None or pd.isna(min_total) else min_total / 100,
            None if min_price is None or pd.isna(min_price) else min_price / 100,
            r.trend, r.avg30, r.avg7, r.avg1, r.requests, r.note, names_de.get(r.id_product, ""), "öffnen",
        ], euro_cols={9, 10, 11, 12, 13, 14}, link_col=18, link_url=r.url)

    # Angebote
    ws = _sheet(wb, "Angebote", [
        ("ID", 10), ("Produkt", 44), ("Sprache", 9), ("Rang Endpreis", 10), ("Rang Artikelpreis", 10),
        ("Artikelpreis", 12), ("Versand", 10), ("Endpreis", 12), ("Menge", 8), ("Land", 7),
        ("Verkäufertyp", 13), ("Bewertung", 12), ("Verkäufe", 9), ("Kommentar", 50), ("Angebots-ID", 14),
    ])
    if not offers.empty:
        for r in offers.sort_values(["id_product", "language", "rank_total"],
                                    ascending=[False, True, True]).itertuples(index=False):
            ship = None if pd.isna(r.shipping_cents) else r.shipping_cents / 100
            _row(ws, [
                int(r.id_product), names.get(r.id_product, ""), r.language, r.rank_total, r.rank_price,
                r.price_cents / 100, ship, r.price_cents / 100 + (ship or 0), r.quantity, r.seller_country,
                r.seller_type, r.seller_rating, r.seller_sales, r.comment, int(r.article_id),
            ], euro_cols={5, 6, 7})

    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(path)
    return path
