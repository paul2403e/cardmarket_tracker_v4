import type { ReactNode } from "react";
import { legalComplete } from "@/lib/legal";

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article lang="de" className="mx-auto max-w-2xl py-4 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_p]:mt-3 [&_li]:mt-1 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
      <h1 className="display text-3xl">{title}</h1>
      {!legalComplete && (
        <p className="rounded-[var(--radius-control)] bg-warn-soft px-3 py-2 text-sm text-warn">
          Entwurf – die Angaben zum Betreiber werden noch ergänzt.
        </p>
      )}
      {children}
    </article>
  );
}
