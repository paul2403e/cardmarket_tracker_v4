"use client";

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="no-scrollbar inline-flex max-w-full overflow-x-auto overflow-y-hidden rounded-[var(--radius-control)] bg-surface p-0.5 ring-1 ring-line">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`num shrink-0 whitespace-nowrap rounded-[var(--radius-control)] px-3 py-1 text-sm ${
            value === o.value ? "bg-ink text-white" : "text-slate hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
