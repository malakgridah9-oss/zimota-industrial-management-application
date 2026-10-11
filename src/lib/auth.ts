import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { can } from "./perms";

export const COOKIE = "zimota_sid";

export function hashPassword(pw: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(pw: string, stored: string) {
  const [, salt, hash] = stored.split("$");
  if (!salt || !hash) return false;
  const h = scryptSync(pw, salt, 64);
  const s = Buffer.from(hash, "hex");
  return s.length === h.length && timingSafeEqual(h, s);
}

export type CurrentUser = typeof users.$inferSelect;

export async function getUser(): Promise<CurrentUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const rows = await db
    .select({ u: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const u = rows[0]?.u;
  if (!u || !u.active) return null;
  return u;
}

export async function requireUser(): Promise<CurrentUser> {
  const u = await getUser();
  if (!u) redirect("/login");
  return u;
}

/** For server actions: throws a readable error if not permitted. */
export async function requirePerm(...perms: string[]): Promise<CurrentUser> {
  const u = await getUser();
  if (!u) throw new Error("Session expirée, veuillez vous reconnecter.");
  if (perms.length && !perms.some((p) => can(u.role, p))) {
    throw new Error("Action non autorisée pour votre profil.");
  }
  return u;
}

export async function createSession(userId: number, hours: number) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + hours * 3600_000);
  await db.insert(sessions).values({ token, userId, expiresAt });
  const jar = await cookies();
  jar.set(COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", expires: expiresAt, secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE === "1" });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.token, token));
  jar.delete(COOKIE);
}
