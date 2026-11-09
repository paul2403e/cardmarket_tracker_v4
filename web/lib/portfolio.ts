"use client";

// Portfolio: Depots und Transaktionen (Supabase, Tabellen aus supabase/migrations/0002_portfolio.sql)
// und die Auswertung nach FIFO: Die zuerst gekauften Stücke gelten als zuerst verkauft.
// Beträge in Cent. Kaufpreis = pro Stück inkl. Versand und Gebühren; Verkauf = Erlös pro Stück nach Kosten.
import useSWR from "swr";
import { useAuth } from "./auth";
import { supabaseBrowser } from "./supabase/client";
import type { Lang } from "./types";

export interface Depot {
  id: string;
  name: string;
  created_at: string;
}

export type Kind = "buy" | "sell";

export interface Txn {
  id: string;
  depot_id: string;
  game: string;
  product_id: number;
  product_name: string | null;
  language: Lang;
  kind: Kind;
  quantity: number;
  unit_price_cents: number;
  trade_date: string; // JJJJ-MM-TT
  note: string | null;
  created_at: string;
}

export type TxnInput = Omit<Txn, "id" | "created_at">;

// --- Laden und Speichern ---------------------------------------------------------------------
interface PortfolioData {
  depots: Depot[];
  txns: Txn[];
}

async function load(): Promise<PortfolioData> {
  const sb = supabaseBrowser()!;
  const [d, t] = await Promise.all([
    sb.from("depots").select("id,name,created_at").order("created_at"),
    sb.from("transactions").select("*").order("trade_date").order("created_at"),
  ]);
  if (d.error) throw d.error;
  if (t.error) throw t.error;
  return { depots: d.data as Depot[], txns: (t.data as Txn[]).map((x) => ({ ...x, product_id: Number(x.product_id) })) };
}

/** Depots und Transaktionen des angemeldeten Nutzers (null-Schlüssel = nicht angemeldet). */
export function usePortfolio() {
  const { user } = useAuth();
  return useSWR<PortfolioData>(user ? ["portfolio", user.id] : null, load, { revalidateOnFocus: false });
}

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export const api = {
  async addDepot(name: string): Promise<Depot> {
    return check(await supabaseBrowser()!.from("depots").insert({ name: name.trim() }).select().single());
  },
  async renameDepot(id: string, name: string) {
    check(await supabaseBrowser()!.from("depots").update({ name: name.trim() }).eq("id", id));
  },
  async deleteDepot(id: string) {
    check(await supabaseBrowser()!.from("depots").delete().eq("id", id));
  },
  async addTxn(t: TxnInput) {
    check(await supabaseBrowser()!.from("transactions").insert(t));
  },
  async updateTxn(id: string, t: Partial<TxnInput>) {
    check(await supabaseBrowser()!.from("transactions").update(t).eq("id", id));
  },
  async deleteTxn(id: string) {
    check(await supabaseBrowser()!.from("transactions").delete().eq("id", id));
  },
};

// --- Auswertung (FIFO) -----------------------------------------------------------------------
export interface Lot {
  txnId: string; // der Kauf, aus dem die Stücke stammen
  quantity: number; // davon noch gehalten
  unitCents: number;
  date: string;
}

export interface Position {
  key: string; // depot|game|id|lang
  depotId: string;
  game: string;
  productId: number;
  productName: string | null;
  language: Lang;
  quantity: number; // gehaltene Stück
  costCents: number; // Einstand der gehaltenen Stück (FIFO)
  realizedCents: number; // realisierter Gewinn/Verlust aus Verkäufen
  soldQuantity: number;
  lots: Lot[]; // offene Kauf-Posten (älteste zuerst)
  oversold: number; // mehr verkauft als gekauft (Eingabefehler)
}

const order = (a: Txn, b: Txn) =>
  a.trade_date.localeCompare(b.trade_date) || (a.kind === b.kind ? 0 : a.kind === "buy" ? -1 : 1) ||
  a.created_at.localeCompare(b.created_at);

/** Positionen je Depot + Produkt + Sprache nach FIFO. Käufe am selben Tag zählen vor Verkäufen. */
export function positions(txns: Txn[]): Position[] {
  const groups = new Map<string, Txn[]>();
  for (const t of txns) {
    const key = `${t.depot_id}|${t.game}|${t.product_id}|${t.language}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }
  const out: Position[] = [];
  for (const [key, list] of groups) {
    list.sort(order);
    const lots: Lot[] = [];
    let realized = 0;
    let sold = 0;
    let oversold = 0;
    for (const t of list) {
      if (t.kind === "buy") {
        lots.push({ txnId: t.id, quantity: t.quantity, unitCents: t.unit_price_cents, date: t.trade_date });
        continue;
      }
      let left = t.quantity;
      sold += t.quantity;
      while (left > 0 && lots.length) {
        const lot = lots[0];
        const q = Math.min(left, lot.quantity);
        realized += q * (t.unit_price_cents - lot.unitCents);
        lot.quantity -= q;
        left -= q;
        if (lot.quantity === 0) lots.shift();
      }
      oversold += left;
    }
    const last = list[list.length - 1];
    out.push({
      key,
      depotId: last.depot_id,
      game: last.game,
      productId: last.product_id,
      productName: last.product_name,
      language: last.language,
      quantity: lots.reduce((s, l) => s + l.quantity, 0),
      costCents: lots.reduce((s, l) => s + l.quantity * l.unitCents, 0),
      realizedCents: realized,
      soldQuantity: sold,
      lots,
      oversold,
    });
  }
  return out;
}

/** Wie viele Stück dieses Produkts im Depot liegen (für die Prüfung beim Verkauf). */
export function held(txns: Txn[], depotId: string, game: string, productId: number, language: Lang, skipId?: string) {
  const p = positions(txns.filter((t) => t.id !== skipId && t.depot_id === depotId && t.game === game &&
    t.product_id === productId && t.language === language));
  return p[0]?.quantity ?? 0;
}

/** Stücke aus einer Position entfernen (Fehleingabe): bei den zuletzt gekauften, noch gehaltenen Stücken.
 *  Verkaufte Stücke und damit der realisierte Gewinn bleiben unberührt (der Kauf wird nur gekürzt).
 *  Ergebnis: Käufe, die gekürzt (neue Menge) oder ganz gelöscht (0) werden. */
export function removalPlan(txns: Txn[], position: Position, units: number): { id: string; quantity: number }[] {
  const qty = new Map(txns.map((t) => [t.id, t.quantity]));
  const plan: { id: string; quantity: number }[] = [];
  let left = Math.min(units, position.quantity);
  for (const lot of [...position.lots].reverse()) {
    if (left <= 0) break;
    const take = Math.min(left, lot.quantity);
    plan.push({ id: lot.txnId, quantity: (qty.get(lot.txnId) ?? 0) - take });
    left -= take;
  }
  return plan;
}

export async function applyRemoval(plan: { id: string; quantity: number }[]) {
  for (const step of plan) {
    if (step.quantity <= 0) await api.deleteTxn(step.id);
    else await api.updateTxn(step.id, { quantity: step.quantity });
  }
}

/** Würde die Änderung irgendwo mehr Verkäufe als Käufe ergeben? (z. B. Kauf löschen, der schon verkauft ist) */
export function wouldOversell(txns: Txn[]): boolean {
  return positions(txns).some((p) => p.oversold > 0);
}

// --- Eingabe -------------------------------------------------------------------------------
/** "28,50", "28.50", "1.234,50", "€ 28" -> Cent; null bei ungültiger Eingabe. */
export function parseEuro(text: string): number | null {
  let s = text.replace(/[€\s]/g, "");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export const centsToInput = (c: number) => (c / 100).toFixed(2).replace(".", ",");

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
