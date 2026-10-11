"use server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assetMoves, assets, attachments, claims, invoices, purchaseOrderLines, purchaseOrders, purchaseRequestLines, purchaseRequests, supplierReceipts,
} from "@/db/schema";
import { requirePerm } from "@/lib/auth";
import { act, audit, getSetting, id, nextNo, num, opt, str, useException } from "@/lib/core";
import { matchInvoice, poTotals, receiptPendingQty } from "@/lib/achats";
import { can } from "@/lib/perms";

const LINES = 8;

/* ================= DA ================= */
export async function saveDa(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("da.create");
    const intent = str(fd, "intent") || "draft";
    const needType = str(fd, "needType", "Type de besoin");
    const pointOfSale = opt(fd, "pointOfSale");
    if (needType === "Point de vente" && !pointOfSale) throw new Error("Veuillez indiquer le point de vente.");
    const motif = str(fd, "motif", "Motif");
    const lines: (typeof purchaseRequestLines.$inferInsert)[] = [];
    for (let i = 0; i < LINES; i++) {
      const des = str(fd, `designation_${i}`);
      if (!des) continue;
      const qty = num(fd, `qty_${i}`, `Quantité ligne ${i + 1}`, 0.001);
      lines.push({ daId: 0, designation: des, qty, unit: str(fd, `unit_${i}`) || "U", urgency: opt(fd, `urg_${i}`), justification: opt(fd, `just_${i}`), isAsset: fd.get(`asset_${i}`) === "on" });
    }
    if (!lines.length) throw new Error("Ajoutez au moins une ligne (désignation + quantité).");
    const editId = Number(fd.get("id") || 0);
    const status = intent === "submit" ? "Soumise" : "Brouillon";
    return await db.transaction(async (tx) => {
      let daId: number, no: string;
      const vals = { needType, pointOfSale, motif, justification: opt(fd, "justification"), urgency: str(fd, "urgency") || "Normale", status };
      if (editId) {
        const d = (await tx.select().from(purchaseRequests).where(eq(purchaseRequests.id, editId)).limit(1))[0];
        if (!d || d.requesterId !== u.id) throw new Error("Seul le demandeur peut modifier sa DA.");
        if (!["Brouillon", "À corriger"].includes(d.status)) throw new Error("DA non modifiable dans son statut actuel.");
        await tx.update(purchaseRequests).set(vals).where(eq(purchaseRequests.id, editId));
        await tx.delete(purchaseRequestLines).where(eq(purchaseRequestLines.daId, editId));
        daId = editId; no = d.no;
        await audit(tx, u, "DA", no, intent === "submit" ? "Soumise au Responsable Achats Locaux" : "Brouillon modifié", { old: d.status, new: status });
      } else {
        no = await nextNo(tx, "DA");
        const r = await tx.insert(purchaseRequests).values({ ...vals, no, requesterId: u.id, service: u.service }).returning({ id: purchaseRequests.id });
        daId = r[0].id;
        await audit(tx, u, "DA", no, intent === "submit" ? "Créée et soumise" : "Créée (brouillon)", { new: status });
      }
      await tx.insert(purchaseRequestLines).values(lines.map((l) => ({ ...l, daId })));
      return { msg: `${no} ${intent === "submit" ? "soumise au Responsable Achats Locaux" : "enregistrée en brouillon"}.`, to: `/achats?tab=da&id=${daId}` };
    });
  });
}

export async function processDa(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("da.process");
    const daId = id(fd);
    const decision = str(fd, "decision");
    const comment = opt(fd, "comment");
    const map: Record<string, string> = { review: "En cours de vérification", accept: "Acceptée pour traitement", return: "À corriger", reject: "Rejetée" };
    const next = map[decision];
    if (!next) throw new Error("Décision invalide.");
    if ((decision === "return" || decision === "reject") && !comment) throw new Error("Un commentaire est obligatoire pour une correction ou un rejet.");
    const d = (await db.select().from(purchaseRequests).where(eq(purchaseRequests.id, daId)).limit(1))[0];
    if (!d) throw new Error("DA introuvable.");
    if (d.requesterId === u.id && decision !== "review") throw new Error("Séparation des tâches : vous ne pouvez pas traiter votre propre demande.");
    const r = await db.update(purchaseRequests).set({ status: next, comment }).where(and(eq(purchaseRequests.id, daId), inArray(purchaseRequests.status, ["Soumise", "En cours de vérification"]))).returning();
    if (!r.length) throw new Error("La DA n'est plus en attente d'examen.");
    await audit(db, u, "DA", d.no, `Décision : ${next}`, { old: d.status, new: next, reason: comment });
    return `${d.no} : ${next}.`;
  });
}

export async function cancelDa(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("da.create", "da.process");
    const daId = id(fd);
    const reason = str(fd, "reason", "Motif d'annulation");
    const d = (await db.select().from(purchaseRequests).where(eq(purchaseRequests.id, daId)).limit(1))[0];
    if (!d) throw new Error("DA introuvable.");
    if (d.requesterId !== u.id && !can(u.role, "da.process")) throw new Error("Action non autorisée.");
    const ordered = await db.select().from(purchaseRequestLines).where(and(eq(purchaseRequestLines.daId, daId), sql`${purchaseRequestLines.orderedQty} > 0`));
    if (ordered.length) throw new Error("Impossible : des lignes ont déjà été commandées.");
    await db.update(purchaseRequests).set({ status: "Annulée", comment: reason }).where(eq(purchaseRequests.id, daId));
    await audit(db, u, "DA", d.no, "Annulée", { old: d.status, new: "Annulée", reason });
    return `${d.no} annulée.`;
  });
}

/* ================= BC ================= */
async function refreshDaStatus(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], daIds: number[]) {
  for (const daId of [...new Set(daIds)]) {
    const ls = await tx.select().from(purchaseRequestLines).where(eq(purchaseRequestLines.daId, daId));
    const tot = ls.reduce((s, l) => s + l.qty, 0), ord = ls.reduce((s, l) => s + l.orderedQty, 0);
    const st = ord <= 0 ? "Acceptée pour traitement" : ord + 1e-9 >= tot ? "Entièrement commandée" : "Partiellement commandée";
    await tx.update(purchaseRequests).set({ status: st }).where(and(eq(purchaseRequests.id, daId), inArray(purchaseRequests.status, ["Acceptée pour traitement", "Partiellement commandée", "Entièrement commandée"])));
  }
}

async function routeStatus(ht: number, previous: string) {
  const threshold = Number(await getSetting("bc_threshold")) || 100;
  if (ht < threshold) return "Validé";
  return ["Validé", "Émis", "À revalider"].includes(previous) ? "À revalider" : "En attente de validation";
}

export async function createPo(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("bc.manage");
    const supplierId = id(fd, "supplierId");
    const selected = fd.getAll("line").map(Number).filter(Boolean);
    if (!selected.length) throw new Error("Sélectionnez au moins une ligne de DA acceptée.");
    const intent = str(fd, "intent") || "submit";
    const stamp = num(fd, "stamp", "Timbre fiscal");
    return await db.transaction(async (tx) => {
      const daLines = await tx.select({ l: purchaseRequestLines, d: purchaseRequests }).from(purchaseRequestLines).innerJoin(purchaseRequests, eq(purchaseRequests.id, purchaseRequestLines.daId)).where(inArray(purchaseRequestLines.id, selected)).for("update");
      const lines: (typeof purchaseOrderLines.$inferInsert)[] = [];
      for (const { l, d } of daLines) {
        if (!["Acceptée pour traitement", "Partiellement commandée"].includes(d.status)) throw new Error(`${d.no} n'est pas acceptée pour traitement.`);
        const qty = num(fd, `qty_${l.id}`, `Quantité (${l.designation})`, 0.001);
        const rest = l.qty - l.orderedQty;
        if (qty > rest + 1e-9) throw new Error(`Quantité commandée (${qty}) > reliquat de ${d.no} « ${l.designation} » (${rest}).`);
        lines.push({ poId: 0, daLineId: l.id, designation: l.designation, qty, unit: l.unit, unitPrice: num(fd, `price_${l.id}`, `Prix (${l.designation})`), discount: num(fd, `disc_${l.id}`), tva: num(fd, `tva_${l.id}`), isAsset: l.isAsset });
        await tx.update(purchaseRequestLines).set({ orderedQty: sql`${purchaseRequestLines.orderedQty} + ${qty}` }).where(eq(purchaseRequestLines.id, l.id));
      }
      const t = poTotals(lines.map((l) => ({ qty: Number(l.qty), unitPrice: Number(l.unitPrice), discount: Number(l.discount), tva: Number(l.tva) })), stamp);
      const status = intent === "draft" ? "Brouillon" : await routeStatus(t.ht, "Brouillon");
      const no = await nextNo(tx, "BC");
      const r = await tx.insert(purchaseOrders).values({ no, supplierId, stamp, conditions: opt(fd, "conditions"), deliveryDate: opt(fd, "deliveryDate"), observations: opt(fd, "observations"), totalHt: t.ht, totalTva: t.tva, totalTtc: t.ttc, createdBy: u.id, status, validatedAt: status === "Validé" ? new Date() : null }).returning({ id: purchaseOrders.id });
      await tx.insert(purchaseOrderLines).values(lines.map((l) => ({ ...l, poId: r[0].id })));
      await refreshDaStatus(tx, daLines.map((x) => x.d.id));
      await audit(tx, u, "BC", no, "Créé", { new: { status, ht: t.ht, da: [...new Set(daLines.map((x) => x.d.no))] } });
      if (status === "Validé") await audit(tx, null, "BC", no, "Validation automatique (montant HT < seuil de délégation)");
      return { msg: `${no} créé – statut : ${status}.`, to: `/achats?tab=bc&id=${r[0].id}` };
    });
  });
}

export async function editPo(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("bc.manage");
    const poId = id(fd);
    return await db.transaction(async (tx) => {
      const po = (await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId)).for("update"))[0];
      if (!po) throw new Error("BC introuvable.");
      if (!["Brouillon", "En attente de validation", "Validé", "Rejeté", "À revalider", "Émis"].includes(po.status)) throw new Error("BC non modifiable dans son statut actuel.");
      const recs = await tx.select().from(supplierReceipts).where(eq(supplierReceipts.poId, poId));
      if (recs.length) throw new Error("BC déjà en réception : utilisez une annulation/ajustement motivé.");
      const reason = str(fd, "reason", "Motif de modification");
      const lines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, poId));
      const updated = [];
      for (const l of lines) {
        const qty = num(fd, `qty_${l.id}`, `Quantité ${l.designation}`, 0.001);
        const daL = (await tx.select().from(purchaseRequestLines).where(eq(purchaseRequestLines.id, l.daLineId)).for("update"))[0];
        const rest = daL.qty - daL.orderedQty + l.qty;
        if (qty > rest + 1e-9) throw new Error(`Quantité > reliquat DA pour « ${l.designation} » (${rest}).`);
        await tx.update(purchaseRequestLines).set({ orderedQty: daL.orderedQty - l.qty + qty }).where(eq(purchaseRequestLines.id, daL.id));
        const nl = { qty, unitPrice: num(fd, `price_${l.id}`), discount: num(fd, `disc_${l.id}`), tva: num(fd, `tva_${l.id}`) };
        await tx.update(purchaseOrderLines).set(nl).where(eq(purchaseOrderLines.id, l.id));
        updated.push({ ...nl, daId: daL.daId });
      }
      const stamp = num(fd, "stamp");
      const t = poTotals(updated, stamp);
      const intent = str(fd, "intent") || "submit";
      const status = intent === "draft" ? "Brouillon" : await routeStatus(t.ht, po.status);
      await tx.update(purchaseOrders).set({ supplierId: id(fd, "supplierId"), stamp, totalHt: t.ht, totalTva: t.tva, totalTtc: t.ttc, status, conditions: opt(fd, "conditions"), deliveryDate: opt(fd, "deliveryDate"), validatedBy: null, validatedAt: status === "Validé" ? new Date() : null, sentAt: null }).where(eq(purchaseOrders.id, poId));
      await refreshDaStatus(tx, updated.map((x) => x.daId));
      await audit(tx, u, "BC", po.no, "Modifié", { old: { status: po.status, ht: po.totalHt, supplier: po.supplierId }, new: { status, ht: t.ht }, reason });
      return `${po.no} modifié – statut : ${status}.`;
    });
  });
}

export async function decidePo(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("bc.validate");
    const poId = id(fd);
    const decision = str(fd, "decision");
    const reason = opt(fd, "reason");
    const po = (await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId)))[0];
    if (!po) throw new Error("BC introuvable.");
    if (po.createdBy === u.id) throw new Error("Séparation des tâches : vous ne pouvez pas valider un BC que vous avez créé.");
    if (decision === "reject" && !reason) throw new Error("Le motif de rejet est obligatoire.");
    const status = decision === "validate" ? "Validé" : "Rejeté";
    const r = await db.update(purchaseOrders).set({ status, validatedBy: u.id, validatedAt: new Date(), rejectReason: decision === "reject" ? reason : null }).where(and(eq(purchaseOrders.id, poId), inArray(purchaseOrders.status, ["En attente de validation", "À revalider"]))).returning();
    if (!r.length) throw new Error("Ce BC n'est plus en attente de validation.");
    await audit(db, u, "BC", po.no, status === "Validé" ? "Validé par le Directeur Approvisionnement" : "Rejeté", { old: po.status, new: status, reason });
    return `${po.no} ${status.toLowerCase()}.`;
  });
}

export async function submitPo(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("bc.manage");
    const po = (await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id(fd))))[0];
    if (!po || !["Brouillon", "Rejeté"].includes(po.status)) throw new Error("BC non soumissible.");
    const status = await routeStatus(po.totalHt, po.status);
    await db.update(purchaseOrders).set({ status, validatedAt: status === "Validé" ? new Date() : null }).where(eq(purchaseOrders.id, po.id));
    await audit(db, u, "BC", po.no, status === "Validé" ? "Soumis – validation automatique (< seuil)" : "Soumis au Directeur Approvisionnement", { old: po.status, new: status });
    return `${po.no} : ${status}.`;
  });
}

export async function emitPo(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("bc.manage");
    const po = (await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id(fd))))[0];
    const r = await db.update(purchaseOrders).set({ status: "Émis", sentAt: new Date() }).where(and(eq(purchaseOrders.id, po.id), eq(purchaseOrders.status, "Validé"))).returning();
    if (!r.length) throw new Error("Seul un BC validé peut être émis.");
    await audit(db, u, "BC", po.no, "Émis au fournisseur", { old: po.status, new: "Émis" });
    return `${po.no} émis au fournisseur.`;
  });
}

export async function cancelPo(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("bc.manage");
    const reason = str(fd, "reason", "Motif d'annulation");
    return await db.transaction(async (tx) => {
      const po = (await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id(fd))).for("update"))[0];
      if (!po || ["Annulé", "Clôturé"].includes(po.status)) throw new Error("BC non annulable.");
      const recs = await tx.select().from(supplierReceipts).where(eq(supplierReceipts.poId, po.id));
      if (recs.length) throw new Error("Des réceptions existent : annulation impossible.");
      const lines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, po.id));
      const daIds: number[] = [];
      for (const l of lines) {
        const r = await tx.update(purchaseRequestLines).set({ orderedQty: sql`greatest(${purchaseRequestLines.orderedQty} - ${l.qty}, 0)` }).where(eq(purchaseRequestLines.id, l.daLineId)).returning({ daId: purchaseRequestLines.daId });
        daIds.push(r[0].daId);
      }
      await tx.update(purchaseOrders).set({ status: "Annulé", rejectReason: reason }).where(eq(purchaseOrders.id, po.id));
      await refreshDaStatus(tx, daIds);
      await audit(tx, u, "BC", po.no, "Annulé", { old: po.status, new: "Annulé", reason });
      return `${po.no} annulé, reliquats DA restaurés.`;
    });
  });
}

export async function closePo(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("bc.manage");
    const po = (await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id(fd))))[0];
    const open = await db.select().from(supplierReceipts).where(and(eq(supplierReceipts.poId, po.id), inArray(supplierReceipts.status, ["En attente de réception", "Réception avec anomalie", "En cours de régularisation"])));
    if (open.length) throw new Error("Des réceptions ne sont pas confirmées ou régularisées.");
    const reason = str(fd, "reason") || "Soldé";
    if (po.status !== "Entièrement reçu" && reason === "Soldé") throw new Error("BC non entièrement reçu : indiquez un motif de clôture du reliquat.");
    await db.update(purchaseOrders).set({ status: "Clôturé" }).where(eq(purchaseOrders.id, po.id));
    await audit(db, u, "BC", po.no, "Clôturé", { old: po.status, new: "Clôturé", reason });
    return `${po.no} clôturé.`;
  });
}

/* ================= Réceptions fournisseur ================= */
export async function createReceipt(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("rcf.admin");
    const poId = id(fd, "poId");
    const po = (await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId)))[0];
    if (!po || !["Émis", "Partiellement reçu"].includes(po.status)) throw new Error("Sélectionnez un BC émis.");
    const lines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, poId));
    const rl: { poLineId: number; qty: number; state: string; comment?: string }[] = [];
    let over = false;
    for (const l of lines) {
      const q = num(fd, `qty_${l.id}`);
      if (q <= 0) continue;
      const pend = await receiptPendingQty(l.id, poId);
      if (q > l.qty - l.receivedQty - pend + 1e-9) over = true;
      rl.push({ poLineId: l.id, qty: q, state: str(fd, `state_${l.id}`) || "Conforme", comment: opt(fd, `com_${l.id}`) ?? undefined });
    }
    if (!rl.length) throw new Error("Saisissez au moins une quantité reçue.");
    return await db.transaction(async (tx) => {
      if (over && !(await useException(tx, po.no))) throw new Error(`Quantité reçue > reliquat du BC. Validation bloquée : demandez une autorisation exceptionnelle (référence ${po.no}) dans Administration.`);
      const no = await nextNo(tx, "RCF");
      const r = await tx.insert(supplierReceipts).values({ no, poId, blNumber: str(fd, "blNumber", "N° BL fournisseur"), receiptDate: str(fd, "receiptDate", "Date de réception"), lines: rl, comment: opt(fd, "comment"), createdBy: u.id }).returning({ id: supplierReceipts.id });
      await audit(tx, u, "RCF", no, "Réception administrative enregistrée", { new: { bc: po.no, lines: rl, exception: over } });
      return { msg: `${no} enregistrée – en attente de confirmation physique « Reçu conforme ».`, to: `/achats?tab=rcf&id=${r[0].id}` };
    });
  });
}

export async function confirmReceipt(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("rcf.confirm");
    const rid = id(fd);
    return await db.transaction(async (tx) => {
      const rc = (await tx.select().from(supplierReceipts).where(eq(supplierReceipts.id, rid)).for("update"))[0];
      if (!rc || rc.status !== "En attente de réception") throw new Error("Cette réception a déjà été confirmée.");
      const po = (await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, rc.poId)).for("update"))[0];
      if (po.createdBy === u.id || rc.createdBy === u.id) throw new Error("Séparation des tâches : la confirmation physique doit être faite par une autre personne.");
      const newLines = rc.lines.map((l) => ({ ...l, qty: num(fd, `qty_${l.poLineId}`), state: str(fd, `state_${l.poLineId}`) || l.state, comment: opt(fd, `com_${l.poLineId}`) ?? l.comment }));
      const anomaly = newLines.some((l) => l.state !== "Conforme");
      const status = anomaly ? "Réception avec anomalie" : "Reçu conforme";
      await tx.update(supplierReceipts).set({ lines: newLines, status, confirmedBy: u.id, confirmedAt: new Date() }).where(eq(supplierReceipts.id, rid));
      const year = new Date().getFullYear();
      let createdAssets = 0;
      for (const l of newLines) {
        const pl = (await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.id, l.poLineId)))[0];
        await tx.update(purchaseOrderLines).set({ receivedQty: pl.receivedQty + l.qty }).where(eq(purchaseOrderLines.id, pl.id));
        if (pl.isAsset && l.state === "Conforme") {
          const daL = (await tx.select({ daNo: purchaseRequests.no }).from(purchaseRequestLines).innerJoin(purchaseRequests, eq(purchaseRequests.id, purchaseRequestLines.daId)).where(eq(purchaseRequestLines.id, pl.daLineId)))[0];
          for (let k = 0; k < Math.floor(l.qty); k++) {
            const code = await nextNo(tx, "IMM");
            await tx.insert(assets).values({ code, designation: pl.designation, acquisitionDate: rc.receiptDate, supplierId: po.supplierId, refs: `${daL?.daNo ?? ""} / ${po.no} / BL ${rc.blNumber} (${rc.no})` });
            createdAssets++;
          }
        }
      }
      void year;
      const all = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, po.id));
      const full = all.every((l) => l.receivedQty + 1e-9 >= l.qty);
      await tx.update(purchaseOrders).set({ status: full ? "Entièrement reçu" : "Partiellement reçu" }).where(eq(purchaseOrders.id, po.id));
      if (anomaly) {
        const cno = await nextNo(tx, "ECT");
        await tx.insert(claims).values({ no: cno, poId: po.id, description: `Anomalie réception ${rc.no} (BL ${rc.blNumber}) : ` + newLines.filter((l) => l.state !== "Conforme").map((l) => `${l.state} – ${l.comment ?? ""}`).join("; "), createdBy: u.id });
        await audit(tx, u, "ECART", cno, "Écart créé depuis réception fournisseur", { new: rc.no });
      }
      await audit(tx, u, "RCF", rc.no, status === "Reçu conforme" ? "Confirmé « Reçu conforme »" : "Réception avec anomalie", { old: rc.lines, new: newLines });
      return `${rc.no} : ${status}.${createdAssets ? ` ${createdAssets} fiche(s) d'immobilisation créée(s).` : ""}`;
    });
  });
}

export async function regularizeReceipt(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("rcf.admin", "rcf.confirm");
    const rc = (await db.select().from(supplierReceipts).where(eq(supplierReceipts.id, id(fd))))[0];
    const comment = str(fd, "comment", "Commentaire de régularisation");
    const next = rc.status === "Réception avec anomalie" ? "En cours de régularisation" : rc.status === "En cours de régularisation" ? "Régularisé" : null;
    if (!next) throw new Error("Statut non régularisable.");
    await db.update(supplierReceipts).set({ status: next }).where(eq(supplierReceipts.id, rc.id));
    await audit(db, u, "RCF", rc.no, next, { old: rc.status, new: next, reason: comment });
    return `${rc.no} : ${next}.`;
  });
}

/* ================= Factures ================= */
export async function createInvoice(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("inv.manage");
    const poIds = fd.getAll("poIds").map(Number).filter(Boolean);
    const receiptIds = fd.getAll("receiptIds").map(Number).filter(Boolean);
    if (!poIds.length) throw new Error("Associez au moins un BC.");
    const ht = num(fd, "ht", "Montant HT"), tva = num(fd, "tva", "TVA"), stamp = num(fd, "stamp", "Timbre");
    const ttc = Math.round((ht + tva + stamp) * 1000) / 1000;
    const supplierId = id(fd, "supplierId");
    const issues = await matchInvoice({ supplierId, poIds, receiptIds, ht, tva, stamp, ttc });
    return await db.transaction(async (tx) => {
      const no = await nextNo(tx, "FAC");
      const status = issues.length ? "Écart à traiter" : "Rapprochée";
      const r = await tx.insert(invoices).values({ no, invoiceNumber: str(fd, "invoiceNumber", "N° facture"), invoiceDate: str(fd, "invoiceDate", "Date facture"), supplierId, poIds, receiptIds, ht, tva, stamp, ttc, status, comment: opt(fd, "comment"), createdBy: u.id }).returning({ id: invoices.id });
      await audit(tx, u, "FAC", no, "Facture enregistrée", { new: { status, issues } });
      return { msg: `${no} enregistrée – ${status}${issues.length ? ` (${issues.length} anomalie(s))` : ""}.`, to: `/achats?tab=fac&id=${r[0].id}` };
    });
  });
}

export async function invoiceAction(fd: FormData) {
  await act(fd, async () => {
    const step = str(fd, "step");
    const u = await requirePerm(["justify", "transmit", "cancel"].includes(step) ? "inv.manage" : "inv.daf");
    const inv = (await db.select().from(invoices).where(eq(invoices.id, id(fd))))[0];
    const comment = opt(fd, "comment");
    let next: string;
    if (step === "justify") {
      if (!comment) throw new Error("La justification est obligatoire.");
      if (inv.status !== "Écart à traiter") throw new Error("Aucun écart à justifier.");
      next = "Écart justifié";
    } else if (step === "transmit") {
      if (!["Rapprochée", "Écart justifié"].includes(inv.status)) throw new Error("Le dossier doit être rapproché (ou les écarts justifiés/autorisés) avant transmission.");
      const files = await db.select({ id: attachments.id }).from(attachments).where(and(eq(attachments.docType, "FAC"), eq(attachments.docId, inv.id)));
      if (!files.length) throw new Error("Joignez la facture numérisée avant transmission au DAF.");
      next = "Transmise au DAF";
    } else if (step === "cancel") {
      if (!comment) throw new Error("Motif obligatoire.");
      next = "Annulée";
    } else {
      const map: Record<string, [string[], string]> = {
        return: [["Transmise au DAF"], "Retournée aux achats"],
        bap: [["Transmise au DAF"], "Bon à payer"],
        post: [["Bon à payer"], "Comptabilisée"],
        pay: [["Comptabilisée"], "Payée"],
      };
      const m = map[step];
      if (!m || !m[0].includes(inv.status)) throw new Error("Transition non permise depuis le statut actuel.");
      if (step === "return" && !comment) throw new Error("Motif obligatoire.");
      next = m[1];
    }
    await db.update(invoices).set({ status: next === "Retournée aux achats" ? "Écart à traiter" : next }).where(eq(invoices.id, inv.id));
    await audit(db, u, "FAC", inv.no, next, { old: inv.status, new: next, reason: comment });
    return `${inv.no} : ${next}.`;
  });
}

/* ================= Immobilisations ================= */
export async function assetAction(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("asset.manage");
    const a = (await db.select().from(assets).where(eq(assets.id, id(fd))))[0];
    if (!a) throw new Error("Immobilisation introuvable.");
    const step = str(fd, "step");
    if (step === "complete") {
      const vals = { brand: opt(fd, "brand"), model: opt(fd, "model"), serial: opt(fd, "serial"), condition: opt(fd, "condition") };
      await db.update(assets).set(vals).where(eq(assets.id, a.id));
      await audit(db, u, "IMM", a.code, "Fiche complétée", { old: { brand: a.brand, model: a.model, serial: a.serial }, new: vals });
      return `${a.code} complétée.`;
    }
    if (step === "justify") {
      const files = await db.select({ id: attachments.id }).from(attachments).where(and(eq(attachments.docType, "IMM"), eq(attachments.docId, a.id)));
      if (!files.length) throw new Error("Joignez d'abord le scan signé de la fiche d'affectation.");
      if (a.assignStatus !== "Affectation non justifiée") throw new Error("Aucune affectation à justifier.");
      await db.update(assets).set({ assignStatus: "Affecté" }).where(eq(assets.id, a.id));
      await audit(db, u, "IMM", a.code, "Affectation justifiée (fiche signée jointe)");
      return `${a.code} : affectation justifiée.`;
    }
    const kinds: Record<string, string> = { assign: "Affectation", transfer: "Transfert", restitution: "Restitution", cession: "Cession", rebut: "Mise au rebut" };
    const kind = kinds[step];
    if (!kind) throw new Error("Action inconnue.");
    if (["Cédé", "Mis au rebut"].includes(a.assignStatus)) throw new Error("Bien sorti du patrimoine : aucun mouvement possible.");
    const reason = step === "assign" ? opt(fd, "reason") : str(fd, "reason", "Motif / état / accessoires");
    const newHolder = ["assign", "transfer"].includes(step) ? str(fd, "holder", "Personnel affecté") : null;
    const newLocation = ["assign", "transfer"].includes(step) ? str(fd, "location", "Emplacement") : step === "restitution" ? opt(fd, "location") : null;
    const service = ["assign", "transfer"].includes(step) ? str(fd, "service", "Service") : a.service;
    const status = { assign: "Affectation non justifiée", transfer: "Affectation non justifiée", restitution: "Non affecté", cession: "Cédé", rebut: "Mis au rebut" }[step]!;
    await db.transaction(async (tx) => {
      await tx.insert(assetMoves).values({ assetId: a.id, kind, oldHolder: a.holder, newHolder, oldLocation: a.location, newLocation, reason, userId: u.id });
      await tx.update(assets).set({ holder: newHolder, location: newLocation ?? a.location, service, assignStatus: status, condition: opt(fd, "condition") ?? a.condition }).where(eq(assets.id, a.id));
      await audit(tx, u, "IMM", a.code, kind, { old: { holder: a.holder, location: a.location }, new: { holder: newHolder, location: newLocation }, reason });
    });
    return `${a.code} : ${kind} enregistrée.`;
  });
}
