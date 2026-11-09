"use client";

// Watchlist und Preisalarme (Supabase, Tabellen aus supabase/migrations/0003_watchlist_alerts.sql).
// Geprüft werden die Alarme jeden Morgen vom Laptop nach dem Veröffentlichen (scraper/cmtracker/price_alerts.py).
import useSWR from "swr";
import { useAuth } from "./auth";
import { supabaseBrowser } from "./supabase/client";
import { count, money } from "./format";
import type { Lang, Region } from "./types";

export interface Watch {
  game: string;
  product_id: number;
  language: Lang;
  created_at: string;
}

export type AlertKind = "price_below" | "price_above" | "items_below" | "items_above" | "change";

export interface Alert {
  id: string;
  game: string;
  product_id: number;
  language: Lang;
  product_name: string | null;
  kind: AlertKind;
  metric: "price" | "items";
  threshold: number;
  days: number;
  direction: "up" | "down" | "any";
  basis: "incl" | "excl";
  region: Region;
  active: boolean;
  armed: boolean;
  last_triggered_at: string | null;
  last_value: number | null;
  created_at: string;
}

export type AlertInput = Omit<Alert, "id" | "armed" | "last_triggered_at" | "last_value" | "created_at">;

export interface AlertEvent {
  id: string;
  alert_id: string | null;
  game: string;
  product_id: number;
  language: Lang;
  product_name: string | null;
  message: string;
  day: string;
  created_at: string;
}

interface WatchData {
  watch: Watch[];
  alerts: Alert[];
  events: AlertEvent[];
}

async function load(): Promise<WatchData> {
  const sb = supabaseBrowser()!;
  const [w, a, e] = await Promise.all([
    sb.from("watchlist").select("game,product_id,language,created_at").order("created_at", { ascending: false }),
    sb.from("alerts").select("*").order("created_at", { ascending: false }),
    sb.from("alert_events").select("*").order("created_at", { ascending: false }).limit(50),
  ]);
  for (const r of [w, a, e]) if (r.error) throw r.error;
  const num = <T extends { product_id: number }>(rows: T[]) => rows.map((r) => ({ ...r, product_id: Number(r.product_id) }));
  return {
    watch: num(w.data as Watch[]),
    alerts: num(a.data as Alert[]).map((x) => ({ ...x, threshold: Number(x.threshold), last_value: x.last_value === null ? null : Number(x.last_value) })),
    events: num(e.data as AlertEvent[]),
  };
}

export function useWatch() {
  const { user } = useAuth();
  return useSWR<WatchData>(user ? ["watch", user.id] : null, load, { revalidateOnFocus: false });
}

function check(res: { error: { message: string } | null }) {
  if (res.error) throw new Error(res.error.message);
}

export const watchApi = {
  async add(game: string, productId: number, language: Lang) {
    check(await supabaseBrowser()!.from("watchlist")
      .upsert({ game, product_id: productId, language }, { onConflict: "user_id,game,product_id,language", ignoreDuplicates: true }));
  },
  /** Von der Watchlist nehmen – samt den Alarmen für dieses Produkt in dieser Sprache. */
  async remove(game: string, productId: number, language: Lang) {
    const sb = supabaseBrowser()!;
    check(await sb.from("alerts").delete().eq("game", game).eq("product_id", productId).eq("language", language));
    check(await sb.from("watchlist").delete().eq("game", game).eq("product_id", productId).eq("language", language));
  },
  async setActive(id: string, active: boolean) {
    check(await supabaseBrowser()!.from("alerts").update(active ? { active, armed: true, last_checked_day: null } : { active }).eq("id", id));
  },
  async addAlert(a: AlertInput) {
    check(await supabaseBrowser()!.from("alerts").insert(a));
  },
  /** Geänderter Alarm ist wieder scharf und wird beim nächsten Markttag neu geprüft. */
  async updateAlert(id: string, a: Partial<AlertInput>) {
    check(await supabaseBrowser()!.from("alerts").update({ ...a, armed: true, last_checked_day: null }).eq("id", id));
  },
  async deleteAlert(id: string) {
    check(await supabaseBrowser()!.from("alerts").delete().eq("id", id));
  },
  async deleteEvents() {
    check(await supabaseBrowser()!.from("alert_events").delete().not("id", "is", null));
  },
};


/** Bedingung in Worten, z. B. "Price below €120.00 (incl. shipping, EU)". */
export function alertText(a: Pick<Alert, "kind" | "metric" | "threshold" | "days" | "direction" | "basis" | "region">): string {
  const basis = `${a.basis === "excl" ? "item only" : "incl. shipping"}, ${a.region === "eu" ? "EU" : "all countries"}`;
  switch (a.kind) {
    case "price_below": return `Price below ${money(a.threshold)} (${basis})`;
    case "price_above": return `Price above ${money(a.threshold)} (${basis})`;
    case "items_below": return `Items listed below ${count(a.threshold)}`;
    case "items_above": return `Items listed above ${count(a.threshold)}`;
    case "change": {
      const items = a.metric === "items";
      const verb = a.direction === "up" ? "rise" : a.direction === "down" ? "fall" : "change";
      return `${items ? "Items listed" : "Price"} ${items ? verb : `${verb}s`} by ${a.threshold} % or more in ${a.days} day${a.days === 1 ? "" : "s"}${a.metric === "price" ? ` (${basis})` : ""}`;
    }
  }
}

export const sameVariant = (a: { game: string; product_id: number; language: Lang }, game: string, productId: number, language: Lang) =>
  a.game === game && a.product_id === productId && a.language === language;
