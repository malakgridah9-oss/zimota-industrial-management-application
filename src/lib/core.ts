import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, counters, settings, stockMovements, exceptionRequests } from "@/db/schema";
import type { CurrentUser } from "./auth";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbLike = typeof db | Tx;

/* ---------- numbering (never reused) ---------- */
export async function nextNo(tx: DbLike, prefix: string) {
  const year = new Date().getFullYear();
  const id = `${prefix}-${year}`;
  const res = await tx
    .insert(counters)
    .values({ id, value: 1 })
    .onConflictDoUpdate({ target: counters.id, set: { value: sql`${counters.value} + 1` } })
    .returning({ value: counters.value });
  return `${prefix}-${year}-${String(res[0].value).padStart(4, "0")}`;
}

/* ---------- audit ---------- */
export async function audit(
  tx: DbLike,
  user: CurrentUser | null,
  docType: string,
  docNo: string | null,
  action: string,
  opts: { old?: unknown; new?: unknown; reason?: string | null } = {},
) {
  const s = (v: unknown) => (v === undefined || v === null ? null : typeof v === "string" ? v : JSON.stringify(v));
  await tx.insert(auditLog).values({
    userId: user?.id ?? null,
    userName: user?.fullName ?? "Système",
    docType,
    docNo,
    action,
    oldValue: s(opts.old),
    newValue: s(opts.new),
    reason: opts.reason ?? null,
  });
}

/* ---------- settings ---------- */
export const DEFAULT_SETTINGS: Record<string, string> = {
  bc_threshold: "100",
  low_stock_default: "20",
  max_prod_inspection_hours: "48",
  date_format: "dd/MM/yyyy",
  session_hours: "8",
  max_file_mb: "10",
  allowed_ext: "pdf,jpg,jpeg,png,xlsx,docx",
  vin_tracking: "1",
  company_name: "Groupe ZIMOTA",
  company_address: "Zone industrielle – Tunisie",
};

export async function getSetting(key: string): Promise<string> {
  const r = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return r[0]?.value ?? DEFAULT_SETTINGS[key] ?? "";
}
export async function getSettings(): Promise<Record<string, string>> {
  const r = await db.select().from(settings);
  const out = { ...DEFAULT_SETTINGS };
  for (const s of r) out[s.key] = s.value;
  return out;
}

/* ---------- stock ---------- */
export type Store = "COMP" | "PROD" | "PF";

export async function lockStock(tx: Tx, store: string, model: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${store + ":" + model}))`);
}

export async function balance(tx: DbLike, store: string, model: string, state = "DISPONIBLE") {
  const r = await tx
    .select({ q: sql<number>`coalesce(sum(${stockMovements.qty}),0)::int` })
    .from(stockMovements)
    .where(and(eq(stockMovements.store, store), eq(stockMovements.model, model), eq(stockMovements.state, state)));
  return Number(r[0]?.q ?? 0);
}

export async function reservedComp(tx: DbLike, model: string) {
  const r = await tx.execute(sql`select coalesce(sum(qty),0)::int as q from exit_slips where model=${model} and status='Émis'`);
  return Number((r.rows[0] as { q: number } | undefined)?.q ?? 0);
}
export async function reservedPf(tx: DbLike, model: string) {
  const r = await tx.execute(sql`select coalesce(sum(qty),0)::int as q from deliveries where model=${model} and reserved=true and bl_no is null and status not in ('Annulée')`);
  return Number((r.rows[0] as { q: number } | undefined)?.q ?? 0);
}

export async function move(
  tx: Tx,
  m: { store: Store; state?: string; model: string; qty: number; sourceType: string; sourceNo: string; idemKey: string; userId: number; location?: string | null; vin?: string | null; allowNegative?: boolean },
) {
  if (m.qty === 0) return;
  const state = m.state ?? "DISPONIBLE";
  await lockStock(tx, m.store, m.model);
  if (m.qty < 0 && !m.allowNegative) {
    const b = await balance(tx, m.store, m.model, state);
    if (b + m.qty < 0) throw new Error(`Stock ${m.store} insuffisant pour ${m.model} (${state}) : disponible ${b}, demandé ${-m.qty}.`);
  }
  const ins = await tx
    .insert(stockMovements)
    .values({ store: m.store, state, model: m.model, qty: m.qty, sourceType: m.sourceType, sourceNo: m.sourceNo, idemKey: m.idemKey, userId: m.userId, location: m.location ?? null, vin: m.vin ?? null })
    .onConflictDoNothing({ target: stockMovements.idemKey })
    .returning({ id: stockMovements.id });
  if (!ins.length) throw new Error("Ce mouvement a déjà été enregistré (double validation bloquée).");
}

/** Consume an approved exception (returns true if one exists for the reference). */
export async function useException(tx: Tx, docRef: string) {
  const r = await tx
    .update(exceptionRequests)
    .set({ usedAt: new Date() })
    .where(and(eq(exceptionRequests.docRef, docRef), eq(exceptionRequests.status, "Approuvée"), sql`${exceptionRequests.usedAt} is null`))
    .returning({ id: exceptionRequests.id });
  return r.length > 0;
}

/* ---------- form helpers ---------- */
export function str(fd: FormData, k: string, label?: string): string {
  const v = String(fd.get(k) ?? "").trim();
  if (label && !v) throw new Error(`Le champ « ${label} » est obligatoire.`);
  return v;
}
export function opt(fd: FormData, k: string): string | null {
  const v = String(fd.get(k) ?? "").trim();
  return v ? v : null;
}
export function num(fd: FormData, k: string, label?: string, min = 0): number {
  const raw = String(fd.get(k) ?? "").trim().replace(",", ".");
  if (!raw) {
    if (label) throw new Error(`Le champ « ${label} » est obligatoire.`);
    return 0;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Valeur numérique invalide pour « ${label ?? k} ».`);
  if (n < min) throw new Error(`« ${label ?? k} » doit être ≥ ${min}.`);
  return n;
}
export function int(fd: FormData, k: string, label?: string, min = 0): number {
  const n = num(fd, k, label, min);
  if (!Number.isInteger(n)) throw new Error(`« ${label ?? k} » doit être un nombre entier.`);
  return n;
}
export function id(fd: FormData, k = "id"): number {
  const n = Number(fd.get(k));
  if (!Number.isInteger(n) || n <= 0) throw new Error("Référence invalide.");
  return n;
}

function withParams(path: string, params: Record<string, string>) {
  const [base, q = ""] = path.split("?");
  const sp = new URLSearchParams(q);
  sp.delete("ok");
  sp.delete("err");
  for (const [k, v] of Object.entries(params)) sp.set(k, v);
  const s = sp.toString();
  return s ? `${base}?${s}` : base;
}

function errMessage(e: unknown): string {
  const c = (e as { cause?: { code?: string; message?: string } })?.cause;
  const code = c?.code ?? (e as { code?: string })?.code;
  if (code === "23505") return "Doublon détecté : cette opération ou cette référence existe déjà.";
  if (e instanceof Error) return e.message.length > 300 ? "Erreur serveur." : e.message;
  return "Erreur inattendue.";
}

/** Wrap a server action: runs fn, then redirects back with ok/err message. */
export async function act(fd: FormData, fn: () => Promise<string | { msg: string; to?: string }>) {
  const back = String(fd.get("_back") ?? "/") || "/";
  let target: string;
  try {
    const r = await fn();
    const m = typeof r === "string" ? { msg: r } : r;
    target = withParams(m.to ?? back, { ok: m.msg });
  } catch (e) {
    unstable_rethrow(e);
    target = withParams(back, { err: errMessage(e) });
  }
  revalidatePath("/", "layout");
  redirect(target);
}

/* ---------- formatting ---------- */
export const tnd = (n: number | null | undefined) =>
  (Number(n ?? 0)).toLocaleString("fr-TN", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + " DT";
export const fdate = (d: Date | string | null | undefined) => {
  if (!d) return "—";
  const x = typeof d === "string" ? new Date(d) : d;
  if (isNaN(x.getTime())) return String(d);
  return x.toLocaleDateString("fr-FR");
};
export const fdt = (d: Date | string | null | undefined) => {
  if (!d) return "—";
  const x = typeof d === "string" ? new Date(d) : d;
  return x.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
};
export const today = () => new Date().toISOString().slice(0, 10);
