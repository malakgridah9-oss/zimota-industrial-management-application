"use server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { claims, importFiles, packingLines, packingLists, receptions } from "@/db/schema";
import { requirePerm } from "@/lib/auth";
import { act, audit, id, int, move, nextNo, num, opt, str, useException } from "@/lib/core";

const EXTRA = ["devise", "incoterm", "paiement", "lc", "swift", "transport", "conteneur", "port_chargement", "port_dechargement", "etd", "eta", "bl", "ci", "certificat", "assurance", "douane"];

export async function createImport(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("imp.manage");
    const models = fd.getAll("models").map(String).filter(Boolean);
    if (!models.length) throw new Error("Sélectionnez au moins un modèle.");
    const extra: Record<string, string> = {};
    for (const k of EXTRA) { const v = opt(fd, k); if (v) extra[k] = v; }
    return await db.transaction(async (tx) => {
      const no = await nextNo(tx, "IMP");
      const r = await tx.insert(importFiles).values({ no, supplierId: id(fd, "supplierId"), piNumber: str(fd, "piNumber", "N° de commande PI"), piDate: str(fd, "piDate", "Date de la PI"), models, extra, fees: [], createdBy: u.id }).returning({ id: importFiles.id });
      await audit(tx, u, "IMP", no, "Dossier créé", { new: { models, extra } });
      return { msg: `${no} créé. Ajoutez maintenant les listes de colisage.`, to: `/import?id=${r[0].id}` };
    });
  });
}

export async function updateImportExtra(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("imp.manage");
    const f = (await db.select().from(importFiles).where(eq(importFiles.id, id(fd))))[0];
    if (f.status === "Clôturé") throw new Error("Dossier clôturé.");
    const reason = f.status === "Validé" ? str(fd, "reason", "Motif d'ajustement (dossier validé)") : opt(fd, "reason");
    const extra: Record<string, string> = {};
    for (const k of EXTRA) { const v = opt(fd, k); if (v) extra[k] = v; }
    await db.update(importFiles).set({ extra }).where(eq(importFiles.id, f.id));
    await audit(db, u, "IMP", f.no, f.status === "Validé" ? "Ajustement motivé des informations logistiques" : "Informations complémentaires mises à jour", { old: f.extra, new: extra, reason });
    return "Informations enregistrées.";
  });
}

export async function addFee(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("imp.manage");
    const f = (await db.select().from(importFiles).where(eq(importFiles.id, id(fd))))[0];
    if (f.status === "Clôturé") throw new Error("Dossier clôturé.");
    const fee = { label: str(fd, "label", "Libellé du frais"), amount: num(fd, "amount", "Montant", 0.001) };
    await db.update(importFiles).set({ fees: [...f.fees, fee] }).where(eq(importFiles.id, f.id));
    await audit(db, u, "IMP", f.no, "Frais enregistré", { new: fee });
    return "Frais ajouté.";
  });
}

export async function addPackingList(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("imp.manage");
    const f = (await db.select().from(importFiles).where(eq(importFiles.id, id(fd))))[0];
    if (!["Brouillon", "À valider", "Validé"].includes(f.status)) throw new Error("Dossier non modifiable.");
    const lines: { model: string; plannedQty: number }[] = [];
    for (let i = 0; i < 8; i++) {
      const m = str(fd, `model_${i}`);
      if (!m) continue;
      if (lines.some((l) => l.model === m)) throw new Error(`Le modèle ${m} est dupliqué dans la liste.`);
      lines.push({ model: m, plannedQty: int(fd, `qty_${i}`, `Quantité ${m}`, 1) });
    }
    if (!lines.length) throw new Error("Ajoutez au moins un modèle avec sa quantité.");
    return await db.transaction(async (tx) => {
      const no = await nextNo(tx, "LST");
      const r = await tx.insert(packingLists).values({ no, importId: f.id, status: "À valider" }).returning({ id: packingLists.id });
      await tx.insert(packingLines).values(lines.map((l) => ({ ...l, listId: r[0].id })));
      if (f.status === "Validé") await tx.update(importFiles).set({ status: "À valider" }).where(eq(importFiles.id, f.id));
      await audit(tx, u, "LST", no, `Liste créée (dossier ${f.no}) et soumise à validation`, { new: lines });
      await audit(tx, u, "IMP", f.no, `Liste ${no} ajoutée`, { new: lines });
      return `${no} créée et soumise au Directeur approvisionnement.`;
    });
  });
}

export async function decideList(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("imp.validate");
    const l = (await db.select().from(packingLists).where(eq(packingLists.id, id(fd))))[0];
    const decision = str(fd, "decision");
    const reason = opt(fd, "reason");
    if (decision === "reject" && !reason) throw new Error("Motif obligatoire pour refuser.");
    const status = decision === "validate" ? "Validée" : "Refusée";
    const r = await db.update(packingLists).set({ status, validatedBy: u.id }).where(and(eq(packingLists.id, l.id), eq(packingLists.status, "À valider"))).returning();
    if (!r.length) throw new Error("Liste déjà traitée.");
    await audit(db, u, "LST", l.no, status, { old: "À valider", new: status, reason });
    return `${l.no} : ${status}.`;
  });
}

export async function decideImport(fd: FormData) {
  await act(fd, async () => {
    const step = str(fd, "step");
    const u = await requirePerm(step === "submit" ? "imp.manage" : "imp.validate");
    const f = (await db.select().from(importFiles).where(eq(importFiles.id, id(fd))))[0];
    const lists = await db.select().from(packingLists).where(eq(packingLists.importId, f.id));
    const active = lists.filter((l) => l.status !== "Refusée");
    const reason = opt(fd, "reason");
    let next: string;
    if (step === "submit") {
      if (f.status !== "Brouillon") throw new Error("Déjà soumis.");
      if (!active.length) throw new Error("Ajoutez au moins une liste de colisage.");
      next = "À valider";
    } else if (step === "validate") {
      if (f.status !== "À valider") throw new Error("Dossier non soumis à validation.");
      if (!active.length || active.some((l) => l.status !== "Validée")) throw new Error("Toutes les listes de colisage doivent être validées avant le dossier.");
      next = "Validé";
    } else if (step === "close") {
      if (f.status !== "Validé") throw new Error("Seul un dossier validé peut être clôturé.");
      const ls = active.length ? await db.select().from(packingLines).where(inArray(packingLines.listId, active.map((l) => l.id))) : [];
      const remaining = ls.reduce((s, l) => s + (l.plannedQty - l.cancelledQty - l.receivedQty), 0);
      const openClaims = await db.select().from(claims).where(and(eq(claims.importId, f.id), inArray(claims.status, ["Ouverte", "En analyse", "En attente fournisseur", "Décision à valider"])));
      if ((remaining > 0 || openClaims.length) && !reason) throw new Error(`Reliquat (${remaining}) ou réclamations ouvertes (${openClaims.length}) : une décision formelle motivée est requise.`);
      next = "Clôturé";
    } else throw new Error("Action inconnue.");
    await db.update(importFiles).set({ status: next }).where(eq(importFiles.id, f.id));
    await audit(db, u, "IMP", f.no, next, { old: f.status, new: next, reason });
    return `${f.no} : ${next}.`;
  });
}

/* ================= Réception composants ================= */
export async function createReception(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("rec.create");
    const listId = id(fd, "listId");
    return await db.transaction(async (tx) => {
      const l = (await tx.select().from(packingLists).where(eq(packingLists.id, listId)).for("update"))[0];
      const f = (await tx.select().from(importFiles).where(eq(importFiles.id, l.importId)))[0];
      if (l.status !== "Validée" || f.status !== "Validé") throw new Error("Réception impossible : le dossier et la liste doivent être validés.");
      const ls = await tx.select().from(packingLines).where(eq(packingLines.listId, l.id));
      const location = opt(fd, "location");
      const final = fd.get("final") === "on";
      const lines: { model: string; received: number; accepted: number; damaged: number; obs?: string }[] = [];
      let over = false;
      for (const pl of ls) {
        const received = int(fd, `rec_${pl.id}`);
        const accepted = int(fd, `acc_${pl.id}`);
        const damaged = int(fd, `dam_${pl.id}`);
        if (accepted + damaged > received) throw new Error(`${pl.model} : accepté + endommagé (${accepted + damaged}) > reçu (${received}).`);
        const rest = pl.plannedQty - pl.cancelledQty - pl.receivedQty;
        if (received > rest) over = true;
        if (received > 0 || (final && rest > 0)) lines.push({ model: pl.model, received, accepted, damaged, obs: opt(fd, `obs_${pl.id}`) ?? undefined });
      }
      if (!lines.some((x) => x.received > 0)) throw new Error("Saisissez au moins une quantité reçue.");
      if (over && !(await useException(tx, l.no))) throw new Error(`Quantité reçue > restant prévu. Bloqué : demandez une autorisation exceptionnelle (référence ${l.no}).`);
      const no = await nextNo(tx, "REC");
      const r = await tx.insert(receptions).values({ no, listId: l.id, location, lines, userId: u.id }).returning({ id: receptions.id });
      const ecarts: string[] = [];
      for (const x of lines) {
        const pl = ls.find((p) => p.model === x.model)!;
        const rest = pl.plannedQty - pl.cancelledQty - pl.receivedQty;
        await tx.update(packingLines).set({ receivedQty: pl.receivedQty + x.received, acceptedQty: pl.acceptedQty + x.accepted, damagedQty: pl.damagedQty + x.received - x.accepted }).where(eq(packingLines.id, pl.id));
        await move(tx, { store: "COMP", model: x.model, qty: x.accepted, sourceType: "Réception", sourceNo: no, idemKey: `REC:${no}:${x.model}:OK`, userId: u.id, location });
        await move(tx, { store: "COMP", state: "BLOQUE", model: x.model, qty: x.received - x.accepted, sourceType: "Réception (endommagé/bloqué)", sourceNo: no, idemKey: `REC:${no}:${x.model}:KO`, userId: u.id, location });
        if (x.received - x.accepted > 0) {
          const e = await nextNo(tx, "ECT");
          await tx.insert(claims).values({ no: e, receptionId: r[0].id, importId: f.id, model: x.model, qty: x.received - x.accepted, description: `Unités endommagées/bloquées à la réception ${no}${x.obs ? " – " + x.obs : ""}`, createdBy: u.id });
          ecarts.push(e);
        }
        if (final && rest - x.received > 0) {
          const e = await nextNo(tx, "ECT");
          await tx.insert(claims).values({ no: e, receptionId: r[0].id, importId: f.id, model: x.model, qty: rest - x.received, description: `Quantité manquante sur ${l.no} : prévu restant ${rest}, reçu ${x.received}`, createdBy: u.id });
          ecarts.push(e);
        }
      }
      await audit(tx, u, "REC", no, "Réception validée", { new: { list: l.no, lines, ecarts } });
      for (const e of ecarts) await audit(tx, u, "ECART", e, `Écart créé depuis ${no}`);
      return { msg: `${no} validée. Stock disponible augmenté des quantités acceptées.${ecarts.length ? ` Fiche(s) d'écart : ${ecarts.join(", ")}.` : ""}`, to: `/reception?id=${r[0].id}` };
    });
  });
}

/* ================= Réclamations ================= */
export async function createClaim(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("claim.create", "claim.manage");
    const receptionId = Number(fd.get("receptionId") || 0) || null;
    let importId: number | null = Number(fd.get("importId") || 0) || null;
    if (receptionId) {
      const rc = (await db.select().from(receptions).where(eq(receptions.id, receptionId)))[0];
      const l = (await db.select().from(packingLists).where(eq(packingLists.id, rc.listId)))[0];
      importId = l.importId;
    }
    return await db.transaction(async (tx) => {
      const no = await nextNo(tx, "ECT");
      await tx.insert(claims).values({ no, receptionId, importId, poId: Number(fd.get("poId") || 0) || null, model: opt(fd, "model"), qty: int(fd, "qty"), description: str(fd, "description", "Description"), createdBy: u.id });
      await audit(tx, u, "ECART", no, "Écart signalé");
      return { msg: `Écart ${no} enregistré.`, to: "/reclamations" };
    });
  });
}

export async function claimAction(fd: FormData) {
  await act(fd, async () => {
    const step = str(fd, "step");
    const u = await requirePerm(...(step === "decide" || step === "refuse" ? ["claim.decide"] : step === "convert" ? ["claim.create", "claim.manage"] : ["claim.manage"]));
    return await db.transaction(async (tx) => {
      const c = (await tx.select().from(claims).where(eq(claims.id, id(fd))).for("update"))[0];
      if (!c || c.status === "Clôturée") throw new Error("Réclamation clôturée : verrouillée.");
      const docNo = c.claimNo ?? c.no;
      if (step === "convert") {
        if (c.kind === "RECLAMATION") throw new Error("Déjà transformée en réclamation.");
        const rcl = await nextNo(tx, "RCL");
        await tx.update(claims).set({ kind: "RECLAMATION", claimNo: rcl, status: "En analyse" }).where(eq(claims.id, c.id));
        await audit(tx, u, "RCL", rcl, `Réclamation fournisseur créée depuis l'écart ${c.no}`);
        await audit(tx, u, "ECART", c.no, `Transformé en réclamation ${rcl}`);
        return `Réclamation ${rcl} créée.`;
      }
      if (step === "update") {
        if (c.status === "Décision à valider") throw new Error("Une décision est en attente de validation.");
        const action = opt(fd, "proposedAction");
        const qtyActions = ["Annuler le reliquat", "Débloquer vers stock disponible", "Remplacement reçu (ajout au stock)"];
        const status = action && qtyActions.includes(action) ? "Décision à valider" : str(fd, "status") || c.status;
        const vals = { status, followUpDate: opt(fd, "followUpDate"), supplierResponse: opt(fd, "supplierResponse"), proposedAction: action, qty: fd.get("qty") ? int(fd, "qty") : c.qty };
        await tx.update(claims).set(vals).where(eq(claims.id, c.id));
        await audit(tx, u, c.kind === "RECLAMATION" ? "RCL" : "ECART", docNo, "Suivi mis à jour", { old: { status: c.status, action: c.proposedAction }, new: vals });
        return status === "Décision à valider" ? "Action transmise au Directeur approvisionnement pour validation." : "Suivi enregistré.";
      }
      if (step === "decide" || step === "refuse") {
        if (c.status !== "Décision à valider") throw new Error("Aucune décision en attente.");
        const comment = opt(fd, "comment");
        if (step === "refuse") {
          if (!comment) throw new Error("Motif obligatoire.");
          await tx.update(claims).set({ status: "En analyse", proposedAction: null }).where(eq(claims.id, c.id));
          await audit(tx, u, "RCL", docNo, "Décision refusée", { old: c.proposedAction, reason: comment });
          return "Décision refusée.";
        }
        if (!c.model || c.qty <= 0) throw new Error("Modèle et quantité requis pour appliquer la décision.");
        if (c.proposedAction === "Annuler le reliquat") {
          if (!c.receptionId) throw new Error("Réclamation non liée à une réception/liste.");
          const rc = (await tx.select().from(receptions).where(eq(receptions.id, c.receptionId)))[0];
          const pl = (await tx.select().from(packingLines).where(and(eq(packingLines.listId, rc.listId), eq(packingLines.model, c.model))).for("update"))[0];
          const rest = pl.plannedQty - pl.cancelledQty - pl.receivedQty;
          if (c.qty > rest) throw new Error(`Quantité à annuler (${c.qty}) > reliquat (${rest}).`);
          await tx.update(packingLines).set({ cancelledQty: pl.cancelledQty + c.qty }).where(eq(packingLines.id, pl.id));
        } else if (c.proposedAction === "Débloquer vers stock disponible") {
          await move(tx, { store: "COMP", state: "BLOQUE", model: c.model, qty: -c.qty, sourceType: "Décision réclamation", sourceNo: docNo, idemKey: `CLM:${c.id}:UNBLOCK:OUT`, userId: u.id });
          await move(tx, { store: "COMP", model: c.model, qty: c.qty, sourceType: "Décision réclamation", sourceNo: docNo, idemKey: `CLM:${c.id}:UNBLOCK:IN`, userId: u.id });
        } else if (c.proposedAction === "Remplacement reçu (ajout au stock)") {
          await move(tx, { store: "COMP", model: c.model, qty: c.qty, sourceType: "Remplacement fournisseur", sourceNo: docNo, idemKey: `CLM:${c.id}:REPL`, userId: u.id });
        }
        await tx.update(claims).set({ status: "Résolue", decidedBy: u.id, decision: `${c.proposedAction} (${c.qty}) validé${comment ? " – " + comment : ""}` }).where(eq(claims.id, c.id));
        await audit(tx, u, "RCL", docNo, `Décision validée : ${c.proposedAction}`, { new: { qty: c.qty }, reason: comment });
        return "Décision validée et appliquée.";
      }
      if (step === "close") {
        if (c.status === "Décision à valider") throw new Error("Une décision est en attente de validation.");
        const decision = str(fd, "decision", "Motif / décision de clôture");
        await tx.update(claims).set({ status: "Clôturée", decision: [c.decision, decision].filter(Boolean).join(" | ") }).where(eq(claims.id, c.id));
        await audit(tx, u, c.kind === "RECLAMATION" ? "RCL" : "ECART", docNo, "Clôturée", { old: c.status, new: "Clôturée", reason: decision });
        return `${docNo} clôturée.`;
      }
      throw new Error("Action inconnue.");
    });
  });
}
