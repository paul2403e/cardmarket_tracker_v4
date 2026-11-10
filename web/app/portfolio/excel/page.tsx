"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { NeedsAccounts } from "@/components/account/Form";
import { PortfolioShell, useScope } from "@/components/portfolio/Shell";
import { RequireUser } from "@/components/account/RequireUser";
import { applyImport, downloadExport, downloadTemplate, readImport, type ImportPreview } from "@/lib/excel";
import { LANG_SHORT } from "@/lib/format";
import { GAMES, gameOf } from "@/lib/games";
import { api, usePortfolio } from "@/lib/portfolio";
import { useSettings } from "@/lib/settings";
import { useCatalogsState } from "@/lib/valuation";

const btn = "h-10 rounded-[var(--radius-control)] px-4 font-semibold";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-panel)] bg-surface p-6 ring-1 ring-line">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Excel() {
  const scope = useScope();
  const { data, mutate } = usePortfolio();
  const { region } = useSettings();
  const allGames = useMemo(() => new Set(GAMES.map((g) => g.key)), []);
  const { catalogs, ready: loaded } = useCatalogsState(allGames);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  if (!data || !scope) return <p className="py-10 text-slate">Loading…</p>;
  const { depots, txns } = data;

  async function run(label: string, f: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    }
    setBusy(null);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setPreview(null);
    setDone(null);
    await run("read", async () => {
      try {
        setPreview(await readImport(file, catalogs, depots, txns));
      } catch {
        throw new Error("This file can't be read. Please use the template (.xlsx).");
      }
    });
  }

  async function doImport() {
    if (!preview) return;
    await run("import", async () => {
      const n = await applyImport(preview, depots, api.addDepot, api.addTxns);
      await mutate();
      setPreview(null);
      setDone(`${n} transaction${n === 1 ? "" : "s"} imported.`);
    });
  }

  const problems = preview?.rows.filter((r) => r.problems.length) ?? [];
  const good = preview?.rows.filter((r) => !r.problems.length && r.txns.length) ?? [];

  return (
    <PortfolioShell scope={scope!} showFilters={false}>
    <div className="flex max-w-4xl flex-col gap-6">
      <p className="text-slate">Import your collection from a spreadsheet, or download everything you entered.</p>

      <Card title="1. Download the template">
        <p className="text-sm text-slate">
          One sheet per game with every product and language, plus a “How to” sheet. Fill in only the blue columns – quantity,
          price per item including shipping and fees, date, and for sales what you received. Copy a row for each further
          purchase or sale of the same product.
        </p>
        <button type="button" disabled={!loaded || busy !== null}
          onClick={() => run("template", () => downloadTemplate(catalogs, depots))}
          className={`mt-4 ${btn} bg-ink text-white hover:bg-cobalt disabled:opacity-60`}>
          {busy === "template" ? "Creating…" : loaded ? "Download template (.xlsx)" : "Loading products…"}
        </button>
      </Card>

      <Card title="2. Upload the filled-in file">
        <label className="inline-flex cursor-pointer items-center gap-3">
          <span className={`${btn} inline-flex items-center bg-surface ring-1 ring-line hover:ring-ink`}>Choose file…</span>
          <span className="text-sm text-slate">{fileName || "No file chosen"}</span>
          <input type="file" accept=".xlsx" className="sr-only" disabled={!loaded || busy !== null}
            onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        {busy === "read" && <p className="mt-3 text-sm text-slate">Reading file…</p>}
        {done && <p role="status" className="mt-3 rounded-lg bg-up-soft px-3 py-2 text-sm text-up">{done} <Link href="/portfolio" className="underline">Open portfolio</Link></p>}

        {preview && (
          <div className="mt-5 flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <p className="rounded-lg bg-paper p-3"><span className="display num block text-2xl">{preview.ready}</span>
                <span className="text-sm text-slate">transactions ready to import</span></p>
              <p className="rounded-lg bg-paper p-3"><span className="display num block text-2xl">{preview.skipped}</span>
                <span className="text-sm text-slate">already in your portfolio – skipped</span></p>
              <p className={`rounded-lg p-3 ${preview.errors ? "bg-down-soft text-down" : "bg-paper"}`}>
                <span className="display num block text-2xl">{preview.errors}</span>
                <span className="text-sm">rows with problems – not imported</span></p>
            </div>
            {preview.newPortfolios.length > 0 && (
              <p className="text-sm">New portfolio{preview.newPortfolios.length === 1 ? "" : "s"} will be created: <strong>{preview.newPortfolios.join(", ")}</strong></p>
            )}

            {problems.length > 0 && (
              <div>
                <h3 className="font-semibold text-down">Please fix these rows in the file and upload it again</h3>
                <ul className="mt-2 divide-y divide-line text-sm">
                  {problems.map((r) => (
                    <li key={`${r.sheet}-${r.row}`} className="py-2">
                      <span className="font-semibold">{r.sheet}, row {r.row}</span> – {r.productName} {LANG_SHORT[r.language]}:{" "}
                      <span className="text-down">{r.problems.join("; ")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {good.length > 0 && (
              <div>
                <h3 className="font-semibold">What will be imported</h3>
                <div className="relative mt-2 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="text-left text-slate">
                      <tr className="border-b border-line">
                        <th className="py-1.5 font-normal">Row</th><th className="py-1.5 font-normal">Product</th>
                        <th className="py-1.5 font-normal">Portfolio</th><th className="py-1.5 font-normal">Transactions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(showAll ? good : good.slice(0, 50)).map((r) => (
                        <tr key={`${r.sheet}-${r.row}`} className="border-b border-line align-top">
                          <td className="num py-1.5 pr-3 text-slate">{gameOf(r.game)?.name} {r.row}</td>
                          <td className="py-1.5 pr-3">{r.productName} <span className="text-slate">{LANG_SHORT[r.language]}</span></td>
                          <td className="py-1.5 pr-3">{r.portfolio}</td>
                          <td className="num py-1.5">
                            {r.txns.map((t, i) => (
                              <span key={i} className="block">
                                {t.kind === "buy" ? "Buy" : "Sell"} {t.quantity} × {(t.unit_price_cents / 100).toFixed(2).replace(".", ",")} € · {t.trade_date.split("-").reverse().join(".")}
                              </span>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {good.length > 50 && !showAll && (
                  <button type="button" onClick={() => setShowAll(true)} className="mt-2 text-sm text-cobalt hover:underline">
                    Show all {good.length} rows
                  </button>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={doImport} disabled={!preview.ready || busy !== null}
                className={`${btn} bg-ink text-white hover:bg-cobalt disabled:opacity-50`}>
                {busy === "import" ? "Importing…" : `Import ${preview.ready} transaction${preview.ready === 1 ? "" : "s"}`}
              </button>
              <button type="button" onClick={() => setPreview(null)} className={`${btn} font-normal ring-1 ring-line`}>Cancel</button>
            </div>
            {preview.errors > 0 && preview.ready > 0 && (
              <p className="text-xs text-slate">Rows with problems are left out; you can import them later – rows already imported are recognised and skipped.</p>
            )}
          </div>
        )}
      </Card>

      <Card title="3. Export">
        <p className="text-sm text-slate">Your holdings (with value and profit) and all transactions as an Excel file.</p>
        <button type="button" disabled={!txns.length || busy !== null}
          onClick={() => run("export", () => downloadExport(txns, depots, catalogs, region))}
          className={`mt-4 ${btn} bg-surface ring-1 ring-line hover:ring-ink disabled:opacity-50`}>
          {busy === "export" ? "Creating…" : "Download export (.xlsx)"}
        </button>
      </Card>

      {error && <p role="alert" className="rounded-lg bg-down-soft px-3 py-2 text-sm text-down">{error}</p>}
    </div>
    </PortfolioShell>
  );
}

export default function ExcelPage() {
  return (
    <NeedsAccounts>
      <RequireUser>{() => <Suspense><Excel /></Suspense>}</RequireUser>
    </NeedsAccounts>
  );
}
