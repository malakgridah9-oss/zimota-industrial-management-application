import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui";
import { destroySession, requireUser } from "@/lib/auth";
import { MENU, ROLES, canSeeMenu } from "@/lib/perms";
import { getTasks } from "@/lib/tasks";

export const dynamic = "force-dynamic";

async function logout() {
  "use server";
  await destroySession();
  redirect("/login");
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const u = await requireUser();
  const tasks = await getTasks(u);
  const total = tasks.reduce((s, t) => s + t.count, 0);
  const menu = MENU.filter((m) => canSeeMenu(u.role, m));
  return (
    <div className="min-h-screen">
      <input id="nav" type="checkbox" className="peer hidden" />
      <aside className="no-print fixed inset-y-0 left-0 z-40 flex w-64 -translate-x-full flex-col border-r border-slate-200 bg-white transition peer-checked:translate-x-0 lg:translate-x-0">
        <div className="flex items-center justify-center border-b border-slate-100 py-4">
          <Link href="/"><Logo className="h-20" /></Link>
        </div>
        <nav className="flex-1 overflow-y-auto p-3">
          {menu.map((m) => (
            <Link key={m.href} href={m.href} className="mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-red-50 hover:text-red-700">
              <span className="w-5 text-center">{m.icon}</span>
              {m.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-slate-100 p-3 text-xs text-slate-500">
          <div className="font-semibold text-slate-800">{u.fullName}</div>
          <div>{ROLES[u.role] ?? u.role}</div>
          <form action={logout} className="mt-2">
            <button className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50">Se déconnecter</button>
          </form>
        </div>
      </aside>
      <label htmlFor="nav" className="fixed inset-0 z-30 hidden bg-black/30 peer-checked:block lg:hidden" />
      <div className="lg:pl-64">
        <header className="no-print sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur">
          <label htmlFor="nav" className="cursor-pointer rounded-lg border px-2.5 py-1 text-lg lg:hidden">☰</label>
          <form action="/rapports" method="get" className="flex-1">
            <input type="hidden" name="tab" value="search" />
            <input name="q" placeholder="Recherche transversale : n° document, modèle, VIN, client, fournisseur…" className="w-full max-w-xl rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm focus:border-red-600 focus:outline-none" />
          </form>
          <details className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm">
              🔔 {total > 0 && <span className="rounded-full bg-red-600 px-1.5 text-xs font-bold text-white">{total}</span>}
            </summary>
            <div className="absolute right-0 mt-2 w-80 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
              {tasks.length === 0 && <p className="p-3 text-sm text-slate-500">Aucune tâche en attente.</p>}
              {tasks.map((t) => (
                <Link key={t.label} href={t.href} className="flex justify-between rounded-lg px-3 py-2 text-sm hover:bg-slate-50">
                  <span>{t.label}</span>
                  <span className="font-bold text-red-700">{t.count}</span>
                </Link>
              ))}
            </div>
          </details>
          <div className="hidden text-right text-xs sm:block">
            <div className="font-semibold">{u.fullName}</div>
            <div className="text-slate-500">{ROLES[u.role]}</div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
