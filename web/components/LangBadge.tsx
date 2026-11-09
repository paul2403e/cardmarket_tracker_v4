// Sprach-Kennzeichnung in Listen: kleine Flagge + Kürzel (EN = UK-Flagge wie bei Cardmarket).
// Flaggen als Grafik, weil Windows Flaggen-Emojis nur als Buchstaben zeigt.
import { LANG_LABEL, LANG_SHORT } from "@/lib/format";
import type { Lang } from "@/lib/types";

function Flag({ lang }: { lang: Lang }) {
  const common = { width: 20, height: 14, "aria-hidden": true, className: "shrink-0 rounded-[2px] ring-1 ring-line" };
  if (lang === "de") {
    return (
      <svg {...common} viewBox="0 0 5 3" preserveAspectRatio="none">
        <rect width="5" height="1" y="0" fill="#000000" />
        <rect width="5" height="1" y="1" fill="#DD0000" />
        <rect width="5" height="1" y="2" fill="#FFCE00" />
      </svg>
    );
  }
  if (lang === "ja") {
    return (
      <svg {...common} viewBox="0 0 30 20">
        <rect width="30" height="20" fill="#ffffff" />
        <circle cx="15" cy="10" r="6" fill="#BC002D" />
      </svg>
    );
  }
  return (
    <svg {...common} viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice">
      <clipPath id="uk-flag-t">
        <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
      </clipPath>
      <rect width="60" height="30" fill="#012169" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#ffffff" strokeWidth="6" />
      <path d="M0,0 L60,30 M60,0 L0,30" clipPath="url(#uk-flag-t)" stroke="#C8102E" strokeWidth="4" />
      <path d="M30,0 v30 M0,15 h60" stroke="#ffffff" strokeWidth="10" />
      <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
    </svg>
  );
}

export function LangBadge({ lang }: { lang: Lang }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={LANG_LABEL[lang]}>
      <span className="rounded bg-paper px-1.5 font-semibold text-ink ring-1 ring-line">{LANG_SHORT[lang]}</span>
      <Flag lang={lang} />
    </span>
  );
}
