"use client";

// Anzeige-Einstellungen: "EU only" (Standard an) und die Listen der Startseite (Mindestbestand, Mindestpreis,
// Einträge pro Liste). Bis es Konten gibt (Meilenstein 6) merkt sich der Browser die Auswahl.
// Preise in Listen sind immer inkl. Versand (was man wirklich zahlt); die Produktseite zeigt beide.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { LIST_DEFAULTS, LIST_SIZES, type ListPrefs } from "./market";
import type { Region } from "./types";

interface Settings {
  euOnly: boolean;
  setEuOnly: (v: boolean) => void;
  region: Region;
  lists: ListPrefs;
  setLists: (v: Partial<ListPrefs>) => void;
  resetLists: () => void;
}

const KEY = "cm-tracker-settings";
const Ctx = createContext<Settings | null>(null);

const num = (v: unknown, fallback: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v) : fallback;

function cleanLists(raw: Partial<ListPrefs> | undefined): ListPrefs {
  const size = raw?.listSize;
  return {
    minItems: num(raw?.minItems, LIST_DEFAULTS.minItems, 100_000),
    minPrice: num(raw?.minPrice, LIST_DEFAULTS.minPrice, 1_000_000),
    listSize: typeof size === "number" && LIST_SIZES.includes(size) ? size : LIST_DEFAULTS.listSize,
  };
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [euOnly, setEuOnly] = useState(true);
  const [lists, setListsState] = useState<ListPrefs>(LIST_DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
      if (typeof saved.euOnly === "boolean") setEuOnly(saved.euOnly);
      setListsState(cleanLists(saved.lists));
    } catch {
      /* gesperrter Speicher: Standardwerte */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ euOnly, lists }));
    } catch {
      /* egal */
    }
  }, [euOnly, lists, loaded]);

  return (
    <Ctx.Provider value={{
      euOnly, setEuOnly, region: euOnly ? "eu" : "all",
      lists,
      setLists: (v) => setListsState((cur) => cleanLists({ ...cur, ...v })),
      resetLists: () => setListsState(LIST_DEFAULTS),
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
