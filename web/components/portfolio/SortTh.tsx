"use client";

// Spaltenkopf zum Sortieren: Klick sortiert, zweiter Klick dreht die Richtung (Pfeil zeigt sie an).
export type Sort<K extends string> = { key: K; dir: 1 | -1 };

export function SortTh<K extends string>({ id, label, sort, onSort, right = false, title }: {
  id: K; label: string; sort: Sort<K>; onSort: (k: K) => void; right?: boolean; title?: string;
}) {
  const active = sort.key === id;
  return (
    <th className={`py-2 font-normal ${right ? "text-right" : ""}`} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort(id)} title={title} className={`inline-flex items-center gap-1 hover:text-ink ${active ? "font-semibold text-ink" : ""}`}>
        {label}
        <span aria-hidden className="w-3 text-xs">{active ? (sort.dir === 1 ? "↑" : "↓") : ""}</span>
      </button>
    </th>
  );
}

/** Nächster Sortierzustand: gleiche Spalte -> Richtung drehen; neue Spalte -> Texte A→Z, Zahlen/Daten absteigend. */
export function nextSort<K extends string>(cur: Sort<K>, key: K, textKeys: K[]): Sort<K> {
  return cur.key === key ? { key, dir: cur.dir === 1 ? -1 : 1 } : { key, dir: textKeys.includes(key) ? 1 : -1 };
}
