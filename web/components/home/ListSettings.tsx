"use client";

// Einstellungen der Startseiten-Listen: Mindestbestand, Mindestpreis, Einträge pro Liste.
import { useId } from "react";
import { Segmented } from "@/components/Segmented";
import { LIST_DEFAULTS, LIST_SIZES, type ListName } from "@/lib/market";
import { useSettings } from "@/lib/settings";

export function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  );
}

function NumberField({ label, prefix, value, onChange }: {
  label: string; prefix?: string; value: number; onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm text-slate">{label}</label>
      <div className="flex h-9 items-center rounded-[var(--radius-control)] border border-line bg-surface px-3 focus-within:border-cobalt">
        {prefix && <span className="mr-1 text-slate">{prefix}</span>}
        <input id={id} type="number" inputMode="numeric" min={0} step={1} value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(n) && n >= 0) onChange(n);
          }}
          className="num w-20 bg-transparent text-sm outline-none" />
      </div>
    </div>
  );
}

export function SettingsButton({ open, onClick, controls }: { open: boolean; onClick: () => void; controls: string }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={open} aria-controls={controls}
      className={`flex h-[34px] items-center gap-2 rounded-[var(--radius-control)] px-3 text-sm ring-1 ${
        open ? "bg-ink text-white ring-ink" : "bg-surface text-ink ring-line hover:ring-ink"
      }`}>
      <GearIcon /> Settings
    </button>
  );
}

export function ListSettings({ id, list }: { id: string; list: ListName }) {
  const { lists: all, setList, resetList } = useSettings();
  const lists = all[list];
  const setLists = (v: Parameters<typeof setList>[1]) => setList(list, v);
  const isDefault = lists.minItems === LIST_DEFAULTS.minItems && lists.minPrice === LIST_DEFAULTS.minPrice &&
    lists.listSize === LIST_DEFAULTS.listSize;
  return (
    <div id={id} className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3 rounded-[var(--radius-panel)] bg-surface p-4 ring-1 ring-line">
      <NumberField label={list === "supply" ? "Minimum items at the start" : "Minimum items listed"} value={lists.minItems} onChange={(v) => setLists({ minItems: v })} />
      <NumberField label="Minimum price" prefix="€" value={lists.minPrice} onChange={(v) => setLists({ minPrice: v })} />
      <div className="flex flex-col gap-1">
        <span className="text-sm text-slate">Entries per list</span>
        <Segmented label="Entries per list" value={String(lists.listSize)}
          options={LIST_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
          onChange={(v) => setLists({ listSize: Number(v) })} />
      </div>
      <button type="button" onClick={() => resetList(list)} disabled={isDefault}
        className="h-9 rounded-[var(--radius-control)] px-3 text-sm text-cobalt hover:bg-cobalt-soft disabled:cursor-default disabled:text-slate disabled:hover:bg-transparent">
        Reset to default
      </button>
      <p className="w-full text-xs text-slate">
        Applies to {list === "supply" ? "Supply" : "Top movers"} only. Saved in this browser.
      </p>
    </div>
  );
}
