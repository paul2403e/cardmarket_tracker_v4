"use client";

// Preisalarm anlegen oder bearbeiten. Anlegen setzt das Produkt (in dieser Sprache) auch auf die Watchlist.
// Bearbeiten macht den Alarm wieder scharf. Geprüft wird jeden Morgen nach dem Datenupdate; Mail als Sammel-Mail.
import { useId, useMemo, useState } from "react";
import { Segmented } from "@/components/Segmented";
import { LangBadge } from "@/components/LangBadge";
import { Thumb } from "@/components/ProductRow";
import { useAuth } from "@/lib/auth";
import { useCatalogFor } from "@/lib/data";
import { LANG_SHORT, count, money, pct } from "@/lib/format";
import { gameOf } from "@/lib/games";
import { parseEuro } from "@/lib/portfolio";
import { useSettings } from "@/lib/settings";
import type { Lang, Period, Region } from "@/lib/types";
import { alertText, useWatch, watchApi, type Alert, type AlertInput, type AlertKind } from "@/lib/watch";
import { Dialog } from "./Dialog";

export interface AlertTarget {
  game: string;
  productId: number;
  language: Lang;
}

const KINDS: { value: AlertKind; label: string }[] = [
  { value: "price_below", label: "Price falls below …" },
  { value: "price_above", label: "Price rises above …" },
  { value: "items_below", label: "Items listed fall below …" },
  { value: "items_above", label: "Items listed rise above …" },
  { value: "change", label: "Changes by … % within … days" },
];
const QUICK_DAYS = [1, 7, 30, 90, 365];
const PERIOD_OF: Record<number, Period> = { 1: "1d", 7: "7d", 30: "30d", 365: "1y" };

const input = "h-10 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 outline-none focus:border-cobalt";

export function AlertDialog({ target, editing, onClose }: { target: AlertTarget; editing?: Alert; onClose: () => void }) {
  const { user } = useAuth();
  const { region: defaultRegion } = useSettings();
  const { mutate } = useWatch();
  const { data: catalog } = useCatalogFor(target.game);
  const product = catalog?.products.find((p) => p.id === target.productId);
  const langs = (Object.keys(product?.languages ?? {}) as Lang[]);
  const ids = { kind: useId(), th: useId(), days: useId() };

  const [lang, setLang] = useState<Lang>(editing?.language ?? target.language);
  const [kind, setKind] = useState<AlertKind>(editing?.kind ?? "price_below");
  const [metric, setMetric] = useState<"price" | "items">(editing?.metric ?? "price");
  const [direction, setDirection] = useState<Alert["direction"]>(editing?.direction ?? "any");
  const [days, setDays] = useState(String(editing?.days ?? 7));
  const [basis, setBasis] = useState<"incl" | "excl">(editing?.basis ?? "incl");
  const [region, setRegion] = useState<Region>(editing?.region ?? defaultRegion);
  const [threshold, setThreshold] = useState(() => {
    if (!editing) return "";
    return editing.kind.startsWith("price") ? editing.threshold.toFixed(2).replace(".", ",") : String(editing.threshold).replace(".", ",");
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isPrice = kind === "price_below" || kind === "price_above" || (kind === "change" && metric === "price");
  const v = product?.languages[lang];
  const nDays = Number(days);

  // aktueller Wert als Orientierung
  const now = useMemo(() => {
    if (!v) return null;
    if (kind === "price_below" || kind === "price_above") return `Now ${money(v.price?.[region]?.[basis] ?? null)}`;
    if (kind === "items_below" || kind === "items_above") return `Now ${count(v.items)} items listed`;
    const per = PERIOD_OF[nDays];
    if (!per) return null;
    const c = metric === "items" ? v.change?.[per]?.items : basis === "incl" ? v.change?.[per]?.[region] : null;
    return c === null || c === undefined ? null : `Last ${nDays} day${nDays === 1 ? "" : "s"}: ${pct(c)}`;
  }, [v, kind, region, basis, metric, nDays]);

  function parsed(): AlertInput | string {
    let th: number | null;
    if (kind === "price_below" || kind === "price_above") {
      const cents = parseEuro(threshold);
      if (cents === null || cents <= 0) return "Please enter a price, e.g. 120,00.";
      th = cents / 100;
    } else if (kind === "change") {
      th = Number(threshold.replace(",", ".").replace("%", "").trim());
      if (!threshold.trim() || !Number.isFinite(th) || th <= 0 || th > 1000) return "Please enter a percentage between 0 and 1000, e.g. 10.";
      if (!Number.isInteger(nDays) || nDays < 1 || nDays > 365) return "Days must be a whole number from 1 to 365.";
    } else {
      th = Number(threshold.trim());
      if (!threshold.trim() || !Number.isInteger(th) || th < 0) return "Please enter a whole number of items.";
      if (kind === "items_below" && th < 1) return "Items listed can't fall below 0 – please enter 1 or more.";
    }
    return {
      game: target.game, product_id: target.productId, language: lang,
      product_name: product?.name ?? editing?.product_name ?? null,
      kind, metric: kind === "change" ? metric : kind.startsWith("items") ? "items" : "price",
      threshold: th, days: kind === "change" ? nDays : 7, direction: kind === "change" ? direction : "any",
      basis, region, active: editing?.active ?? true,
    };
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const row = parsed();
    if (typeof row === "string") return setError(row);
    setBusy(true);
    try {
      if (editing) {
        await watchApi.updateAlert(editing.id, row);
      } else {
        await watchApi.add(row.game, row.product_id, row.language);
        await watchApi.addAlert(row);
      }
      await mutate();
      onClose();
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? `Could not save (${err.message}).` : "Could not save. Please try again.");
    }
  }

  const preview = typeof parsed() === "string" ? null : alertText(parsed() as AlertInput);
  const thLabel = kind === "change" ? "Change of at least" : isPrice ? "Price" : "Items listed";

  return (
    <Dialog title={editing ? "Edit price alert" : "New price alert"} onClose={onClose}>
      <form onSubmit={save} className="mt-5 flex flex-col gap-4">
        <div className="flex items-center gap-3 rounded-lg bg-paper p-3 ring-1 ring-line">
          <Thumb src={product?.image ?? null} category={product?.category} size={44} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{product?.name ?? editing?.product_name ?? `#${target.productId}`}</p>
            <p className="flex items-center gap-2 text-xs text-slate">
              {editing || langs.length <= 1 ? <LangBadge lang={lang} /> : null}
              <span>{gameOf(target.game)?.name} · Cardmarket ID {target.productId}</span>
            </p>
          </div>
        </div>

        {!editing && langs.length > 1 && (
          <div>
            <span className="mb-1 block text-sm font-semibold">Language</span>
            <Segmented label="Language" value={lang} onChange={(l) => setLang(l as Lang)}
              options={langs.map((l) => ({ value: l, label: LANG_SHORT[l] }))} />
          </div>
        )}

        <div>
          <label htmlFor={ids.kind} className="mb-1 block text-sm font-semibold">Alert me when</label>
          <select id={ids.kind} value={kind} onChange={(e) => { setKind(e.target.value as AlertKind); setThreshold(""); }} className={input}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </div>

        {kind === "change" && (
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <div>
              <span className="mb-1 block text-sm font-semibold">What</span>
              <Segmented label="What" value={metric} onChange={(m) => setMetric(m as "price" | "items")}
                options={[{ value: "price", label: "Price" }, { value: "items", label: "Items listed" }]} />
            </div>
            <div>
              <span className="mb-1 block text-sm font-semibold">Direction</span>
              <Segmented label="Direction" value={direction} onChange={(d) => setDirection(d as Alert["direction"])}
                options={[{ value: "up", label: "Rises" }, { value: "down", label: "Falls" }, { value: "any", label: "Either way" }]} />
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={ids.th} className="mb-1 block text-sm font-semibold">{thLabel}</label>
            <div className="flex h-10 items-center rounded-[var(--radius-control)] border border-line bg-surface px-3 focus-within:border-cobalt">
              {isPrice && kind !== "change" && <span className="mr-1 text-slate">€</span>}
              <input id={ids.th} inputMode={kind.startsWith("items") ? "numeric" : "decimal"} value={threshold} autoFocus
                onChange={(e) => setThreshold(e.target.value)}
                placeholder={kind === "change" ? "10" : isPrice ? "0,00" : "50"} className="num alert-input w-full bg-transparent outline-none" />
              {kind === "change" && <span className="ml-1 text-slate">%</span>}
            </div>
            {now && <p className="num mt-1 text-xs text-slate">{now}</p>}
          </div>
          {kind === "change" && (
            <div>
              <label htmlFor={ids.days} className="mb-1 block text-sm font-semibold">Within (days)</label>
              <input id={ids.days} type="number" inputMode="numeric" min={1} max={365} step={1} value={days}
                onChange={(e) => setDays(e.target.value)} className={`num ${input}`} />
              <div className="mt-1.5 flex flex-wrap gap-1">
                {QUICK_DAYS.map((d) => (
                  <button key={d} type="button" onClick={() => setDays(String(d))}
                    className={`num rounded-[var(--radius-control)] px-2 py-0.5 text-xs ring-1 ${
                      nDays === d ? "bg-ink text-white ring-ink" : "text-slate ring-line hover:text-ink"
                    }`}>
                    {d === 365 ? "1 year" : `${d}d`}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {isPrice && (
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <div>
              <span className="mb-1 block text-sm font-semibold">Price basis</span>
              <Segmented label="Price basis" value={basis} onChange={(b) => setBasis(b as "incl" | "excl")}
                options={[{ value: "incl", label: "Incl. shipping" }, { value: "excl", label: "Item only" }]} />
            </div>
            <div>
              <span className="mb-1 block text-sm font-semibold">Sellers from</span>
              <Segmented label="Sellers from" value={region} onChange={(r) => setRegion(r as Region)}
                options={[{ value: "eu", label: "EU" }, { value: "all", label: "All countries" }]} />
            </div>
          </div>
        )}

        <p className="rounded-lg bg-paper px-3 py-2 text-sm text-slate ring-1 ring-line">
          {preview ? <><strong className="text-ink">{preview}.</strong> </> : null}
          Checked every morning after the daily update. You get one email{user?.email ? ` to ${user.email}` : ""} when it
          happens – and again only after the condition was no longer met in between.
        </p>

        {error && <p role="alert" className="rounded-lg bg-down-soft px-3 py-2 text-sm text-down">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-[var(--radius-control)] px-4 ring-1 ring-line hover:ring-ink">Cancel</button>
          <button type="submit" disabled={busy}
            className="h-10 rounded-[var(--radius-control)] bg-ink px-5 font-semibold text-white hover:bg-cobalt disabled:opacity-60">
            {busy ? "Saving…" : editing ? "Save changes" : "Create alert"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
