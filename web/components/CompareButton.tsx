"use client";

// "Compare" legt das Produkt (in dieser Sprache) zum Vergleich dazu und öffnet die Vergleichsseite.
// Alle Sprachen auf einmal: "+ All" in der Suche auf der Vergleichsseite.
import { useRouter } from "next/navigation";
import { COMPARE_MAX, useSettings } from "@/lib/settings";
import type { Lang } from "@/lib/types";

export function CompareButton({ game, productId, language, className }: {
  game: string; productId: number; language: Lang; className: string;
}) {
  const router = useRouter();
  const { compare, setCompare } = useSettings();
  const keyOf = (l: Lang) => `${game}:${productId}:${l}`;
  function go(add: string[]) {
    const fresh = add.filter((k) => !compare.items.includes(k));
    const next = compare.items.length + fresh.length <= COMPARE_MAX ? [...compare.items, ...fresh] : compare.items;
    setCompare({ items: next });
    router.push(`/compare?items=${next.join(",")}`);
  }
  const one = [keyOf(language)];
  const oneFull = !compare.items.includes(one[0]) && compare.items.length >= COMPARE_MAX;
  const full = `The comparison already has ${compare.items.length} of ${COMPARE_MAX} products – remove some there first`;
  return (
    <button type="button" onClick={() => go(one)} className={className}
        title={oneFull ? full : compare.items.includes(one[0]) ? "Already in the comparison" : "Add this language to the comparison"}>
        Compare
    </button>
  );
}
