"use client";

// Kauf oder Verkauf erfassen bzw. bearbeiten. Von überall aufrufbar (Portfolio, All products, Produktseite).
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Segmented } from "@/components/Segmented";
import { LangBadge } from "@/components/LangBadge";
import { Thumb } from "@/components/ProductRow";
import { useCatalogs } from "@/lib/valuation";
import { matches } from "@/components/Search";
import { useCatalogFor } from "@/lib/data";
import { LANG_LABEL, LANG_SHORT, money } from "@/lib/format";
import { GAMES, gameOf } from "@/lib/games";
import {
  api, centsToInput, held, parseEuro, positions, todayIso, usePortfolio, wouldOversell, type Kind, type Txn, type TxnInput,
} from "@/lib/portfolio";
import type { Lang, ProductSummary } from "@/lib/types";

export interface Prefill {
  game: string;
  productId: number;
  language?: Lang;
  depotId?: string;
}

const input = "h-10 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 outline-none focus:border-cobalt";

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-1 block text-sm font-semibold">{children}</label>;
}

const STEP = 60;

/** Kauf: Treffer erscheinen ab dem ersten Zeichen; endlos scrollbar – lädt beim Scrollen nach. */
function ProductPicker({ game, onPick }: { game: string; onPick: (p: ProductSummary) => void }) {
  const { data: catalog } = useCatalogFor(game);
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(STEP);
  const id = useId();
  const results = useMemo(() => {
    if (!q.trim()) return [];
    const hits = (catalog?.products ?? []).filter((p) => matches(p, q));
    return [...hits].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  }, [catalog, q]);
  return (
    <div>
      <Label htmlFor={id}>Product</Label>
      <input id={id} type="search" value={q} autoFocus
        onChange={(e) => { setQ(e.target.value); setShown(STEP); }}
        placeholder={catalog ? "Filter by name or Cardmarket ID" : "Loading products…"} className={input} />
      {catalog && q.trim() && (
        <>
          <p className="mt-2 text-xs text-slate">{results.length} product{results.length === 1 ? "" : "s"}</p>
          <ul className="mt-1 max-h-60 overflow-y-auto border-y border-line"
            onScroll={(e) => {
              const el = e.currentTarget;
              if (el.scrollTop + el.clientHeight > el.scrollHeight - 200) setShown((n) => Math.min(n + STEP, results.length));
            }}>
            {results.slice(0, shown).map((p) => (
              <li key={p.id} className="border-b border-line last:border-0">
                <button type="button" onClick={() => onPick(p)}
                  className="flex w-full items-center gap-3 px-1 py-1.5 text-left hover:bg-cobalt-soft">
                  <Thumb src={p.image} category={p.category} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{p.name}</span>
                    <span className="num block text-xs text-slate">{p.category} · #{p.id}</span>
                  </span>
                </button>
              </li>
            ))}
            {results.length === 0 && <li className="py-3 text-sm text-slate">No product matches.</li>}
          </ul>
        </>
      )}
    </div>
  );
}

/** Verkauf: nur was im gewählten Portfolio liegt (Produkt + Sprache + Menge). */
function HeldPicker({ items, onPick }: {
  items: { game: string; productId: number; language: Lang; name: string; quantity: number; image: string | null; category: string | null }[];
  onPick: (x: { game: string; productId: number; language: Lang }) => void;
}) {
  const [q, setQ] = useState("");
  const id = useId();
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = items.filter((x) => words.every((w) => `${x.name} ${x.productId}`.toLowerCase().includes(w)));
  return (
    <div>
      <Label htmlFor={id}>Product you hold</Label>
      {items.length === 0 ? (
        <p className="text-sm text-slate">Nothing held in this portfolio yet.</p>
      ) : (
        <>
          <input id={id} type="search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus
            placeholder="Filter by name or Cardmarket ID" className={input} />
          <ul className="mt-2 max-h-60 overflow-y-auto border-y border-line">
            {list.map((x) => (
              <li key={`${x.game}|${x.productId}|${x.language}`} className="border-b border-line last:border-0">
                <button type="button" onClick={() => onPick(x)}
                  className="flex w-full items-center gap-3 px-1 py-1.5 text-left text-sm hover:bg-cobalt-soft">
                  <Thumb src={x.image} category={x.category} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{x.name}</span>
                    <span className="flex items-center gap-2 text-xs text-slate">
                      <LangBadge lang={x.language} /> {gameOf(x.game)?.name}
                    </span>
                  </span>
                  <span className="num shrink-0 text-xs text-slate">{x.quantity} held</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function TxnDialog({ prefill, editing, onClose }: {
  prefill?: Prefill;
  editing?: Txn;
  onClose: () => void;
}) {
  const { data, mutate } = usePortfolio();
  const depots = useMemo(() => data?.depots ?? [], [data]);
  const txns = useMemo(() => data?.txns ?? [], [data]);

  const [kind, setKind] = useState<Kind>(editing?.kind ?? "buy");
  const [game, setGame] = useState(editing?.game ?? prefill?.game ?? GAMES[0].key);
  const [productId, setProductId] = useState<number | null>(editing?.product_id ?? prefill?.productId ?? null);
  const [language, setLanguage] = useState<Lang | null>(editing?.language ?? prefill?.language ?? null);
  const [depotId, setDepotId] = useState<string>(editing?.depot_id ?? prefill?.depotId ?? "");
  const [newDepot, setNewDepot] = useState("");
  const [quantity, setQuantity] = useState(String(editing?.quantity ?? 1));
  const [price, setPrice] = useState(editing ? centsToInput(editing.unit_price_cents) : "");
  const [date, setDate] = useState(editing?.trade_date ?? todayIso());
  const [note, setNote] = useState(editing?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { qty: useId(), price: useId(), date: useId(), note: useId(), depot: useId(), newDepot: useId(), game: useId() };

  const { data: catalog } = useCatalogFor(game);
  const product = catalog?.products.find((p) => p.id === productId) ?? null;
  const langs = (gameOf(game)?.langs ?? []).filter((l) => !product || product.languages[l]);
  const lang = language && langs.includes(language) ? language : langs[0] ?? null;

  // Standard-Portfolio: das erste
  useEffect(() => {
    if (!depotId && depots.length) setDepotId(depots[0].id);
  }, [depots, depotId]);
  const creatingDepot = depots.length === 0 || depotId === "new";

  const holding = productId && lang && depotId && !creatingDepot
    ? held(txns, depotId, game, productId, lang, editing?.id) : 0;
  // Verkauf: was liegt im gewählten Portfolio?
  const heldGames = useMemo(() => new Set(txns.map((t) => t.game)), [txns]);
  const heldCatalogs = useCatalogs(heldGames); // für Bild und aktuellen Namen
  const heldItems = useMemo(() => (creatingDepot ? [] : positions(txns.filter((t) => t.depot_id === depotId)))
    .filter((p) => p.quantity > 0)
    .map((p) => {
      const prod = heldCatalogs[p.game]?.products.find((x) => x.id === p.productId);
      return {
        game: p.game, productId: p.productId, language: p.language, name: prod?.name ?? p.productName ?? `#${p.productId}`,
        quantity: p.quantity, image: prod?.image ?? null, category: prod?.category ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name)), [txns, depotId, creatingDepot, heldCatalogs]);
  const fixedProduct = Boolean(editing || prefill);

  // Escape schließt, Fokus bleibt im Dialog
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const qty = Number(quantity);
    const cents = parseEuro(price);
    if (!productId || !lang) return setError("Please choose a product and language.");
    if (!Number.isInteger(qty) || qty < 1) return setError("Quantity must be a whole number of 1 or more.");
    if (cents === null) return setError("Please enter the price per item, e.g. 28,50.");
    if (!date || date > todayIso()) return setError("The date can't be in the future.");
    if (creatingDepot && !newDepot.trim()) return setError("Please name the new portfolio.");
    if (kind === "sell" && !creatingDepot && qty > holding) {
      return setError(holding ? `You only hold ${holding} in this portfolio.` : "You don't hold this product in this portfolio.");
    }
    setBusy(true);
    try {
      let depot = depotId;
      if (creatingDepot) depot = (await api.addDepot(newDepot)).id;
      else if (kind === "sell" && qty > holding) throw new Error("not enough");
      const row: TxnInput = {
        depot_id: depot, game, product_id: productId, product_name: product?.name ?? editing?.product_name ?? null,
        language: lang, kind, quantity: qty, unit_price_cents: cents, trade_date: date, note: note.trim() || null,
      };
      if (editing) {
        const after = txns.map((t) => (t.id === editing.id ? { ...t, ...row } : t));
        if (wouldOversell(after)) throw new Error("This change would leave more sold than bought. Please check the sales first.");
        await api.updateTxn(editing.id, row);
      } else {
        await api.addTxn(row);
      }
      await mutate();
      onClose();
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error && err.message !== "not enough" ? err.message : "Could not save. Please try again.");
    }
  }

  // direkt an <body>, damit der Dialog nichts von der Umgebung erbt (z. B. rechtsbündige Tabellenzelle)
  return createPortal(
    <div className="fixed inset-0 z-50 flex overflow-y-auto bg-ink/40 p-4 text-left"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="txn-title"
        className="m-auto w-full max-w-lg rounded-[var(--radius-panel)] bg-surface p-6 shadow-2xl">
        <div className="flex items-center justify-between gap-4">
          <h2 id="txn-title" className="display text-2xl">{editing ? "Edit transaction" : "Add to portfolio"}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-2xl leading-none text-slate hover:text-ink">×</button>
        </div>

        <form onSubmit={save} className="mt-5 flex flex-col gap-4">
          <Segmented label="Type" value={kind} onChange={(v) => { setKind(v as Kind); if (!fixedProduct) setProductId(null); }}
            options={[{ value: "buy", label: "Buy" }, { value: "sell", label: "Sell" }]} />

          <div>
            <Label htmlFor={ids.depot}>Portfolio</Label>
            {depots.length > 0 && (
              <select id={ids.depot} value={depotId} onChange={(e) => setDepotId(e.target.value)} className={input}>
                {depots.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                <option value="new">+ New portfolio…</option>
              </select>
            )}
            {creatingDepot && (
              <input id={depots.length ? ids.newDepot : ids.depot} value={newDepot} onChange={(e) => setNewDepot(e.target.value)}
                placeholder="Name of the new portfolio, e.g. Long term" maxLength={60}
                aria-label="Name of the new portfolio" className={`${input} ${depots.length ? "mt-2" : ""}`} />
            )}
          </div>

          {!productId ? (
            kind === "sell" ? (
              <HeldPicker items={heldItems} onPick={(x) => { setGame(x.game); setProductId(x.productId); setLanguage(x.language); }} />
            ) : (
              <>
                <div>
                  <Label htmlFor={ids.game}>Game</Label>
                  <select id={ids.game} value={game} onChange={(e) => setGame(e.target.value)} className={input}>
                    {GAMES.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
                  </select>
                </div>
                <ProductPicker key={game} game={game} onPick={(p) => setProductId(p.id)} />
              </>
            )
          ) : (
            <div className="flex items-center gap-3 rounded-[var(--radius-control)] bg-paper p-3 ring-1 ring-line">
              <Thumb src={product?.image ?? null} category={product?.category} size={44} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{product?.name ?? editing?.product_name ?? `#${productId}`}</p>
                <p className="text-xs text-slate">{gameOf(game)?.name} · Cardmarket ID {productId}</p>
              </div>
              {!fixedProduct && (
                <button type="button" onClick={() => setProductId(null)} className="text-sm text-cobalt hover:underline">Change</button>
              )}
            </div>
          )}

          {productId && langs.length > 0 && (
            <div>
              <span className="mb-1 block text-sm font-semibold">Language</span>
              <Segmented label="Language" value={lang ?? ""} onChange={(v) => setLanguage(v as Lang)}
                options={langs.map((l) => ({ value: l, label: LANG_SHORT[l] }))} />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor={ids.date}>{kind === "buy" ? "Bought on" : "Sold on"}</Label>
              <input id={ids.date} type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} className={input} />
            </div>
            <div>
              <Label htmlFor={ids.qty}>Quantity</Label>
              <input id={ids.qty} type="number" inputMode="numeric" min={1} step={1} value={quantity}
                onChange={(e) => setQuantity(e.target.value)} className={`num ${input}`} />
              {kind === "sell" && productId && lang && !creatingDepot && (
                <p className="mt-1 text-xs text-slate">You hold {holding}.</p>
              )}
            </div>
            <div>
              <Label htmlFor={ids.price}>{kind === "buy" ? "Price per item" : "Received per item"}</Label>
              <div className="flex h-10 items-center rounded-[var(--radius-control)] border border-line bg-surface px-3 focus-within:border-cobalt">
                <span className="mr-1 text-slate">€</span>
                <input id={ids.price} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)}
                  placeholder="0,00" className="num w-full bg-transparent outline-none" />
              </div>
              <p className="mt-1 text-xs text-slate">{kind === "buy" ? "Incl. shipping and fees." : "After fees and shipping."}</p>
            </div>
          </div>

          <div>
            <Label htmlFor={ids.note}>Note (optional)</Label>
            <input id={ids.note} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
              placeholder={lang ? `e.g. bought at a local shop, ${LANG_LABEL[lang]}` : "e.g. bought at a local shop"} className={input} />
          </div>

          {error && <p role="alert" className="rounded-lg bg-down-soft px-3 py-2 text-sm text-down">{error}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="h-10 rounded-[var(--radius-control)] px-4 ring-1 ring-line hover:ring-ink">Cancel</button>
            <button type="submit" disabled={busy}
              className="h-10 rounded-[var(--radius-control)] bg-ink px-5 font-semibold text-white hover:bg-cobalt disabled:opacity-60">
              {busy ? "Saving…" : editing ? "Save changes" : kind === "buy" ? "Add purchase" : "Add sale"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
