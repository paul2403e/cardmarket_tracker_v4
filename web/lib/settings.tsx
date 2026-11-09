"use client";

// Anzeige-Einstellungen: "EU only" (Standard an) und die Listen der Startseite – Top movers und Supply jeweils mit
// eigenem Mindestbestand, Mindestpreis und Einträgen, "New on Cardmarket" mit eigener Anzahl.
// Der Browser merkt sich die Auswahl; wer angemeldet ist, bekommt sie zusätzlich im Konto gespeichert
// (Tabelle user_settings) – samt zuletzt gewähltem Spiel – und hat sie so auf allen Geräten.
// Preise in Listen sind immer inkl. Versand (was man wirklich zahlt); die Produktseite zeigt beide.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "./auth";
import { GAMES, GAME_EVENT, gameOf, rememberGame, rememberedGame } from "./games";
import { supabaseBrowser } from "./supabase/client";
import { LIST_DEFAULTS, LIST_SIZES, type ListName, type ListPrefs } from "./market";
import type { Region } from "./types";

interface Lists {
  movers: ListPrefs;
  supply: ListPrefs;
  newSize: number;
}
const LISTS_DEFAULT: Lists = { movers: LIST_DEFAULTS, supply: LIST_DEFAULTS, newSize: LIST_DEFAULTS.listSize };

interface Settings {
  euOnly: boolean;
  setEuOnly: (v: boolean) => void;
  region: Region;
  lists: Lists;
  setList: (name: ListName, v: Partial<ListPrefs>) => void;
  resetList: (name: ListName) => void;
  setNewSize: (n: number) => void;
  /** Portfolio: angekreuzte Spiele (leer = alle) */
  portfolioGames: string[];
  setPortfolioGames: (keys: string[]) => void;
  /** Portfolio-Auswertung: Listen-Einstellungen, Graph-Ansicht */
  pview: PortfolioView;
  setPview: (v: Partial<PortfolioView>) => void;
}

export type ListPeriod = "1d" | "7d" | "30d" | "1y" | "all";
export interface PortfolioView {
  listCount: number; // Gewinner/Verlierer
  listPeriod: ListPeriod;
  listMetric: "pct" | "eur";
  topCount: number; // Top-Positionen nach Wert
  chartMode: "pct" | "eur";
  includeSold: boolean;
}
export const PVIEW_DEFAULT: PortfolioView = {
  listCount: 25, listPeriod: "all", listMetric: "pct", topCount: 25, chartMode: "pct", includeSold: false,
};

function cleanPview(raw: unknown): PortfolioView {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = <T,>(v: unknown, allowed: readonly T[], d: T) => (allowed.includes(v as T) ? (v as T) : d);
  return {
    listCount: pick(r.listCount, LIST_SIZES, PVIEW_DEFAULT.listCount),
    listPeriod: pick(r.listPeriod, ["1d", "7d", "30d", "1y", "all"] as const, PVIEW_DEFAULT.listPeriod),
    listMetric: pick(r.listMetric, ["pct", "eur"] as const, PVIEW_DEFAULT.listMetric),
    topCount: pick(r.topCount, LIST_SIZES, PVIEW_DEFAULT.topCount),
    chartMode: pick(r.chartMode, ["pct", "eur"] as const, PVIEW_DEFAULT.chartMode),
    includeSold: typeof r.includeSold === "boolean" ? r.includeSold : PVIEW_DEFAULT.includeSold,
  };
}

const KEY = "cm-tracker-settings";
const Ctx = createContext<Settings | null>(null);

const num = (v: unknown, fallback: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v) : fallback;
const size = (v: unknown) => (typeof v === "number" && LIST_SIZES.includes(v) ? v : LIST_DEFAULTS.listSize);

function cleanPrefs(raw: Partial<ListPrefs> | undefined): ListPrefs {
  return {
    minItems: num(raw?.minItems, LIST_DEFAULTS.minItems, 100_000),
    minPrice: num(raw?.minPrice, LIST_DEFAULTS.minPrice, 1_000_000),
    listSize: size(raw?.listSize),
  };
}

function cleanGames(raw: unknown): string[] {
  return Array.isArray(raw) ? GAMES.filter((g) => raw.includes(g.key)).map((g) => g.key) : [];
}

function cleanLists(raw: Record<string, unknown> | undefined): Lists {
  if (!raw) return LISTS_DEFAULT;
  if ("minItems" in raw) {
    // ältere Speicherung: eine Einstellung für alle Listen
    const p = cleanPrefs(raw as Partial<ListPrefs>);
    return { movers: p, supply: p, newSize: p.listSize };
  }
  return {
    movers: cleanPrefs(raw.movers as Partial<ListPrefs>),
    supply: cleanPrefs(raw.supply as Partial<ListPrefs>),
    newSize: size(raw.newSize),
  };
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [euOnly, setEuOnly] = useState(true);
  const [lists, setLists] = useState<Lists>(LISTS_DEFAULT);
  const [portfolioGames, setPortfolioGamesState] = useState<string[]>([]);
  const [pview, setPviewState] = useState<PortfolioView>(PVIEW_DEFAULT);
  const [loaded, setLoaded] = useState(false);
  const setPortfolioGames = (keys: string[]) => setPortfolioGamesState(cleanGames(keys));

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
      if (typeof saved.euOnly === "boolean") setEuOnly(saved.euOnly);
      setLists(cleanLists(saved.lists));
      setPortfolioGamesState(cleanGames(saved.portfolioGames));
      setPviewState(cleanPview(saved.pview));
    } catch {
      /* gesperrter Speicher: Standardwerte */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ euOnly, lists, portfolioGames, pview }));
    } catch {
      /* egal */
    }
  }, [euOnly, lists, portfolioGames, pview, loaded]);

  // --- Konto: beim Anmelden laden, danach Änderungen speichern ---
  const { user } = useAuth();
  const [remote, setRemote] = useState<string | null>(null); // Nutzer-ID, deren Einstellungen geladen sind
  const latest = useRef({ euOnly, lists, portfolioGames, pview });
  latest.current = { euOnly, lists, portfolioGames, pview };

  useEffect(() => {
    const sb = supabaseBrowser();
    if (!sb || !user || !loaded) {
      setRemote(null);
      return;
    }
    let cancelled = false;
    sb.from("user_settings").select("settings").eq("user_id", user.id).maybeSingle().then(({ data, error }) => {
      if (cancelled || error) return;
      const saved = data?.settings as {
        euOnly?: unknown; lists?: Record<string, unknown>; lastGame?: string; portfolioGames?: unknown; pview?: unknown;
      } | undefined;
      if (saved) {
        if (typeof saved.euOnly === "boolean") setEuOnly(saved.euOnly);
        if (saved.lists) setLists(cleanLists(saved.lists));
        if (saved.portfolioGames) setPortfolioGamesState(cleanGames(saved.portfolioGames));
        if (saved.pview) setPviewState(cleanPview(saved.pview));
        const g = gameOf(saved.lastGame);
        if (g) rememberGame(g.key);
      }
      setRemote(user.id);
    });
    return () => {
      cancelled = true;
    };
  }, [user, loaded]);

  useEffect(() => {
    const sb = supabaseBrowser();
    if (!sb || !user || remote !== user.id) return;
    const save = () =>
      sb.from("user_settings").upsert({
        user_id: user.id,
        settings: { ...latest.current, lastGame: rememberedGame().key },
        updated_at: new Date().toISOString(),
      }).then(() => undefined);
    let pending = true;
    const flush = () => {
      if (!pending) return;
      pending = false;
      void save();
    };
    const timer = window.setTimeout(flush, 600);
    window.addEventListener(GAME_EVENT, save);
    window.addEventListener("pagehide", flush); // Seite wird verlassen: nicht auf den Timer warten
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(GAME_EVENT, save);
      window.removeEventListener("pagehide", flush);
    };
  }, [euOnly, lists, portfolioGames, pview, user, remote]);

  return (
    <Ctx.Provider value={{
      euOnly, setEuOnly, region: euOnly ? "eu" : "all",
      lists,
      setList: (name, v) => setLists((cur) => ({ ...cur, [name]: cleanPrefs({ ...cur[name], ...v }) })),
      resetList: (name) => setLists((cur) => ({ ...cur, [name]: LIST_DEFAULTS })),
      setNewSize: (n) => setLists((cur) => ({ ...cur, newSize: size(n) })),
      portfolioGames, setPortfolioGames,
      pview, setPview: (v) => setPviewState((cur) => cleanPview({ ...cur, ...v })),
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSettings(): Settings {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSettings outside SettingsProvider");
  return ctx;
}
