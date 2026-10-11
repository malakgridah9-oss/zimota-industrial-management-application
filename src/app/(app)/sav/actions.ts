"use server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { savCases } from "@/db/schema";
import { requirePerm } from "@/lib/auth";
import { act, audit, id, int, nextNo, opt, str } from "@/lib/core";

export async function createSav(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("sav.manage");
    return await db.transaction(async (tx) => {
      const no = await nextNo(tx, "SAV");
      const r = await tx.insert(savCases).values({ no, client: str(fd, "client", "Client"), phone: opt(fd, "phone"), address: opt(fd, "address"), model: str(fd, "model", "Modèle"), vin: str(fd, "vin", "VIN / châssis").toUpperCase(), blNo: opt(fd, "blNo"), saleDate: opt(fd, "saleDate"), km: int(fd, "km", "Kilométrage"), priority: str(fd, "priority") || "Normale", description: str(fd, "description", "Description"), data: {}, createdBy: u.id }).returning({ id: savCases.id });
      await audit(tx, u, "SAV", no, "Dossier créé (Nouveau)");
      return { msg: `${no} créé.`, to: `/sav?id=${r[0].id}` };
    });
  });
}

const STEPS: Record<string, { fields: [string, string, boolean][]; from: string[]; to: (fd: FormData) => string }> = {
  reception: { fields: [["date", "Date de réception", true], ["km", "Kilométrage", true], ["accessoires", "Accessoires", false], ["etat", "État général", false], ["obs", "Observations", false]], from: ["Nouveau"], to: () => "Réceptionné" },
  diagnostic: { fields: [["defaut", "Défaut constaté", true], ["cause", "Cause possible", false], ["garantie", "Décision de garantie", true], ["technicien", "Technicien", true], ["devis", "Devis", false]], from: ["Réceptionné", "En diagnostic"], to: () => "En réparation" },
  repair: { fields: [["travaux", "Travaux réalisés", true], ["pieces", "Pièces utilisées", false], ["temps", "Temps passé (h)", false], ["debut", "Début", false], ["fin", "Fin", false]], from: ["En réparation"], to: () => "Contrôle final" },
  final: { fields: [["inspecteur", "Inspecteur", true], ["resultat", "Résultat", true], ["obs", "Observations", false]], from: ["Contrôle final"], to: (fd) => (String(fd.get("resultat")) === "Conforme" ? "Prêt à restituer" : "En réparation") },
  billing: { fields: [["montant", "Montant (DT)", false], ["facture", "N° facture", false], ["obs", "Observations", false]], from: ["Réceptionné", "En diagnostic", "En réparation", "Contrôle final", "Prêt à restituer", "Restitué"], to: () => "" },
  restitution: { fields: [["date", "Date de restitution", true], ["preuve", "Preuve de remise", true], ["recupere_par", "Récupéré par", false]], from: ["Prêt à restituer"], to: () => "Restitué" },
};

export async function savStep(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("sav.manage");
    const step = str(fd, "step");
    const s = (await db.select().from(savCases).where(eq(savCases.id, id(fd))))[0];
    if (!s || s.status === "Clôturé") throw new Error("Dossier clôturé.");
    if (step === "reject" || step === "close") {
      const reason = str(fd, "reason", "Motif");
      if (step === "close" && !["Restitué", "Prêt à restituer", "Rejeté"].includes(s.status)) throw new Error("Clôture possible uniquement si restitué, prêt à restituer ou rejeté avec motif.");
      const next = step === "reject" ? "Rejeté" : "Clôturé";
      await db.update(savCases).set({ status: next, closeReason: reason, closedAt: step === "close" ? new Date() : null }).where(eq(savCases.id, s.id));
      await audit(db, u, "SAV", s.no, next, { old: s.status, new: next, reason });
      return `${s.no} : ${next}.`;
    }
    const def = STEPS[step];
    if (!def) throw new Error("Étape inconnue.");
    if (!def.from.includes(s.status)) throw new Error(`Étape non disponible au statut « ${s.status} ».`);
    const values: Record<string, string> = {};
    for (const [k, label, req] of def.fields) values[k] = req ? str(fd, k, label) : (opt(fd, k) ?? "");
    const next = def.to(fd) || s.status;
    const data = { ...s.data, [step]: { ...values, par: u.fullName, le: new Date().toISOString() } };
    const prodDefect = step === "diagnostic" ? fd.get("productionDefect") === "on" : s.productionDefect;
    await db.update(savCases).set({ data, status: next, productionDefect: prodDefect, km: step === "reception" ? Number(values.km) || s.km : s.km }).where(eq(savCases.id, s.id));
    await audit(db, u, "SAV", s.no, `Étape ${step}`, { old: s.status, new: { status: next, ...values } });
    return `${s.no} : ${step} enregistré${next !== s.status ? ` → ${next}` : ""}.`;
  });
}
