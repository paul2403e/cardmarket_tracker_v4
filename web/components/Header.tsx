"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSettings } from "@/lib/settings";
import { Search } from "./Search";
import { Switch } from "./Switch";

import { SITE_NAME } from "@/lib/site";

export function Header() {
  const { euOnly, setEuOnly, inclShipping, setInclShipping } = useSettings();
  const home = usePathname() === "/";
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label={`${SITE_NAME} home`}>
          <span className="h-6 w-6 rounded-[5px]" style={{ background: "var(--holo)" }} aria-hidden />
          <span className="display text-lg">{SITE_NAME}</span>
        </Link>
        <nav className="flex gap-1 text-sm">
          <Link href="/browse" className="rounded-[var(--radius-control)] px-3 py-1.5 text-slate hover:bg-cobalt-soft hover:text-ink">
            Browse
          </Link>
        </nav>
        <div className="order-last w-full sm:order-none sm:ml-auto sm:w-72">{!home && <Search />}</div>
        <div className="flex items-center gap-1 sm:ml-0">
          <Switch label="EU only" checked={euOnly} onChange={setEuOnly}
            hint="Prices only from sellers in the EU (no customs). Stock always counts all countries." />
          <Switch label="Incl. shipping" checked={inclShipping} onChange={setInclShipping}
            hint="Prices including shipping to Germany" />
        </div>
      </div>
    </header>
  );
}
