"use server";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { exceptionRequests, motoModels, sessions, settings, suppliers, users } from "@/db/schema";
import { hashPassword, requirePerm } from "@/lib/auth";
import { act, audit, DEFAULT_SETTINGS, id, int, nextNo, opt, str } from "@/lib/core";
import { ROLES } from "@/lib/perms";

export async function createUser(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("admin.manage");
    const role = str(fd, "role", "Rôle");
    if (!ROLES[role]) throw new Error("Rôle invalide.");
    const pw = str(fd, "password", "Mot de passe provisoire");
    if (pw.length < 8) throw new Error("Mot de passe : 8 caractères minimum.");
    const username = str(fd, "username", "Identifiant").toLowerCase();
    await db.insert(users).values({ username, passwordHash: hashPassword(pw), fullName: str(fd, "fullName", "Nom complet"), email: opt(fd, "email"), phone: opt(fd, "phone"), role, service: opt(fd, "service") });
    await audit(db, u, "USER", username, "Compte créé", { new: { role } });
    return `Compte ${username} créé.`;
  });
}

export async function userAction(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("admin.manage");
    const t = (await db.select().from(users).where(eq(users.id, id(fd))))[0];
    const step = str(fd, "step");
    if (step === "toggle") {
      if (t.active && t.role === "ADMIN") {
        const others = await db.select({ n: sql<number>`count(*)::int` }).from(users).where(and(eq(users.role, "ADMIN"), eq(users.active, true), ne(users.id, t.id)));
        if (Number(others[0].n) === 0) throw new Error("Impossible : ce compte est le seul accès d'administration actif.");
      }
      await db.update(users).set({ active: !t.active }).where(eq(users.id, t.id));
      if (t.active) await db.delete(sessions).where(eq(sessions.userId, t.id));
      await audit(db, u, "USER", t.username, t.active ? "Compte désactivé" : "Compte réactivé");
      return `${t.username} ${t.active ? "désactivé" : "réactivé"}.`;
    }
    if (step === "reset") {
      const pw = str(fd, "password", "Nouveau mot de passe");
      if (pw.length < 8) throw new Error("8 caractères minimum.");
      await db.update(users).set({ passwordHash: hashPassword(pw) }).where(eq(users.id, t.id));
      await db.delete(sessions).where(eq(sessions.userId, t.id));
      await audit(db, u, "USER", t.username, "Mot de passe réinitialisé");
      return `Mot de passe de ${t.username} réinitialisé.`;
    }
    if (step === "role") {
      const role = str(fd, "role");
      if (!ROLES[role]) throw new Error("Rôle invalide.");
      if (t.role === "ADMIN" && role !== "ADMIN") {
        const others = await db.select({ n: sql<number>`count(*)::int` }).from(users).where(and(eq(users.role, "ADMIN"), eq(users.active, true), ne(users.id, t.id)));
        if (Number(others[0].n) === 0) throw new Error("Impossible : dernier administrateur actif.");
      }
      await db.update(users).set({ role, service: opt(fd, "service") ?? t.service }).where(eq(users.id, t.id));
      await audit(db, u, "USER", t.username, "Rôle modifié", { old: t.role, new: role });
      return `Rôle de ${t.username} mis à jour.`;
    }
    throw new Error("Action inconnue.");
  });
}

export async function saveSettings(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("admin.manage");
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      const v = fd.get(k);
      if (v === null) continue;
      const val = String(v).trim();
      await db.insert(settings).values({ key: k, value: val }).onConflictDoUpdate({ target: settings.key, set: { value: val } });
    }
    await audit(db, u, "PARAM", null, "Paramètres modifiés", { new: Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((k) => [k, String(fd.get(k) ?? "")])) });
    return "Paramètres enregistrés.";
  });
}

export async function modelAction(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("admin.manage");
    const step = str(fd, "step");
    if (step === "add") {
      const code = str(fd, "code", "Code modèle").toUpperCase();
      await db.insert(motoModels).values({ code, lowStock: int(fd, "lowStock") || 20, dailyTarget: int(fd, "dailyTarget") || 10 });
      await audit(db, u, "MODELE", code, "Modèle ajouté");
      return `Modèle ${code} ajouté.`;
    }
    const m = (await db.select().from(motoModels).where(eq(motoModels.id, id(fd))))[0];
    if (step === "toggle") {
      await db.update(motoModels).set({ active: !m.active }).where(eq(motoModels.id, m.id));
      await audit(db, u, "MODELE", m.code, m.active ? "Désactivé" : "Activé");
      return `${m.code} ${m.active ? "désactivé" : "activé"}.`;
    }
    const vals = { lowStock: int(fd, "lowStock"), dailyTarget: int(fd, "dailyTarget") };
    await db.update(motoModels).set(vals).where(eq(motoModels.id, m.id));
    await audit(db, u, "MODELE", m.code, "Paramètres modifiés", { old: { lowStock: m.lowStock, dailyTarget: m.dailyTarget }, new: vals });
    return `${m.code} mis à jour.`;
  });
}

export async function addSupplier(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("admin.manage");
    const name = str(fd, "name", "Nom");
    await db.insert(suppliers).values({ name, kind: str(fd, "kind") || "LOCAL", country: opt(fd, "country"), contact: opt(fd, "contact") });
    await audit(db, u, "FOURNISSEUR", name, "Fournisseur ajouté");
    return `Fournisseur ${name} ajouté.`;
  });
}

export async function requestException(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("exc.request", "admin.manage");
    return await db.transaction(async (tx) => {
      const no = await nextNo(tx, "EXC");
      await tx.insert(exceptionRequests).values({ no, kind: str(fd, "kind", "Type"), docRef: str(fd, "docRef", "Référence du document (ex. BC-2026-0001, LST-2026-0001)").toUpperCase(), description: str(fd, "description", "Description"), justification: str(fd, "justification", "Justification"), requestedBy: u.id });
      await audit(tx, u, "EXC", no, "Autorisation exceptionnelle demandée");
      return `${no} soumise au décideur habilité.`;
    });
  });
}

export async function decideException(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("exc.decide");
    const e = (await db.select().from(exceptionRequests).where(eq(exceptionRequests.id, id(fd))))[0];
    if (e.requestedBy === u.id) throw new Error("Vous ne pouvez pas approuver votre propre demande.");
    const decision = str(fd, "decision");
    const comment = opt(fd, "comment");
    if (decision === "reject" && !comment) throw new Error("Motif obligatoire.");
    const status = decision === "approve" ? "Approuvée" : "Refusée";
    const r = await db.update(exceptionRequests).set({ status, decidedBy: u.id, decisionComment: comment }).where(and(eq(exceptionRequests.id, e.id), eq(exceptionRequests.status, "À valider"))).returning();
    if (!r.length) throw new Error("Déjà décidée.");
    await audit(db, u, "EXC", e.no, status, { reason: comment });
    return `${e.no} ${status.toLowerCase()}.`;
  });
}
