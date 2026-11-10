"use client";

// "Compare": legt das Produkt (in dieser Sprache) zum Vergleich dazu und öffnet die Vergleichsseite.
import { useRouter } from "next/navigation";
import { COMPARE_MAX, useSettings } from "@/lib/settings";
import type { Lang } from "@/lib/types";

export function CompareButton({ game, productId, language, className }: {
  game: string; productId: number; language: Lang; className: string;
}) {
  const router = useRouter();
  const { compare, setCompare } = useSettings();
  const key = `${game}:${productId}:${language}`;
  const inList = compare.items.includes(key);
  const full = !inList && compare.items.length >= COMPARE_MAX;
  function go() {
    const next = inList || full ? compare.items : [...compare.items, key];
    setCompare({ items: next });
    router.push(`/compare?items=${next.join(",")}`);
  }
  return (
    <button type="button" onClick={go} className={className}
      title={full ? `The comparison already has ${COMPARE_MAX} products – remove one there first` : inList ? "Already in the comparison" : "Add to the comparison"}>
      Compare
    </button>
  );
}
