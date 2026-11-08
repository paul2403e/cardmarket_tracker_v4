"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { matches } from "@/components/Search";
import { useCatalog } from "@/lib/data";

function Results() {
  const q = useSearchParams().get("q") ?? "";
  const { data } = useCatalog();
  const list = (data?.products ?? []).filter((p) => !q || matches(p, q)).slice(0, 200);
  return (
    <>
      <h1 className="display text-3xl">{q ? `Results for “${q}”` : "All products"}</h1>
      <ul className="mt-6 divide-y divide-line">
        {list.map((p) => (
          <li key={p.id}>
            <Link href={`/product/${p.id}`} className="flex justify-between py-2 hover:text-cobalt">
              <span>{p.name}</span>
              <span className="num text-slate">#{p.id}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function Browse() {
  return (
    <Suspense>
      <Results />
    </Suspense>
  );
}
