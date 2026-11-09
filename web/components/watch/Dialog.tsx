"use client";

// Dialog-Rahmen (direkt an <body>, Escape und Klick daneben schließen) und Bestätigung per Gedrückthalten.
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HoldButton } from "@/components/HoldButton";

export function Dialog({ title, onClose, children, width = "max-w-lg" }: {
  title: string; onClose: () => void; children: ReactNode; width?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-50 flex overflow-y-auto bg-ink/40 p-4 text-left"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className={`m-auto w-full ${width} rounded-[var(--radius-panel)] bg-surface p-6 shadow-2xl`}>
        <div className="flex items-center justify-between gap-4">
          <h2 className="display text-2xl">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-2xl leading-none text-slate hover:text-ink">×</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function HoldConfirm({ title, text, action, onConfirm, onClose }: {
  title: string; text: ReactNode; action: string; onConfirm: () => Promise<void>; onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  async function go() {
    try {
      await onConfirm();
      onClose();
    } catch {
      setError("Could not delete. Please try again.");
    }
  }
  return (
    <Dialog title={title} onClose={onClose} width="max-w-md">
      <div className="mt-3 text-sm text-slate">{text}</div>
      {error && <p role="alert" className="mt-3 text-sm text-down">{error}</p>}
      <div className="mt-5 flex flex-col gap-2">
        <HoldButton onConfirm={go}>{action}</HoldButton>
        <button type="button" onClick={onClose} className="h-10 rounded-[var(--radius-control)] ring-1 ring-line">Cancel</button>
      </div>
    </Dialog>
  );
}
