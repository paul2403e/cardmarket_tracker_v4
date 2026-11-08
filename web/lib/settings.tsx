"use client";

// Anzeige-Einstellungen: "EU only" und "incl. shipping". Bis es Konten gibt (Meilenstein 6) merkt sich
// der Browser die Auswahl. Standard: beides an.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Region } from "./types";

interface Settings {
  euOnly: boolean;
  inclShipping: boolean;
  setEuOnly: (v: boolean) => void;
  setInclShipping: (v: boolean) => void;
  region: Region;
}

const KEY = "cm-tracker-settings";
const Ctx = createContext<Settings | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [euOnly, setEuOnly] = useState(true);
  const [inclShipping, setInclShipping] = useState(true);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
      if (typeof saved.euOnly === "boolean") setEuOnly(saved.euOnly);
      if (typeof saved.inclShipping === "boolean") setInclShipping(saved.inclShipping);
    } catch {
      /* gesperrter Speicher: Standardwerte */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ euOnly, inclShipping }));
    } catch {
      /* egal */
    }
  }, [euOnly, inclShipping]);

  return (
    <Ctx.Provider value={{ euOnly, inclShipping, setEuOnly, setInclShipping, region: euOnly ? "eu" : "all" }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSettings(): Settings {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSettings outside SettingsProvider");
  return ctx;
}
