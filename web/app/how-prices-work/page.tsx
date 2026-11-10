import type { Metadata } from "next";
import { ReliabilityBadge } from "@/components/ReliabilityBadge";
import { CONFIDENCE_ORDER, CONFIDENCE_TEXT } from "@/lib/series";

export const metadata: Metadata = {
  title: "How fair prices work",
  description: "How the daily fair price for sealed products is calculated from Cardmarket offers.",
};

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2 border-t border-line py-6 sm:grid-cols-[3rem_1fr]">
      <span className="display num text-2xl text-cobalt" aria-hidden>{n}</span>
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="mt-2 space-y-3 text-slate [&_strong]:text-ink">{children}</div>
      </div>
    </section>
  );
}

export default function HowPricesWork() {
  return (
    <article className="max-w-[68ch]">
      <h1 className="display text-3xl sm:text-4xl">How fair prices work</h1>
      <p className="mt-4 text-lg text-slate">
        The fair price answers one question: what would you realistically pay today for this product in this language
        on Cardmarket? It is calculated every morning from the current offers, with and without shipping to Germany,
        and for EU sellers only or all countries.
      </p>

      <div className="mt-8">
        <Step n={1} title="Leave out offers that don't count">
          <p>
            With <strong>EU only</strong>, sellers outside the 27 EU countries are left out (customs). Offers whose comment
            mentions a flaw are left out too: <strong>damage</strong> (dents, scratches, creases, holes),{" "}
            <strong>foil or seal problems</strong> (tears, loose or missing shrink wrap, resealed),{" "}
            <strong>opened or incomplete</strong> products, and comments that <strong>don&apos;t rule out flaws</strong>{" "}
            (&ldquo;not mint&rdquo;, &ldquo;dents possible&rdquo;). This works in English, German, Italian, Spanish and French.
          </p>
          <p>
            Negations are understood: &ldquo;no damage&rdquo;, &ldquo;no scratches, dents or holes&rdquo; and
            &ldquo;damage-free&rdquo; stay in, but &ldquo;no damage, but small dent&rdquo; is left out. Seller ratings are not filtered.
          </p>
        </Step>
        <Step n={2} title="Remove outliers at the bottom">
          <p>
            This depends on how many offers (listings) a product has on Cardmarket, no matter how many items each one has.
            With <strong>more than 100 listings</strong>, the cheapest valid offer is skipped; with more than 200 the two
            cheapest, with more than 300 the three cheapest.
          </p>
          <p>
            With <strong>up to 100 listings</strong>, only clear bait prices are removed: the cheapest offer (or the two
            cheapest together) when it is <strong>more than 50% below</strong> the median of the next four offers{" "}
            <strong>and</strong> there is a <strong>clear gap of 20% or more</strong> to the next offer. Good deals 20–40%
            below the rest stay in.
          </p>
        </Step>
        <Step n={3} title="Count each offer once">
          <p>
            Each offer counts once, however many items it has, so one seller with five boxes can&apos;t set the price alone.
            Offers are sorted by total price, or by item price without shipping.
          </p>
        </Step>
        <Step n={4} title="Take the cheapest few">
          <p>
            The basket size is 15% of all items listed, at least 1 and at most 7: a market with 14 items gives a basket of
            the 2 cheapest offers, one with 47 or more items a basket of 7.
          </p>
        </Step>
        <Step n={5} title="Ignore a gap upwards">
          <p>
            If at least half of the basket is within 15% of its cheapest offer, only those offers count. One much pricier
            offer can&apos;t pull the price up.
          </p>
        </Step>
        <Step n={6} title="Take the median">
          <p>
            The fair price is the median of the basket. As long as one valid offer is left after step 1, there is always a
            price. With very few offers the page says so (see below), and the price is close to the cheapest valid offer.
          </p>
        </Step>
      </div>

      <section aria-labelledby="rel-title" className="mt-8">
        <h2 id="rel-title" className="display text-2xl">How reliable is a price?</h2>
        <p className="mt-2 text-slate">
          Each price is labelled by the number of offers for the product on Cardmarket today, in that language. This counts
          all offers from all countries – including non-EU and damaged items that the fair price itself leaves out:
        </p>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {CONFIDENCE_ORDER.slice().reverse().map((l) => (
            <li key={l} className="flex flex-wrap items-center gap-3">
              <span className="w-28"><ReliabilityBadge level={l} /></span>
              <span className="text-slate">{CONFIDENCE_TEXT[l].split(": ")[1]}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-6 border-t border-line pt-6 text-sm text-slate">
        Changes over 1 day to 1 year are only shown when a price exists at both the start and the end of the period, so new
        products never jump from zero. When the calculation is improved, the full history is recalculated with the new rules.
      </p>
    </article>
  );
}
