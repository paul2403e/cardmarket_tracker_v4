"use client";

// Anzeige-Einstellung "EU only" (Standard an). Bis es Konten gibt (Meilenstein 6) merkt sich der Browser die Auswahl.
// Preise in Listen sind immer inkl. Versand (was man wirklich zahlt); die Produktseite zeigt beide.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Region } from "./types";

interface Settings {
  euOnly: boolean;
  setEuOnly: (v: boolean) => void;
  region: Region;
}

const KEY = "cm-tracker-settings";
const Ctx = createContext<Settings | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [euOnly, setEuOnly] = useState(true);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
      if (typeof saved.euOnly === "boolean") setEuOnly(saved.euOnly);
    } catch {
      /* gesperrter Speicher: Standardwerte */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ euOnly }));
    } catch {
      /* egal */
    }
  }, [euOnly]);

  return <Ctx.Provider value={{ euOnly, setEuOnly, region: euOnly ? "eu" : "all" }}>{children}</Ctx.Provider>;
}

export function useSettings(): Settings {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSettings outside SettingsProvider");
  return ctx;
}
