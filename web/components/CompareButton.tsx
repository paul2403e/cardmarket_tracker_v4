"use client";

// "Compare" legt das Produkt (in dieser Sprache) zum Vergleich dazu und öffnet die Vergleichsseite;
// "All languages" legt alle Sprachen des Produkts dazu (solange Platz ist).
import { useRouter } from "next/navigation";
import { COMPARE_MAX, useSettings } from "@/lib/settings";
import type { Lang } from "@/lib/types";

export function CompareButton({ game, productId, language, languages = [], className }: {
  game: string; productId: number; language: Lang; languages?: Lang[]; className: string;
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
  const all = languages.map(keyOf);
  const freshAll = all.filter((k) => !compare.items.includes(k)).length;
  const oneFull = !compare.items.includes(one[0]) && compare.items.length >= COMPARE_MAX;
  const allFull = compare.items.length + freshAll > COMPARE_MAX;
  const full = `The comparison already has ${compare.items.length} of ${COMPARE_MAX} products – remove some there first`;
  return (
    <>
      <button type="button" onClick={() => go(one)} className={className}
        title={oneFull ? full : compare.items.includes(one[0]) ? "Already in the comparison" : "Add this language to the comparison"}>
        Compare
      </button>
      {languages.length > 1 && (
        <button type="button" onClick={() => go(all)} className={className}
          title={allFull ? full : "Add all languages of this product to the comparison"}>
          Compare all languages
        </button>
      )}
    </>
  );
}
