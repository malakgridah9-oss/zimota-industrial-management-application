import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { Logo, inputCls } from "@/components/ui";
import { Submit } from "@/components/client";
import { createSession, getUser, verifyPassword } from "@/lib/auth";
import { audit, getSetting } from "@/lib/core";
import { DEMO_ACCOUNTS, ensureSeed } from "@/lib/seed";
import { ROLES } from "@/lib/perms";

export const dynamic = "force-dynamic";

async function login(fd: FormData) {
  "use server";
  await ensureSeed();
  const username = String(fd.get("username") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const u = (await db.select().from(users).where(eq(users.username, username)).limit(1))[0];
  if (!u || !verifyPassword(password, u.passwordHash)) redirect("/login?err=Identifiant ou mot de passe incorrect");
  if (!u.active) redirect("/login?err=Compte désactivé");
  const hours = Number(await getSetting("session_hours")) || 8;
  await createSession(u.id, hours);
  await audit(db, u, "SESSION", null, "Connexion");
  redirect("/");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await ensureSeed();
  if (await getUser()) redirect("/");
  const sp = await searchParams;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-slate-100 via-white to-red-50 p-4">
      <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
          <div className="mb-6 flex flex-col items-center">
            <Logo className="h-32" />
            <p className="mt-2 text-sm text-slate-500">Application intégrée de gestion industrielle</p>
          </div>
          {sp.err && <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">⚠ {sp.err}</div>}
          <form action={login} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Identifiant</span>
              <input name="username" required autoComplete="username" defaultValue={sp.u ?? ""} className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Mot de passe</span>
              <input name="password" type="password" required autoComplete="current-password" defaultValue={sp.p ?? ""} className={inputCls} />
            </label>
            <div className="pt-2 [&>button]:w-full">
              <Submit>Se connecter</Submit>
            </div>
          </form>
          <p className="mt-6 text-center text-xs text-slate-400">© {new Date().getFullYear()} Groupe ZIMOTA – Accès réservé au personnel autorisé</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
          <h2 className="mb-1 font-semibold text-slate-800">Comptes de démonstration</h2>
          <p className="mb-3 text-xs text-slate-500">Cliquez sur « Connexion directe » pour ouvrir l&apos;espace de chaque profil.</p>
          <div className="max-h-[520px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="py-1">Profil</th><th>Login</th><th>Mot de passe</th><th></th>
                </tr>
              </thead>
              <tbody>
                {DEMO_ACCOUNTS.map((a) => (
                  <tr key={a.username} className="border-b border-slate-100">
                    <td className="py-1.5 pr-2">{ROLES[a.role]}</td>
                    <td className="font-mono">{a.username}</td>
                    <td className="font-mono">{a.password}</td>
                    <td className="text-right">
                      <form action={login}>
                        <input type="hidden" name="username" value={a.username} />
                        <input type="hidden" name="password" value={a.password} />
                        <button className="rounded bg-red-700 px-2 py-1 font-semibold text-white hover:bg-red-800">Connexion directe</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
