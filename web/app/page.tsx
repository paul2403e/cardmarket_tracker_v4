"use client";

import { Search } from "@/components/Search";
import { useStatus } from "@/lib/data";
import { count } from "@/lib/format";

export default function Home() {
  const { data: status, error } = useStatus();
  return (
    <section className="py-10 sm:py-16">
      <h1 className="display max-w-[16ch] text-4xl sm:text-6xl">What sealed Pokémon is worth today</h1>
      <p className="mt-4 max-w-[60ch] text-lg text-slate">
        Fair prices from every Cardmarket offer, updated each morning. Damaged, opened and bait listings are left out.
      </p>
      <div className="mt-8 max-w-2xl">
        <Search large />
      </div>
      <p className="mt-4 text-sm text-slate">
        {error && "Market data could not be loaded. Check the data connection (R2) in Vercel."}
        {status && <>Tracking {count(status.products)} products in {count(status.variants)} language versions.</>}
      </p>
    </section>
  );
}
