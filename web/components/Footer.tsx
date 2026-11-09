"use client";

import Link from "next/link";
import { ageHours, notYet, useStatus } from "@/lib/data";
import { relativeTime } from "@/lib/format";

const STALE_HOURS = 36;

/** Hinweis oben, wenn die Daten älter als 36 Stunden sind (z. B. Laptop war länger aus). */
export function StaleBanner() {
  const { data } = useStatus();
  const age = ageHours(data);
  if (age === null || age < STALE_HOURS) return null;
  return (
    <div className="bg-warn-soft text-warn" role="status">
      <p className="mx-auto max-w-[1200px] px-4 py-2 text-sm sm:px-6">
        Prices are from {new Date(data!.day).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}
        {" "}and have not been updated for {Math.round(age / 24)} days. They may not reflect the market today.
      </p>
    </div>
  );
}

export function Footer() {
  const { data, error } = useStatus();
  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto flex max-w-[1200px] flex-wrap justify-between gap-2 px-4 py-5 text-sm text-slate sm:px-6">
        <span>
          {error && !notYet(error) && "Market data is unavailable right now."}
          {data && <>Data updated {relativeTime(data.updatedAt)}, market day {data.day}</>}
        </span>
        <span>
          <Link href="/how-prices-work" className="underline-offset-2 hover:text-ink hover:underline">How fair prices work</Link>
          <span className="ml-4">Prices from Cardmarket offers. Not affiliated with Cardmarket.</span>
        </span>
      </div>
    </footer>
  );
}
