import Link from "next/link";
import type { ReactNode } from "react";

export const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-red-600 focus:outline-none focus:ring-2 focus:ring-red-100 disabled:bg-slate-100";

export function Logo({ className = "h-10" }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo.svg" alt="ZIMOTA" className={className} />;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Flash({ sp }: { sp: Record<string, string | undefined> }) {
  if (sp.ok)
    return <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">✓ {sp.ok}</div>;
  if (sp.err)
    return <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">⚠ {sp.err}</div>;
  return null;
}

export function Card({ title, children, actions, className = "" }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`mb-5 rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="font-semibold text-slate-800">{title}</h2>
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const tones: Record<string, string> = {
  red: "border-l-red-600",
  amber: "border-l-amber-500",
  green: "border-l-emerald-600",
  blue: "border-l-sky-600",
  slate: "border-l-slate-400",
};

export function Stat({ label, value, href, tone = "slate", hint }: { label: string; value: ReactNode; href?: string; tone?: string; hint?: string }) {
  const inner = (
    <div className={`h-full rounded-xl border border-l-4 border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md ${tones[tone] ?? tones.slate}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{children}</div>;
}

function badgeColor(s: string) {
  const x = s.toLowerCase();
  if (/(refus|rejet|annul|incident|anomalie|non conforme|écart|rupture|bloqu|quarantaine)/.test(x)) return "bg-red-50 text-red-700 ring-red-200";
  if (/brouillon/.test(x)) return "bg-slate-100 text-slate-600 ring-slate-200";
  if (/(émis|bl généré|expédi|transmis|en cours|planifi|diagnostic|réparation)/.test(x)) return "bg-sky-50 text-sky-700 ring-sky-200";
  if (/(attente|à valider|soumise|partiel|à préparer|revalider|examiner|nouveau|corriger|à inspecter|ouverte|vérification|non affect|non justifi|prête|réservée|préparée)/.test(x)) return "bg-amber-50 text-amber-800 ring-amber-200";
  if (/(valid|conforme|clôtur|livr|accept|approuv|réceptionn|régularis|résolu|comptabilis|payée|prêt|affecté|entièrement|terminé|disponible|restitu)/.test(x)) return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  return "bg-slate-100 text-slate-700 ring-slate-200";
}

export function Badge({ s }: { s: string | null | undefined }) {
  if (!s) return <span className="text-slate-400">—</span>;
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${badgeColor(s)}`}>{s}</span>;
}

export function Table({ cols, rows, empty = "Aucun élément." }: { cols: ReactNode[]; rows: ReactNode[][]; empty?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            {cols.map((c, i) => (
              <th key={i} className="whitespace-nowrap px-3 py-2 font-semibold">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={cols.length} className="px-3 py-6 text-center text-slate-400">{empty}</td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-100 align-top hover:bg-red-50/30">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Tabs({ base, tabs, active }: { base: string; tabs: { key: string; label: string; count?: number }[]; active: string }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={`${base}?tab=${t.key}`}
          className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${active === t.key ? "border-red-600 text-red-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          {t.label}
          {t.count ? <span className="ml-1.5 rounded-full bg-red-600 px-1.5 text-xs text-white">{t.count}</span> : null}
        </Link>
      ))}
    </div>
  );
}

export function Field({ label, required, children, className = "" }: { label: string; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-slate-600">
        {label} {required && <span className="text-red-600">*</span>}
      </span>
      {children}
    </label>
  );
}

export function Grid({ children, cols = 3 }: { children: ReactNode; cols?: number }) {
  const c = cols === 2 ? "md:grid-cols-2" : cols === 4 ? "md:grid-cols-4" : "md:grid-cols-3";
  return <div className={`grid grid-cols-1 gap-3 ${c}`}>{children}</div>;
}

export function Back({ to }: { to: string }) {
  return <input type="hidden" name="_back" value={to} />;
}

export function Extra({ children, title = "Informations complémentaires" }: { children: ReactNode; title?: string }) {
  return (
    <details className="mt-3 rounded-lg border border-dashed border-slate-300 p-3">
      <summary className="cursor-pointer text-sm font-medium text-slate-600">{title}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

export function Btn({ href, children, variant = "primary" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" }) {
  const cls = variant === "primary" ? "bg-red-700 text-white hover:bg-red-800" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50";
  return (
    <Link href={href} className={`inline-flex items-center gap-1 rounded-lg px-4 py-2 text-sm font-semibold shadow-sm ${cls}`}>
      {children}
    </Link>
  );
}

export function KV({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-slate-500">{k}</dt>
          <dd className="font-medium text-slate-800">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SearchBar({ base, tab, q, extra }: { base: string; tab?: string; q?: string; extra?: ReactNode }) {
  return (
    <form action={base} method="get" className="mb-3 flex flex-wrap gap-2">
      {tab && <input type="hidden" name="tab" value={tab} />}
      <input name="q" defaultValue={q} placeholder="Rechercher (n°, modèle, fournisseur, client…)" className={`${inputCls} max-w-sm`} />
      {extra}
      <button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">Filtrer</button>
    </form>
  );
}

export function paginate<T>(rows: T[], page: number, size = 20) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(1, page || 1), pages);
  return { items: rows.slice((p - 1) * size, p * size), page: p, pages };
}

export function Pager({ base, page, pages, params = {} }: { base: string; page: number; pages: number; params?: Record<string, string | undefined> }) {
  if (pages <= 1) return null;
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    sp.set("page", String(p));
    return `${base}?${sp.toString()}`;
  };
  return (
    <div className="mt-3 flex items-center gap-2 text-sm">
      {page > 1 && <Link className="rounded border px-2 py-1" href={href(page - 1)}>← Préc.</Link>}
      <span className="text-slate-500">Page {page} / {pages}</span>
      {page < pages && <Link className="rounded border px-2 py-1" href={href(page + 1)}>Suiv. →</Link>}
    </div>
  );
}

export function match(q: string | undefined, ...vals: (string | number | null | undefined)[]) {
  if (!q) return true;
  const s = q.toLowerCase();
  return vals.some((v) => v !== null && v !== undefined && String(v).toLowerCase().includes(s));
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">{children}</p>;
}
