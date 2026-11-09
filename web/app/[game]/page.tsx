"use client";

import { Search } from "@/components/Search";
import { MarketIndex } from "@/components/home/MarketIndex";
import { Movers, Supply } from "@/components/home/Movers";
import { Categories, NewProducts } from "@/components/home/Lists";
import { useStatus } from "@/lib/data";
import { useGame } from "@/lib/games";
import { count } from "@/lib/format";

export default function Home() {
  const game = useGame();
  const { data: status, error } = useStatus();
  return (
    <div className="flex flex-col gap-14">
      <section className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-center">
        <div>
          <h1 className="display max-w-[16ch] text-3xl sm:text-4xl">What sealed {game.name} is worth today</h1>
          <p className="mt-3 max-w-[52ch] text-slate">
            Fair prices from every Cardmarket offer, updated each morning. Damaged, opened and bait listings are left out.
          </p>
          <div className="mt-5">
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
      <Supply />
      <NewProducts />
      <Categories />
    </div>
  );
}
