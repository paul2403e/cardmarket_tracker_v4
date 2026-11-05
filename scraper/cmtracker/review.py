"""Review-Ausgaben eines Katalog-Laufs: Zusammenfassung (Markdown) und Excel-Datei."""

from __future__ import annotations

import re
import urllib.parse
from pathlib import Path

import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from .catalog import CatalogResult
from .settings import Scope

# Stichwort-Hinweise als Prüfhilfe beim Review (beeinflussen den Scope nicht).
HINTS: list[tuple[str, str]] = [
    ("Chinesisch", r"S-Ch|\bT-Ch\b|Chinese|(?-i:^(CS|CBB)[A-Za-z0-9.]*C:|^\d+C:)"),
    ("Japanisch", r"\bJP\b|Japanese"),
    ("Koreanisch", r"Korean"),
    ("Case", r"Booster Box Case|\d+\s*(Elite Trainer Box|Sleeved Booster)\s*Case"),
    ("Zubehör?", r"Pencil Case|Magnet|Sticker|Sleeves|Binder|Playmat|Puzzle|Jigsaw|Figure|Plush|Calendar|"
                 r"Damage Counter|Deck Box|Portfolio"),
]

FONT = "Arial"
HEADER_FONT = Font(name=FONT, bold=True, color="FFFFFF")
HEADER_FILL = PatternFill("solid", fgColor="1F3864")
BODY = Font(name=FONT)
LINK = Font(name=FONT, color="0563C1", underline="single")
EURO = '#,##0.00 "€";-#,##0.00 "€";-'


def hints_for(name: str) -> str:
    return ", ".join(label for label, pat in HINTS if re.search(pat, name, re.IGNORECASE))


def search_url(game_name_url: str, name: str) -> str:
    return (f"https://www.cardmarket.com/de/{game_name_url}/Products/Search?searchString="
            + urllib.parse.quote(name))


def _joined(result: CatalogResult) -> pd.DataFrame:
    df = result.state.merge(result.prices[["id_product", "avg", "low", "trend"]], on="id_product", how="left")
    df["is_new"] = df["id_product"].isin(result.new_ids)
    df["is_removed"] = df["removed_since"].notna()
    return df


def category_table(result: CatalogResult) -> pd.DataFrame:
    df = _joined(result)
    present = df[~df["is_removed"]]
    table = present.groupby("category_name").agg(
        total=("id_product", "size"),
        in_scope=("in_scope", "sum"),
        active=("active", "sum"),
        new=("is_new", "sum"),
    )
    table["in_scope_category"] = table["in_scope"] > 0
    return table.sort_values(["in_scope_category", "total"], ascending=[False, False])


def summary_markdown(result: CatalogResult, scope: Scope) -> str:
    df = _joined(result)
    table = category_table(result)
    lines = [
        f"# Katalog & Price Guide – {scope.game_name}, Datentag {result.data_date.strftime('%d.%m.%Y')}",
        "",
        f"- Produktkatalog: Stand `{result.catalog_created_at}`",
        f"- Price Guide: Stand `{result.price_guide_created_at}`",
        f"- Speicher: {result.storage_description}",
        "",
    ]
    if result.warnings:
        lines += ["> ⚠️ **Hinweise**", ">"] + [f"> - {w}" for w in result.warnings] + [""]

    lines += [
        "| Kategorie | Produkte | im Scope | aktiv (mit Angeboten) | neu |",
        "|---|---:|---:|---:|---:|",
    ]
    for cat, r in table.iterrows():
        mark = "✅ " if r["in_scope_category"] else ""
        lines.append(f"| {mark}{cat} | {r['total']} | {r['in_scope']} | {r['active']} | {r['new']} |")
    lines.append(
        f"| **Summe** | **{int(table['total'].sum())}** | **{int(table['in_scope'].sum())}** | "
        f"**{int(table['active'].sum())}** | **{int(table['new'].sum())}** |"
    )
    lines.append("")

    if result.first_run:
        lines.append("Erster Lauf: Alle Produkte werden ab heute als „zuerst gesehen“ geführt, daher keine Neuheiten.")
    else:
        new_scope = df[df["is_new"] & df["in_scope"]].sort_values("id_product", ascending=False)
        if len(new_scope):
            lines += ["", f"## Neu im Scope ({len(new_scope)})", ""]
            for _, r in new_scope.head(50).iterrows():
                lines.append(f"- {r['name']} ({r['category_name']}, ID {r['id_product']})")
            if len(new_scope) > 50:
                lines.append(f"- … und {len(new_scope) - 50} weitere (siehe Excel)")
        if result.removed_ids:
            lines += ["", f"Aus dem Katalog verschwunden: {len(result.removed_ids)} Produkte (bleiben markiert erhalten)."]
        if result.reactivated_ids:
            lines += ["", f"Wieder aktiv (Angebote sind zurück): {len(result.reactivated_ids)} Produkte."]
    lines += ["", "Die vollständige Liste steht in der Excel-Datei unter **Artifacts** auf dieser Seite."]
    return "\n".join(lines) + "\n"


def write_excel(result: CatalogResult, scope: Scope, path: Path, game_name_url: str = "Pokemon") -> Path:
    df = _joined(result)
    df["category_in_scope"] = df["id_category"].isin(scope.category_ids)
    df = df.sort_values(
        ["category_in_scope", "category_name", "in_scope", "id_product"],
        ascending=[False, True, False, False],
    )

    wb = Workbook()
    ov = wb.active
    ov.title = "Übersicht"
    ws = wb.create_sheet("Alle Produkte")

    columns = [
        ("ID", 10), ("Name", 62), ("Kategorie", 28), ("Im Scope", 10), ("Angebote", 11), ("Aktiv", 8),
        ("Neu", 7), ("Zuerst gesehen", 15), ("Bei Cardmarket seit", 18), ("Ø Verkauf (avg)", 15),
        ("Tiefstpreis (low)", 16), ("Trend", 12), ("Status", 18), ("Hinweise", 22), ("Cardmarket-Suche", 16),
    ]
    for i, (title, width) in enumerate(columns, 1):
        c = ws.cell(1, i, title)
        c.font, c.fill = HEADER_FONT, HEADER_FILL
        ws.column_dimensions[get_column_letter(i)].width = width

    yes_no = {True: "Ja", False: "Nein"}
    for r, row in enumerate(df.itertuples(index=False), 2):
        status = f"entfernt seit {row.removed_since:%d.%m.%Y}" if row.is_removed else ""
        values = [
            row.id_product, row.name, row.category_name, yes_no[bool(row.in_scope)],
            yes_no[bool(row.has_offers)], yes_no[bool(row.active)], "Ja" if row.is_new else "",
            row.first_seen, row.cm_date_added, row.avg, row.low, row.trend, status, hints_for(row.name), "öffnen",
        ]
        for i, v in enumerate(values, 1):
            if isinstance(v, float) and pd.isna(v):
                v = None
            c = ws.cell(r, i, v)
            c.font = BODY
            if i in (10, 11, 12):
                c.number_format = EURO
            elif i == 8:
                c.number_format = "DD.MM.YYYY"
        link = ws.cell(r, 15)
        link.hyperlink = search_url(game_name_url, row.name)
        link.font = LINK
    last = len(df) + 1
    ws.freeze_panes = "C2"
    ws.auto_filter.ref = f"A1:O{last}"

    # Übersicht mit Formeln, die sich auf das Blatt "Alle Produkte" beziehen.
    ov["A1"] = f"{scope.game_name} – Katalog-Review, Datentag {result.data_date:%d.%m.%Y}"
    ov["A1"].font = Font(name=FONT, bold=True, size=14)
    ov["A2"] = (f"Quelle: Cardmarket Produktkatalog (Stand {result.catalog_created_at}) und "
                f"Price Guide (Stand {result.price_guide_created_at})")
    ov["A2"].font = Font(name=FONT, italic=True, color="595959")
    heads = ["Kategorie", "Kategorie im Scope", "Produkte", "im Scope", "aktiv (mit Angeboten)", "neu seit letztem Lauf"]
    for i, h in enumerate(heads, 1):
        c = ov.cell(4, i, h)
        c.font, c.fill = HEADER_FONT, HEADER_FILL
        c.alignment = Alignment(wrap_text=True, vertical="center")
    ref = "'Alle Produkte'!"
    cats = list(dict.fromkeys(df["category_name"]))
    for j, cat in enumerate(cats, 5):
        in_scope_cat = bool(df.loc[df["category_name"] == cat, "category_in_scope"].iloc[0])
        ov.cell(j, 1, cat).font = BODY
        ov.cell(j, 2, "Ja" if in_scope_cat else "Nein").font = Font(name=FONT, bold=in_scope_cat)
        ov.cell(j, 3, f'=COUNTIFS({ref}$C$2:$C${last},A{j},{ref}$M$2:$M${last},"")').font = BODY
        ov.cell(j, 4, f'=COUNTIFS({ref}$C$2:$C${last},A{j},{ref}$D$2:$D${last},"Ja")').font = BODY
        ov.cell(j, 5, f'=COUNTIFS({ref}$C$2:$C${last},A{j},{ref}$F$2:$F${last},"Ja")').font = BODY
        ov.cell(j, 6, f'=COUNTIFS({ref}$C$2:$C${last},A{j},{ref}$G$2:$G${last},"Ja")').font = BODY
    end = 4 + len(cats)
    total = end + 1
    ov.cell(total, 1, "Summe").font = Font(name=FONT, bold=True)
    for col in "CDEF":
        ov[f"{col}{total}"] = f"=SUM({col}5:{col}{end})"
        ov[f"{col}{total}"].font = Font(name=FONT, bold=True)

    notes = [
        "Erläuterung",
        "• Im Scope: Kategorie ist in scope.yaml freigegeben und das Produkt ist nicht ausgeschlossen.",
        "• Angebote: Cardmarket meldet heute einen Tiefstpreis (über alle Sprachen) – es gibt also mindestens ein Angebot.",
        "• Aktiv: im Scope UND mit Angeboten – nur diese Produkte werden ab Meilenstein 2 gescrapt.",
        "• Hinweise: automatische Stichwort-Markierung als Prüfhilfe (z. B. Chinesisch, Zubehör?), ohne Einfluss auf den Scope.",
        "• 'Ø Verkauf (avg)' ist der Durchschnittsverkaufspreis laut Price Guide, über alle Sprachen.",
        "• Produkte, die nicht mehr im Katalog stehen, sind unter 'Status' als entfernt markiert und in 'Produkte' nicht mitgezählt.",
    ]
    for k, text in enumerate(notes):
        ov.cell(total + 2 + k, 1, text).font = Font(name=FONT, bold=(k == 0))
    ov.column_dimensions["A"].width = 34
    for col in "BCDEF":
        ov.column_dimensions[col].width = 16
    ov.row_dimensions[4].height = 45

    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(path)
    return path
