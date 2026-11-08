"use client";

import { use } from "react";
import { useProduct } from "@/lib/data";
import { LANG_LABEL, LANGS, count, money } from "@/lib/format";
import { useSettings } from "@/lib/settings";

export default function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: p, error } = useProduct(Number(id));
  const { region, inclShipping } = useSettings();
  if (error) return <p className="text-slate">This product is not tracked. Search for another one above.</p>;
  if (!p) return <p className="text-slate">Loading…</p>;
  return (
    <article>
      <div className="flex flex-col gap-6 sm:flex-row">
        {p.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.image} alt={p.name ?? ""} className="h-48 w-48 rounded-[var(--radius-panel)] bg-surface object-contain p-3" />
        )}
        <div>
          <p className="text-sm text-slate">
            {p.category} <span className="num ml-2">#{p.id}</span>
          </p>
          <h1 className="display mt-1 text-3xl sm:text-4xl">{p.name}</h1>
          <dl className="mt-6 grid grid-cols-[auto_auto_auto] gap-x-8 gap-y-2">
            {LANGS.filter((l) => p.languages[l]).map((l) => {
              const v = p.languages[l]!;
              return (
                <div key={l} className="contents">
                  <dt className="text-slate">{LANG_LABEL[l]}</dt>
                  <dd className="num font-semibold">{money(v.price?.[region]?.[inclShipping ? "incl" : "excl"])}</dd>
                  <dd className="num text-slate">{count(v.items)} in stock</dd>
                </div>
              );
            })}
          </dl>
        </div>
      </div>
    </article>
  );
}
