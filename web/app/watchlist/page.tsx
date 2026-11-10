"use client";

// Watchlist: beobachtete Produkte je Sprache, eigene Preisalarme und zuletzt ausgelöste Alarme.
import Link from "next/link";
import { useMemo, useState } from "react";
import { NeedsAccounts } from "@/components/account/Form";
import { RequireUser } from "@/components/account/RequireUser";
import { LangBadge } from "@/components/LangBadge";
import { Thumb } from "@/components/ProductRow";
import { FilterRow, GameFilter, useGameFilter } from "@/components/portfolio/GameFilter";
import { SortTh, nextSort, type Sort } from "@/components/portfolio/SortTh";
import { AlertDialog, type AlertTarget } from "@/components/watch/AlertDialog";
import { HoldConfirm } from "@/components/watch/Dialog";
import { count, money, pct, trendClass } from "@/lib/format";
import { gameHref, gameOf, useGame } from "@/lib/games";
import { changeOf, priceOf } from "@/lib/market";
import { COMPARE_MAX, useSettings } from "@/lib/settings";
import { useRouter } from "next/navigation";
import type { Period, ProductSummary, VariantNow } from "@/lib/types";
import { useCatalogs } from "@/lib/valuation";
import { alertText, sameVariant, useWatch, watchApi, type Alert, type Watch } from "@/lib/watch";

type Key = "name" | "price" | "items" | "1d" | "7d" | "30d" | "alerts";
const PERIODS: Period[] = ["1d", "7d", "30d"];

interface Row {
  w: Watch;
  product: ProductSummary | null;
  v: VariantNow | null;
  name: string;
  alerts: Alert[];
}

const fmtDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const href = (game: string, id: number, lang: string) => {
  const g = gameOf(game);
  return g ? `${gameHref(g, `/product/${id}`)}?lang=${lang}` : "#";
};

function Status({ a }: { a: Alert }) {
  if (!a.active) return <span className="rounded-lg bg-paper px-2 py-0.5 text-xs text-slate ring-1 ring-line">Paused</span>;
  if (!a.armed) {
    return (
      <span className="rounded-lg bg-warn-soft px-2 py-0.5 text-xs text-warn"
        title="Reported once. It reports again after the condition was no longer met.">
        Triggered{a.last_triggered_at ? ` ${fmtDay(a.last_triggered_at)}` : ""}
      </span>
    );
  }
  return <span className="rounded-lg bg-up-soft px-2 py-0.5 text-xs text-up">Active</span>;
}

function Watchlist() {
  const { data, mutate } = useWatch();
  const game = useGame();
  const { region } = useSettings();
  const showGame = useGameFilter();
  const [sort, setSort] = useState<Sort<Key>>({ key: "name", dir: 1 });
  const [dialog, setDialog] = useState<{ target: AlertTarget; editing?: Alert } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "watch"; row: Row } | { kind: "alert"; alert: Alert } | { kind: "events" } | null>(null);

  const games = useMemo(() => new Set([...(data?.watch ?? []), ...(data?.alerts ?? [])].map((x) => x.game)), [data]);
  const catalogs = useCatalogs(games);
  const productOf = (game: string, id: number) => catalogs[game]?.products.find((p) => p.id === id) ?? null;

  const rows: Row[] = useMemo(() => (data?.watch ?? []).filter((w) => showGame(w.game)).map((w) => {
    const product = catalogs[w.game]?.products.find((p) => p.id === w.product_id) ?? null;
    const alerts = (data?.alerts ?? []).filter((a) => sameVariant(a, w.game, w.product_id, w.language));
    return { w, product, v: product?.languages[w.language] ?? null, name: product?.name ?? alerts[0]?.product_name ?? `#${w.product_id}`, alerts };
  }), [data, catalogs, showGame]);

  const sorted = useMemo(() => {
    const val = (r: Row): number | string | null => {
      switch (sort.key) {
        case "name": return r.name.toLowerCase();
        case "price": return r.v ? priceOf(r.v, region, true) : null;
        case "items": return r.v?.items ?? null;
        case "alerts": return r.alerts.length;
        default: return r.v ? changeOf(r.v, sort.key, region) : null;
      }
    };
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x === null && y === null) return 0;
      if (x === null) return 1; // ohne Wert immer ans Ende
      if (y === null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [rows, sort, region]);

  const alerts = useMemo(() => (data?.alerts ?? []).filter((a) => showGame(a.game)), [data, showGame]);
  const events = useMemo(() => (data?.events ?? []).filter((e) => showGame(e.game)), [data, showGame]);
  const onSort = (k: Key) => setSort((s) => nextSort(s, k, ["name"]));
  const router = useRouter();
  const { setCompare } = useSettings();
  const compareAll = () => {
    const keys = sorted.slice(0, COMPARE_MAX).map((r) => `${r.w.game}:${r.w.product_id}:${r.w.language}`);
    setCompare({ items: keys });
    router.push(`/compare?items=${keys.join(",")}`);
  };

  if (!data) return <p className="py-10 text-slate">Loading…</p>;
  const empty = data.watch.length === 0 && data.alerts.length === 0;

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <h1 className="display text-4xl">Watchlist</h1>
        <p className="max-w-2xl text-sm text-slate">
          Products you follow, per language. Price alerts are checked every morning after the daily update – you get one email
          with everything that triggered.
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <FilterRow label="Games">
            <GameFilter />
          </FilterRow>
          {rows.length > 0 && (
            <button type="button" onClick={compareAll} title={`Compare the first ${COMPARE_MAX} products of this list`}
              className="h-9 rounded-[var(--radius-control)] px-4 text-sm font-semibold ring-1 ring-line hover:ring-ink">
              Compare {rows.length > COMPARE_MAX ? `first ${COMPARE_MAX}` : "all"}
            </button>
          )}
        </div>
      </div>

      {empty ? (
        <section className="rounded-[var(--radius-panel)] bg-surface p-6 ring-1 ring-line">
          <p className="font-semibold">Nothing on your watchlist yet.</p>
          <p className="mt-1 text-sm text-slate">
            Open a product and press <strong>Watch</strong> or <strong>Price alert</strong> – or use the eye in{" "}
            <Link href={gameHref(game, "/browse")} className="text-cobalt hover:underline">Browse</Link>.
          </p>
        </section>
      ) : (
        <section aria-labelledby="watch-title">
          <h2 id="watch-title" className="sr-only">Watched products</h2>
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left text-slate">
                <tr className="border-b border-line">
                  <SortTh id="name" label="Product" sort={sort} onSort={onSort} />
                  <SortTh id="price" label="Fair price" sort={sort} onSort={onSort} right />
                  <SortTh id="items" label="Items" sort={sort} onSort={onSort} right />
                  <SortTh id="1d" label="1D" sort={sort} onSort={onSort} right />
                  <SortTh id="7d" label="7D" sort={sort} onSort={onSort} right />
                  <SortTh id="30d" label="30D" sort={sort} onSort={onSort} right />
                  <SortTh id="alerts" label="Alerts" sort={sort} onSort={onSort} right />
                  <th className="py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const triggered = r.alerts.filter((a) => a.active && !a.armed).length;
                  return (
                    <tr key={`${r.w.game}-${r.w.product_id}-${r.w.language}`} className="border-b border-line hover:bg-surface">
                      <td className="py-2 pr-3">
                        <Link href={href(r.w.game, r.w.product_id, r.w.language)} className="flex min-w-0 items-center gap-3">
                          <Thumb src={r.product?.image ?? null} name={r.name} category={r.product?.category ?? null} size={40} />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{r.name}</span>
                            <span className="flex gap-2 text-xs text-slate">
                              <LangBadge lang={r.w.language} />
                              <span>{gameOf(r.w.game)?.name}</span>
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="num py-2 text-right font-semibold">{money(r.v ? priceOf(r.v, region, true) : null)}</td>
                      <td className="num py-2 text-right">{count(r.v?.items)}</td>
                      {PERIODS.map((per) => {
                        const c = r.v ? changeOf(r.v, per, region) : null;
                        return <td key={per} className={`num py-2 text-right ${trendClass(c)}`}>{pct(c)}</td>;
                      })}
                      <td className="num py-2 text-right">
                        {r.alerts.length ? (
                          <span title={r.alerts.map(alertText).join("\n")}>
                            {r.alerts.length}{triggered ? <span className="ml-1 text-warn">({triggered} triggered)</span> : null}
                          </span>
                        ) : <span className="text-slate">–</span>}
                      </td>
                      <td className="py-2 pl-4">
                        <span className="flex justify-end gap-1.5">
                          <button type="button" title="Add price alert" aria-label={`Add price alert for ${r.name}`}
                            onClick={() => setDialog({ target: { game: r.w.game, productId: r.w.product_id, language: r.w.language } })}
                            className="h-8 rounded-[var(--radius-control)] px-3 text-sm font-semibold text-cobalt ring-1 ring-line hover:ring-cobalt">
                            + Alert
                          </button>
                          <button type="button" title="Remove from watchlist" aria-label={`Remove ${r.name} from watchlist`}
                            onClick={async () => {
                              if (r.alerts.length) return setConfirm({ kind: "watch", row: r });
                              await watchApi.remove(r.w.game, r.w.product_id, r.w.language);
                              await mutate();
                            }}
                            className="grid h-8 w-8 place-items-center rounded-full text-lg leading-none text-slate ring-1 ring-line hover:text-down hover:ring-down">
                            ×
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate">Fair price incl. shipping, {region === "eu" ? "EU sellers" : "all countries"} (switch “EU only” at the top).</p>
        </section>
      )}

      {alerts.length > 0 && (
        <section aria-labelledby="alerts-title">
          <h2 id="alerts-title" className="display text-2xl">Price alerts</h2>
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {alerts.map((a) => {
              const p = productOf(a.game, a.product_id);
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                  <Link href={href(a.game, a.product_id, a.language)} className="flex min-w-0 flex-1 basis-72 items-center gap-3">
                    <Thumb src={p?.image ?? null} name={p?.name ?? a.product_name} category={p?.category ?? null} size={36} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{p?.name ?? a.product_name ?? `#${a.product_id}`}</span>
                      <span className="flex items-center gap-2 text-xs text-slate"><LangBadge lang={a.language} /><span>{gameOf(a.game)?.name}</span></span>
                    </span>
                  </Link>
                  <span className={`min-w-0 flex-1 basis-64 text-sm ${a.active ? "" : "text-slate"}`}>{alertText(a)}</span>
                  <Status a={a} />
                  <span className="flex gap-3 text-sm">
                    <button type="button" className="text-cobalt hover:underline"
                      onClick={() => setDialog({ target: { game: a.game, productId: a.product_id, language: a.language }, editing: a })}>
                      Edit
                    </button>
                    <button type="button" className="text-cobalt hover:underline"
                      onClick={async () => { await watchApi.setActive(a.id, !a.active); await mutate(); }}>
                      {a.active ? "Pause" : "Resume"}
                    </button>
                    <button type="button" className="text-down hover:underline" onClick={() => setConfirm({ kind: "alert", alert: a })}>
                      Delete
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="events-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="events-title" className="display text-2xl">Recently triggered</h2>
          {data.events.length > 0 && (
            <button type="button" onClick={() => setConfirm({ kind: "events" })} className="text-sm text-slate hover:text-down">Clear history</button>
          )}
        </div>
        {events.length === 0 ? (
          <p className="mt-2 text-sm text-slate">No alert has triggered yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5 text-sm">
                <span className="num w-28 shrink-0 text-slate">{fmtDay(e.day)}</span>
                <Link href={href(e.game, e.product_id, e.language)} className="flex min-w-0 items-center gap-2 font-medium hover:text-cobalt">
                  <span className="truncate">{productOf(e.game, e.product_id)?.name ?? e.product_name ?? `#${e.product_id}`}</span>
                  <LangBadge lang={e.language} />
                </Link>
                <span className="min-w-0 basis-full text-slate sm:basis-auto sm:flex-1">{e.message}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {dialog && <AlertDialog target={dialog.target} editing={dialog.editing} onClose={() => setDialog(null)} />}
      {confirm?.kind === "watch" && (
        <HoldConfirm title="Remove from watchlist" action="Hold to remove" onClose={() => setConfirm(null)}
          text={<>
            <strong className="text-ink">{confirm.row.name}</strong> – this also deletes{" "}
            {confirm.row.alerts.length === 1 ? "its price alert" : `its ${confirm.row.alerts.length} price alerts`}:
            <ul className="mt-2 list-disc pl-5">{confirm.row.alerts.map((a) => <li key={a.id}>{alertText(a)}</li>)}</ul>
          </>}
          onConfirm={async () => { await watchApi.remove(confirm.row.w.game, confirm.row.w.product_id, confirm.row.w.language); await mutate(); }} />
      )}
      {confirm?.kind === "alert" && (
        <HoldConfirm title="Delete price alert" action="Hold to delete" onClose={() => setConfirm(null)}
          text={<><strong className="text-ink">{confirm.alert.product_name ?? `#${confirm.alert.product_id}`}</strong>: {alertText(confirm.alert)}.
            The product stays on your watchlist.</>}
          onConfirm={async () => { await watchApi.deleteAlert(confirm.alert.id); await mutate(); }} />
      )}
      {confirm?.kind === "events" && (
        <HoldConfirm title="Clear history" action="Hold to clear" onClose={() => setConfirm(null)}
          text="Removes the list of triggered alerts (all games). Your alerts themselves stay."
          onConfirm={async () => { await watchApi.deleteEvents(); await mutate(); }} />
      )}
    </div>
  );
}

export default function WatchlistPage() {
  return (
    <NeedsAccounts>
      <RequireUser>{() => <Watchlist />}</RequireUser>
    </NeedsAccounts>
  );
}
