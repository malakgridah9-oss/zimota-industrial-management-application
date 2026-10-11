import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, verifyPassword } from "@/lib/auth";
import { audit } from "@/lib/core";
import { DEMO_ACCOUNTS, ensureSeed } from "@/lib/seed";

export const dynamic = "force-dynamic";

/** Direct login link for demo accounts: /connexion/<login>. Stops working once the password is changed. */
export async function GET(req: Request, ctx: { params: Promise<{ user: string }> }) {
  await ensureSeed();
  const { user } = await ctx.params;
  const base = new URL(req.url);
  const demo = DEMO_ACCOUNTS.find((a) => a.username === user.toLowerCase());
  const u = demo ? (await db.select().from(users).where(eq(users.username, demo.username)).limit(1))[0] : undefined;
  if (!demo || !u || !u.active || !verifyPassword(demo.password, u.passwordHash)) {
    return NextResponse.redirect(new URL("/login?err=Lien de connexion directe invalide ou désactivé", base));
  }
  await createSession(u.id, 8);
  await audit(db, u, "SESSION", null, "Connexion (lien direct)");
  return NextResponse.redirect(new URL("/", base));
}
