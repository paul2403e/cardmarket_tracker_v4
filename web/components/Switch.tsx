"use client";

export function Switch({ label, checked, onChange, hint }: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={hint}
      onClick={() => onChange(!checked)}
      className="group inline-flex items-center gap-2 rounded-[var(--radius-control)] py-1 pl-1 pr-3 text-sm text-ink hover:bg-cobalt-soft"
    >
      <span
        className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-cobalt" : "bg-line"}`}
        aria-hidden
      >
        <span
          className={`absolute left-0 top-0.5 block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
            checked ? "translate-x-[18px]" : "translate-x-0.5"
          }`}
        />
      </span>
      {label}
    </button>
  );
}
