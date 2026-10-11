"use client";
import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

const variants: Record<string, string> = {
  primary: "bg-red-700 text-white hover:bg-red-800",
  success: "bg-emerald-600 text-white hover:bg-emerald-700",
  danger: "bg-white text-red-700 border border-red-300 hover:bg-red-50",
  secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50",
  dark: "bg-slate-900 text-white hover:bg-black",
};

/** Submit button that disables itself while pending (prevents double submission) and can ask for confirmation with a summary. */
export function Submit({
  children, confirm, variant = "primary", name, value, small, formAction,
}: {
  children: ReactNode; confirm?: string; variant?: keyof typeof variants | string; name?: string; value?: string; small?: boolean;
  formAction?: (fd: FormData) => void | Promise<void>;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      formAction={formAction}
      disabled={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className={`inline-flex items-center justify-center gap-1 rounded-lg font-semibold shadow-sm transition disabled:cursor-wait disabled:opacity-60 ${small ? "px-2.5 py-1 text-xs" : "px-4 py-2 text-sm"} ${variants[variant] ?? variants.primary}`}
    >
      {pending ? "Traitement…" : children}
    </button>
  );
}

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="no-print rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white">
      🖨 Imprimer / PDF
    </button>
  );
}
