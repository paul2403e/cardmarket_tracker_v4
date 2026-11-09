"use client";

// Excel (Meilenstein 6c): Vorlage mit allen Produkten, Import mit Vorschau, Export von Beständen und Transaktionen.
// Läuft komplett im Browser; exceljs wird erst beim Klick geladen.
import type ExcelJS from "exceljs";
import { GAMES, gameOf } from "./games";
import { positions, todayIso, type Depot, type Txn, type TxnInput } from "./portfolio";
import type { Catalog, Lang, Region } from "./types";
import { valuate } from "./valuation";

const LANG_CODE: Record<Lang, string> = { en: "EN", de: "DE", ja: "JP" };
const CODE_LANG: Record<string, Lang> = { EN: "en", DE: "de", JP: "ja", JA: "ja" };

// Spalten der Spiel-Blätter (1-basiert wie in Excel)
const COLS = [
  { key: "category", header: "Category", width: 22 },
  { key: "product", header: "Product", width: 52 },
  { key: "language", header: "Language", width: 10 },
  { key: "id", header: "Cardmarket ID", width: 14 },
  { key: "portfolio", header: "Portfolio", width: 18 },
  { key: "qtyBought", header: "Quantity bought", width: 11 },
  { key: "priceBought", header: "Price per item (incl. shipping & fees)", width: 16 },
  { key: "dateBought", header: "Purchase date", width: 13 },
  { key: "qtySold", header: "Quantity sold", width: 11 },
  { key: "priceSold", header: "Received per item (after fees & shipping)", width: 16 },
  { key: "dateSold", header: "Sale date", width: 13 },
  { key: "note", header: "Note", width: 30 },
] as const;
const COL = Object.fromEntries(COLS.map((c, i) => [c.key, i + 1])) as Record<(typeof COLS)[number]["key"], number>;
const FILL_FROM = COL.portfolio;

const EURO_FMT = '#,##0.00 "€"';
const DATE_FMT = "dd.mm.yyyy";

async function exceljs(): Promise<typeof ExcelJS> {
  const mod = await import("exceljs");
  return (mod.default ?? mod) as typeof ExcelJS;
}

async function download(wb: ExcelJS.Workbook, name: string) {
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function styleHeader(ws: ExcelJS.Worksheet, editableFrom?: number) {
  const row = ws.getRow(1);
  row.height = 34;
  row.eachCell((cell, n) => {
    const editable = editableFrom !== undefined && n >= editableFrom;
    cell.font = { bold: true, color: { argb: editable ? "FFFFFFFF" : "FF17212B" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: editable ? "FF2147C9" : "FFE7ECFB" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

// --- Vorlage ---------------------------------------------------------------------------------
export async function downloadTemplate(catalogs: Record<string, Catalog | undefined>, depots: Depot[]) {
  const E = await exceljs();
  const wb = new E.Workbook();
  wb.creator = "CM Tracker";
  const firstDepot = depots[0]?.name ?? "Main";

  const how = wb.addWorksheet("How to");
  how.getColumn(1).width = 110;
  const lines: [string, boolean?][] = [
    ["How to import your collection", true],
    [""],
    ["1. Each game has its own sheet with every product and language. Use the filter arrows in the header to find a product."],
    ["2. Fill in only the blue columns. Rows you leave empty are ignored."],
    [`3. Portfolio: the name of the portfolio. Empty = "${firstDepot}". A new name creates a new portfolio during the import.`],
    ["4. Purchase: Quantity bought, Price per item (including shipping and fees, e.g. 28,50) and Purchase date."],
    ["5. Sale: Quantity sold, Received per item (what you got after fees and shipping) and Sale date."],
    ["   A row can contain a purchase, a sale, or both (e.g. bought 3, sold 1 of them later)."],
    ["6. Bought the same product several times at different prices or dates? Copy the whole row and paste it below –"],
    ["   one row per purchase. The same goes for several sales."],
    ["7. Dates: e.g. 01.10.2026. Prices in euros. Note is optional."],
    ["8. Don't change the grey columns (Category, Product, Language, Cardmarket ID) – they tell the site which product you mean."],
    ["9. Upload the file on the website under Portfolio → Excel. You see a preview with any problems before anything is saved."],
    [""],
    ["Already imported rows are recognised: importing the same file again skips rows that already exist."],
  ];
  for (const [text, bold] of lines) {
    const r = how.addRow([text]);
    r.font = bold ? { bold: true, size: 16 } : { size: 11 };
  }

  for (const game of GAMES) {
    const cat = catalogs[game.key];
    if (!cat) continue;
    const ws = wb.addWorksheet(game.name.slice(0, 31));
    ws.columns = COLS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
    const products = [...cat.products].sort((a, b) =>
      (a.category ?? "").localeCompare(b.category ?? "") || (a.name ?? "").localeCompare(b.name ?? ""));
    for (const p of products) {
      for (const l of game.langs) {
        if (!p.languages[l]) continue;
        ws.addRow({ category: p.category, product: p.name, language: LANG_CODE[l], id: p.id });
      }
    }
    styleHeader(ws, FILL_FROM);
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLS.length } };
    const last = ws.rowCount;
    for (const c of [COL.category, COL.product, COL.language, COL.id]) {
      ws.getColumn(c).font = { color: { argb: "FF5B6772" } };
    }
    for (const c of [COL.priceBought, COL.priceSold]) ws.getColumn(c).numFmt = EURO_FMT;
    for (const c of [COL.dateBought, COL.dateSold]) ws.getColumn(c).numFmt = DATE_FMT;
    // Eingabehilfe: ganze Zahlen ≥ 1, Beträge ≥ 0, Datum
    for (let r = 2; r <= last; r++) {
      for (const c of [COL.qtyBought, COL.qtySold]) {
        ws.getCell(r, c).dataValidation = { type: "whole", operator: "greaterThanOrEqual", formulae: [1], allowBlank: true,
          showErrorMessage: true, error: "Whole number, 1 or more" };
      }
      for (const c of [COL.priceBought, COL.priceSold]) {
        ws.getCell(r, c).dataValidation = { type: "decimal", operator: "greaterThanOrEqual", formulae: [0], allowBlank: true,
          showErrorMessage: true, error: "Price in euros, e.g. 28,50" };
      }
    }
  }
  await download(wb, `cm-tracker-import-template-${todayIso()}.xlsx`);
}

// --- Import ----------------------------------------------------------------------------------
export interface ImportRow {
  sheet: string;
  row: number; // Excel-Zeile
  game: string;
  productId: number;
  productName: string;
  language: Lang;
  portfolio: string;
  txns: TxnInput[]; // neu zu importieren (ohne depot_id – wird beim Import gesetzt)
  duplicates: number; // schon vorhanden, werden übersprungen
  problems: string[];
}

export interface ImportPreview {
  rows: ImportRow[];
  newPortfolios: string[];
  ready: number; // Transaktionen, die importiert werden
  skipped: number; // schon vorhanden
  errors: number; // Zeilen mit Problemen
}

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v && typeof v === "object" && !(v instanceof Date)) {
    if ("result" in v) return (v as { result: unknown }).result; // Formel
    if ("richText" in v) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
    if ("text" in v) return (v as { text: string }).text;
  }
  return v;
}

const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === "string" && !v.trim());

function toInt(v: unknown): number | null {
  if (isEmpty(v)) return null;
  const n = typeof v === "number" ? v : Number(String(v).trim().replace(",", "."));
  return Number.isInteger(n) && n >= 1 ? n : NaN;
}

function toCents(v: unknown): number | null {
  if (isEmpty(v)) return null;
  if (typeof v === "number") return v >= 0 ? Math.round(v * 100) : NaN;
  let s = String(v).replace(/[€\s]/g, "");
  if (s.includes(",") && s.includes(".")) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
}

const pad = (n: number) => String(n).padStart(2, "0");

function toDate(v: unknown): string | null {
  if (isEmpty(v)) return null;
  if (v instanceof Date) {
    // exceljs liefert Datumszellen als UTC-Mitternacht
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  }
  if (typeof v === "number") {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86_400_000); // Excel-Seriennummer
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const iso = `${y}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
    return isNaN(Date.parse(iso)) ? "invalid" : iso;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m && !isNaN(Date.parse(s)) ? s : "invalid";
}

const sameTxn = (a: TxnInput, b: Txn, depotId: string | undefined) =>
  depotId === b.depot_id && a.game === b.game && a.product_id === b.product_id && a.language === b.language &&
  a.kind === b.kind && a.quantity === b.quantity && a.unit_price_cents === b.unit_price_cents && a.trade_date === b.trade_date;

export async function readImport(file: File, catalogs: Record<string, Catalog | undefined>, depots: Depot[], existing: Txn[]):
  Promise<ImportPreview> {
  const E = await exceljs();
  const wb = new E.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const depotByName = new Map(depots.map((d) => [d.name.trim().toLowerCase(), d]));
  const defaultName = depots[0]?.name ?? "Main";
  const rows: ImportRow[] = [];
  const newPortfolios = new Set<string>();
  const pool = [...existing]; // jede vorhandene Transaktion erkennt höchstens eine Zeile als Doppelung

  wb.eachSheet((ws) => {
    const game = GAMES.find((g) => g.name.slice(0, 31) === ws.name);
    if (!game) return; // "How to" und fremde Blätter
    // Spalten über die Überschriften finden (falls jemand Spalten verschoben hat)
    const head: Record<string, number> = {};
    ws.getRow(1).eachCell((cell, n) => {
      const c = COLS.find((x) => x.header === String(cellValue(cell.value) ?? "").trim());
      if (c) head[c.key] = n;
    });
    const get = (r: ExcelJS.Row, key: (typeof COLS)[number]["key"]) => (head[key] ? cellValue(r.getCell(head[key]).value) : null);
    const products = new Map((catalogs[game.key]?.products ?? []).map((p) => [p.id, p]));

    ws.eachRow((r, n) => {
      if (n === 1) return;
      const fields = ["qtyBought", "priceBought", "dateBought", "qtySold", "priceSold", "dateSold"] as const;
      if (fields.every((f) => isEmpty(get(r, f)))) return; // nicht ausgefüllt
      const problems: string[] = [];
      const id = Number(get(r, "id"));
      const product = products.get(id);
      const language = CODE_LANG[String(get(r, "language") ?? "").trim().toUpperCase()];
      if (!product) problems.push("unknown product (Cardmarket ID changed?)");
      if (!language) problems.push("unknown language");
      const portfolio = String(get(r, "portfolio") ?? "").trim() || defaultName;
      if (portfolio.length > 60) problems.push("portfolio name is longer than 60 characters");
      const note = String(get(r, "note") ?? "").trim().slice(0, 500) || null;
      const txns: TxnInput[] = [];
      const part = (kind: "buy" | "sell", qtyKey: (typeof fields)[number], priceKey: (typeof fields)[number], dateKey: (typeof fields)[number]) => {
        const [q, p, d] = [get(r, qtyKey), get(r, priceKey), get(r, dateKey)];
        if ([q, p, d].every(isEmpty)) return;
        const label = kind === "buy" ? "purchase" : "sale";
        const qty = toInt(q);
        const cents = toCents(p);
        const date = toDate(d);
        if (qty === null) problems.push(`${label}: quantity missing`);
        else if (Number.isNaN(qty)) problems.push(`${label}: quantity must be a whole number of 1 or more`);
        if (cents === null) problems.push(`${label}: price missing`);
        else if (Number.isNaN(cents)) problems.push(`${label}: price is not a number`);
        if (date === null) problems.push(`${label}: date missing`);
        else if (date === "invalid") problems.push(`${label}: date not readable (use e.g. 01.10.2026)`);
        else if (date > todayIso()) problems.push(`${label}: date is in the future`);
        if (problems.length || !product || !language || qty === null || cents === null || date === null) return;
        txns.push({
          depot_id: "", game: game.key, product_id: id, product_name: product.name, language, kind, quantity: qty as number,
          unit_price_cents: cents as number, trade_date: date, note,
        });
      };
      part("buy", "qtyBought", "priceBought", "dateBought");
      part("sell", "qtySold", "priceSold", "dateSold");
      const depot = depotByName.get(portfolio.toLowerCase());
      if (!depot && !problems.length) newPortfolios.add(portfolio);
      const fresh = txns.filter((t) => {
        const i = pool.findIndex((x) => sameTxn(t, x, depot?.id));
        if (i < 0) return true;
        pool.splice(i, 1);
        return false;
      });
      rows.push({
        sheet: ws.name, row: n, game: game.key, productId: id, productName: product?.name ?? String(get(r, "product") ?? ""),
        language: language ?? "en", portfolio: depot?.name ?? portfolio, txns: fresh, duplicates: txns.length - fresh.length, problems,
      });
    });
  });

  // Verkäufe dürfen den Bestand nicht übersteigen (vorhandene + neue Transaktionen, nach Datum)
  const fakeId = (name: string) => depotByName.get(name.toLowerCase())?.id ?? `new:${name.toLowerCase()}`;
  const all: Txn[] = [...existing];
  rows.forEach((r, i) => {
    if (r.problems.length) return;
    r.txns.forEach((t, j) => {
      all.push({ ...t, depot_id: fakeId(r.portfolio), id: `import-${i}-${j}`, created_at: `9999-${i}-${j}` });
    });
  });
  for (const p of positions(all)) {
    if (p.oversold > 0) {
      const affected = rows.filter((r) => !r.problems.length && r.game === p.game && r.productId === p.productId &&
        r.language === p.language && fakeId(r.portfolio) === p.depotId && r.txns.some((t) => t.kind === "sell"));
      for (const r of affected) r.problems.push(`sells ${p.oversold} more than you hold in “${r.portfolio}”`);
    }
  }

  const ok = rows.filter((r) => !r.problems.length);
  return {
    rows,
    newPortfolios: [...newPortfolios].filter((n) => ok.some((r) => r.portfolio === n)),
    ready: ok.reduce((s, r) => s + r.txns.length, 0),
    skipped: ok.reduce((s, r) => s + r.duplicates, 0),
    errors: rows.length - ok.length,
  };
}

/** Importiert nur fehlerfreie Zeilen; legt neue Portfolios an; schon vorhandene Transaktionen werden übersprungen. */
export async function applyImport(preview: ImportPreview, depots: Depot[],
  addDepot: (name: string) => Promise<Depot>, addTxns: (rows: TxnInput[]) => Promise<void>) {
  const byName = new Map(depots.map((d) => [d.name.trim().toLowerCase(), d.id]));
  for (const name of preview.newPortfolios) {
    if (!byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), (await addDepot(name)).id);
  }
  const rows: TxnInput[] = [];
  for (const r of preview.rows) {
    if (r.problems.length) continue;
    const depotId = byName.get(r.portfolio.toLowerCase())!;
    r.txns.forEach((t) => rows.push({ ...t, depot_id: depotId }));
  }
  // Käufe zuerst, damit die Reihenfolge der Eingabe passt
  rows.sort((a, b) => a.trade_date.localeCompare(b.trade_date) || (a.kind === b.kind ? 0 : a.kind === "buy" ? -1 : 1));
  for (let i = 0; i < rows.length; i += 500) await addTxns(rows.slice(i, i + 500));
  return rows.length;
}

// --- Export ----------------------------------------------------------------------------------
export async function downloadExport(txns: Txn[], depots: Depot[], catalogs: Record<string, Catalog | undefined>, region: Region) {
  const E = await exceljs();
  const wb = new E.Workbook();
  wb.creator = "CM Tracker";
  const names = Object.fromEntries(depots.map((d) => [d.id, d.name]));
  const date = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  };

  const hold = wb.addWorksheet("Holdings");
  hold.columns = [
    { header: "Portfolio", key: "portfolio", width: 18 },
    { header: "Game", key: "game", width: 16 },
    { header: "Product", key: "product", width: 50 },
    { header: "Language", key: "language", width: 10 },
    { header: "Cardmarket ID", key: "id", width: 14 },
    { header: "Quantity", key: "qty", width: 10 },
    { header: "Avg. cost per item", key: "avg", width: 14, style: { numFmt: EURO_FMT } },
    { header: "Invested", key: "cost", width: 14, style: { numFmt: EURO_FMT } },
    { header: "Fair price (item only)", key: "price", width: 14, style: { numFmt: EURO_FMT } },
    { header: "Price date", key: "priceDay", width: 12, style: { numFmt: DATE_FMT } },
    { header: "Value", key: "value", width: 14, style: { numFmt: EURO_FMT } },
    { header: "Unrealized profit/loss", key: "pl", width: 14, style: { numFmt: EURO_FMT } },
    { header: "Realized profit/loss", key: "realized", width: 14, style: { numFmt: EURO_FMT } },
    { header: "Held since", key: "since", width: 12, style: { numFmt: DATE_FMT } },
  ];
  const statusDay = Object.values(catalogs).find(Boolean)?.day ?? todayIso();
  for (const p of positions(txns).map((x) => valuate(x, catalogs, region))) {
    if (p.quantity === 0 && p.realizedCents === 0) continue;
    hold.addRow({
      portfolio: names[p.depotId] ?? "", game: gameOf(p.game)?.name ?? p.game, product: p.product?.name ?? p.productName,
      language: LANG_CODE[p.language], id: p.productId, qty: p.quantity,
      avg: p.quantity ? p.costCents / p.quantity / 100 : null, cost: p.costCents / 100,
      price: p.priceCents === null ? null : p.priceCents / 100, priceDay: date(p.priceDay ?? statusDay),
      value: p.valueCents === null ? null : p.valueCents / 100,
      pl: p.valueCents === null ? null : (p.valueCents - p.costCents) / 100, realized: p.realizedCents / 100,
      since: p.lots[0] ? date(p.lots[0].date) : null,
    });
  }
  styleHeader(hold);
  hold.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: hold.columnCount } };

  const tx = wb.addWorksheet("Transactions");
  tx.columns = [
    { header: "Date", key: "date", width: 12, style: { numFmt: DATE_FMT } },
    { header: "Type", key: "kind", width: 8 },
    { header: "Portfolio", key: "portfolio", width: 18 },
    { header: "Game", key: "game", width: 16 },
    { header: "Product", key: "product", width: 50 },
    { header: "Language", key: "language", width: 10 },
    { header: "Cardmarket ID", key: "id", width: 14 },
    { header: "Quantity", key: "qty", width: 10 },
    { header: "Per item", key: "price", width: 12, style: { numFmt: EURO_FMT } },
    { header: "Total", key: "total", width: 12, style: { numFmt: EURO_FMT } },
    { header: "Note", key: "note", width: 30 },
  ];
  for (const t of [...txns].sort((a, b) => a.trade_date.localeCompare(b.trade_date))) {
    tx.addRow({
      date: date(t.trade_date), kind: t.kind === "buy" ? "Buy" : "Sell", portfolio: names[t.depot_id] ?? "",
      game: gameOf(t.game)?.name ?? t.game, product: t.product_name, language: LANG_CODE[t.language], id: t.product_id,
      qty: t.quantity, price: t.unit_price_cents / 100, total: (t.unit_price_cents * t.quantity) / 100, note: t.note,
    });
  }
  styleHeader(tx);
  tx.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: tx.columnCount } };
  await download(wb, `cm-tracker-portfolio-${todayIso()}.xlsx`);
}
