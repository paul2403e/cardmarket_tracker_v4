"use client";

import { Search } from "@/components/Search";
import { MarketIndex } from "@/components/home/MarketIndex";
import { Movers } from "@/components/home/Movers";
import { Categories, NewProducts, StockDrops } from "@/components/home/Lists";
import { useStatus } from "@/lib/data";
import { count } from "@/lib/format";

export default function Home() {
  const { data: status, error } = useStatus();
  return (
    <div className="flex flex-col gap-14">
      <section className="grid gap-8 pt-4 lg:grid-cols-[1fr_1.15fr] lg:items-center">
        <div>
          <h1 className="display max-w-[14ch] text-4xl sm:text-5xl">What sealed Pokémon is worth today</h1>
          <p className="mt-4 max-w-[52ch] text-slate">
            Fair prices from every Cardmarket offer, updated each morning. Damaged, opened and bait listings are left out.
          </p>
          <div className="mt-6">
            <Search large />
          </div>
          <p className="mt-3 text-sm text-slate">
            {error && "Market data could not be loaded right now."}
            {status && <>Tracking {count(status.products)} products in {count(status.variants)} language versions.</>}
          </p>
        </div>
        <MarketIndex />
      </section>

      <Movers />

      <div className="grid gap-12 md:grid-cols-2">
        <StockDrops />
        <NewProducts />
      </div>

      <Categories />
    </div>
  );
}
