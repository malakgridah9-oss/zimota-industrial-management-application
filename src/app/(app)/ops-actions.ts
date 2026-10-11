"use server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  adjustments, componentRequests, customerReturns, exitSlips, inspectionSessions, inspections, nonConformities, pfTransfers, productions, transfers,
} from "@/db/schema";
import { requirePerm } from "@/lib/auth";
import { act, audit, balance, id, int, move, nextNo, opt, reservedComp, str, lockStock, type Store } from "@/lib/core";

/* ================= Ajustements ================= */
export async function requestAdjustment(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("adj.request");
    const qty = int(fd, "qty", "Quantité (+/-)", -1e9);
    if (qty === 0) throw new Error("La quantité ne peut pas être nulle.");
    const store = str(fd, "store", "Stock");
    if (!["COMP", "PROD", "PF"].includes(store)) throw new Error("Stock invalide.");
    return await db.transaction(async (tx) => {
      const no = await nextNo(tx, "ADJ");
      await tx.insert(adjustments).values({ no, store, state: str(fd, "state") || "DISPONIBLE", model: str(fd, "model", "Modèle"), qty, sourceDoc: str(fd, "sourceDoc", "Document source"), reason: str(fd, "reason", "Motif"), requestedBy: u.id });
      await audit(tx, u, "ADJ", no, "Demande d'ajustement", { new: { store, qty } });
      return `${no} soumise à validation (par une autre personne habilitée).`;
    });
  });
}

export async function decideAdjustment(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("adj.validate");
    const decision = str(fd, "decision");
    const comment = opt(fd, "comment");
    return await db.transaction(async (tx) => {
      const a = (await tx.select().from(adjustments).where(eq(adjustments.id, id(fd))).for("update"))[0];
      if (!a || a.status !== "À valider") throw new Error("Ajustement déjà traité.");
      if (a.requestedBy === u.id) throw new Error("Séparation des tâches : le demandeur ne peut pas valider son propre ajustement.");
      if (decision === "reject" && !comment) throw new Error("Motif de refus obligatoire.");
      if (decision === "approve") await move(tx, { store: a.store as Store, state: a.state, model: a.model, qty: a.qty, sourceType: "Ajustement", sourceNo: a.no, idemKey: `ADJ:${a.no}`, userId: u.id });
      const status = decision === "approve" ? "Validé" : "Refusé";
      await tx.update(adjustments).set({ status, decidedBy: u.id, decisionComment: comment }).where(eq(adjustments.id, a.id));
      await audit(tx, u, "ADJ", a.no, status, { old: "À valider", new: status, reason: comment });
      return `${a.no} ${status.toLowerCase()}.`;
    });
  });
}

/* ================= Demandes de composants & BS ================= */
export async function createDem(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("dem.create");
    return await db.transaction(async (tx) => {
      const no = await nextNo(tx, "DEM");
      await tx.insert(componentRequests).values({ no, model: str(fd, "model", "Modèle"), qty: int(fd, "qty", "Quantité", 1), neededDate: str(fd, "neededDate", "Date nécessaire"), priority: str(fd, "priority") || "Normale", obs: opt(fd, "obs"), requestedBy: u.id });
      await audit(tx, u, "DEM", no, "Demande de composants créée");
      return `${no} transmise au magasin.`;
    });
  });
}

export async function createBs(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("bs.prepare");
    const qty = int(fd, "qty", "Quantité préparée", 1);
    return await db.transaction(async (tx) => {
      const d = (await tx.select().from(componentRequests).where(eq(componentRequests.id, id(fd, "demId"))).for("update"))[0];
      if (!d || ["Préparée", "Annulée"].includes(d.status)) throw new Error("Demande déjà entièrement préparée.");
      if (qty > d.qty - d.preparedQty) throw new Error(`Quantité > restant demandé (${d.qty - d.preparedQty}).`);
      await lockStock(tx, "COMP", d.model);
      const free = (await balance(tx, "COMP", d.model)) - (await reservedComp(tx, d.model));
      if (qty > free) throw new Error(`Stock libre insuffisant pour ${d.model} : ${free}.`);
      const no = await nextNo(tx, "BS");
      await tx.insert(exitSlips).values({ no, demId: d.id, model: d.model, qty, preparedBy: u.id });
      const prepared = d.preparedQty + qty;
      await tx.update(componentRequests).set({ preparedQty: prepared, status: prepared >= d.qty ? "Préparée" : "Partiellement préparée" }).where(eq(componentRequests.id, d.id));
      await audit(tx, u, "BS", no, `Bon de sortie émis pour ${d.no}`, { new: { model: d.model, qty } });
      return `${no} émis (${qty} ${d.model}). Imprimez-le pour accompagner les composants.`;
    });
  });
}

export async function receiveBs(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("bs.receive");
    const accepted = int(fd, "accepted", "Quantité acceptée");
    return await db.transaction(async (tx) => {
      const b = (await tx.select().from(exitSlips).where(eq(exitSlips.id, id(fd))).for("update"))[0];
      if (!b || b.status !== "Émis") throw new Error("Ce bon a déjà été réceptionné.");
      if (b.preparedBy === u.id) throw new Error("Séparation des tâches : vous ne pouvez pas réceptionner votre propre BS.");
      if (accepted > b.qty) throw new Error("Quantité acceptée > quantité du BS.");
      const refused = b.qty - accepted;
      const reason = opt(fd, "reason");
      if (refused > 0 && !reason) throw new Error("Un motif est obligatoire en cas de différence.");
      const rp = await nextNo(tx, "RP");
      await tx.update(exitSlips).set({ status: "Réceptionné", rpNo: rp, receivedBy: u.id, acceptedQty: accepted, refusedQty: refused, reason, receivedAt: new Date() }).where(eq(exitSlips.id, b.id));
      if (accepted > 0) {
        await move(tx, { store: "COMP", model: b.model, qty: -accepted, sourceType: "Bon de sortie", sourceNo: `${b.no}/${rp}`, idemKey: `BS:${b.no}:OUT`, userId: u.id });
        await move(tx, { store: "PROD", model: b.model, qty: accepted, sourceType: "Réception production", sourceNo: `${b.no}/${rp}`, idemKey: `BS:${b.no}:IN`, userId: u.id });
      }
      if (refused > 0) {
        await tx.update(componentRequests).set({ preparedQty: sql`${componentRequests.preparedQty} - ${refused}`, status: "Partiellement préparée" }).where(eq(componentRequests.id, b.demId));
      }
      await audit(tx, u, "BS", b.no, `Réceptionné par la production (${rp})`, { new: { accepted, refused }, reason });
      await audit(tx, u, "RP", rp, `Réception production du ${b.no}`, { new: { accepted, refused } });
      return `${rp} : ${accepted} acceptés${refused ? `, ${refused} refusés (reliquat remis à préparer)` : ""}.`;
    });
  });
}

/* ================= Production ================= */
export async function createPrj(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("prj.create");
    const qty = int(fd, "qty", "Quantité produite", 1);
    const bsId = Number(fd.get("bsId") || 0) || null;
    const used = fd.get("componentsUsed") ? int(fd, "componentsUsed", "Composants consommés") : null;
    return await db.transaction(async (tx) => {
      let model = str(fd, "model");
      let srcNo: string | null = null;
      if (bsId) {
        const b = (await tx.select().from(exitSlips).where(eq(exitSlips.id, bsId)).for("update"))[0];
        if (!b || b.status !== "Réceptionné") throw new Error("Le BS source doit être réceptionné par la production.");
        model = b.model;
        srcNo = b.no;
        if (used !== null) {
          if (used > (b.acceptedQty ?? 0) - b.usedQty) throw new Error(`Composants consommés > disponibles sur ${b.no} (${(b.acceptedQty ?? 0) - b.usedQty}).`);
          await tx.update(exitSlips).set({ usedQty: b.usedQty + used }).where(eq(exitSlips.id, b.id));
        }
      }
      if (!model) throw new Error("Modèle obligatoire.");
      const no = await nextNo(tx, "PRJ");
      await tx.insert(productions).values({ no, bsId, model, prodDate: str(fd, "prodDate", "Date"), qty, team: opt(fd, "team"), headcount: fd.get("headcount") ? int(fd, "headcount") : null, componentsUsed: used, obs: opt(fd, "obs"), createdBy: u.id });
      if (used) await move(tx, { store: "PROD", model, qty: -used, sourceType: "Consommation production", sourceNo: no, idemKey: `PRJ:${no}:CONS`, userId: u.id });
      await audit(tx, u, "PRJ", no, "Déclaration de production", { new: { model, qty, used, source: srcNo } });
      return `${no} enregistrée : ${qty} motos ${model} à transférer en inspection.`;
    });
  });
}

export async function createTrf(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("trf.create");
    const qty = int(fd, "qty", "Quantité à transférer", 1);
    return await db.transaction(async (tx) => {
      const p = (await tx.select().from(productions).where(eq(productions.id, id(fd, "prjId"))).for("update"))[0];
      if (qty > p.qty - p.transferredQty) throw new Error(`Quantité > produit non transféré (${p.qty - p.transferredQty}).`);
      await tx.update(productions).set({ transferredQty: p.transferredQty + qty }).where(eq(productions.id, p.id));
      const no = await nextNo(tx, "TRF");
      await tx.insert(transfers).values({ no, prjId: p.id, model: p.model, qty, issuedBy: u.id });
      await audit(tx, u, "TRF", no, `Transfert vers inspection depuis ${p.no}`, { new: { qty } });
      return `${no} émis (${qty} ${p.model}).`;
    });
  });
}

export async function receiveTrf(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("trf.receive");
    const accepted = int(fd, "accepted", "Quantité acceptée");
    return await db.transaction(async (tx) => {
      const t = (await tx.select().from(transfers).where(eq(transfers.id, id(fd))).for("update"))[0];
      if (!t || t.status !== "En attente") throw new Error("Transfert déjà réceptionné.");
      if (t.issuedBy === u.id) throw new Error("Séparation des tâches : l'émetteur ne peut pas réceptionner.");
      if (accepted > t.qty) throw new Error("Quantité acceptée > quantité transférée.");
      const reason = opt(fd, "reason");
      if (accepted < t.qty && !reason) throw new Error("Motif obligatoire en cas d'écart.");
      await tx.update(transfers).set({ status: "Réceptionné", acceptedQty: accepted, reason, receivedBy: u.id, receivedAt: new Date() }).where(eq(transfers.id, t.id));
      if (accepted < t.qty) await tx.update(productions).set({ transferredQty: sql`${productions.transferredQty} - ${t.qty - accepted}` }).where(eq(productions.id, t.prjId));
      let fi = "";
      if (accepted > 0) {
        fi = await nextNo(tx, "FI");
        await tx.insert(inspections).values({ no: fi, trfId: t.id, model: t.model, receivedQty: accepted });
        await audit(tx, u, "FI", fi, `Fiche d'inspection ouverte (${t.no})`, { new: { qty: accepted } });
      }
      await audit(tx, u, "TRF", t.no, "Réceptionné par la qualité", { new: { accepted }, reason });
      return `${t.no} réceptionné : ${accepted}.${fi ? ` Fiche ${fi} ouverte.` : ""}${accepted < t.qty ? ` Reliquat ${t.qty - accepted} remis en production.` : ""}`;
    });
  });
}

/* ================= Inspection ================= */
export async function addSession(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("insp.do");
    const conform = int(fd, "conform", "Conformes");
    const nc = int(fd, "nonConform", "Non conformes");
    const inspected = int(fd, "inspected", "Inspectées", 1);
    if (inspected !== conform + nc) throw new Error(`Contrôle arithmétique : inspectées (${inspected}) ≠ conformes (${conform}) + non conformes (${nc}).`);
    return await db.transaction(async (tx) => {
      const f = (await tx.select().from(inspections).where(eq(inspections.id, id(fd))).for("update"))[0];
      if (inspected > f.receivedQty - f.inspectedQty) throw new Error(`Inspectées > restant à inspecter (${f.receivedQty - f.inspectedQty}).`);
      if (nc > 0 && !opt(fd, "defect")) throw new Error("Décrivez le défaut des unités non conformes.");
      const ses = await nextNo(tx, "SES");
      const r = await tx.insert(inspectionSessions).values({ no: ses, fiId: f.id, inspected, conform, nonConform: nc, defects: opt(fd, "defects") ?? opt(fd, "defect"), userId: u.id }).returning({ id: inspectionSessions.id });
      const done = f.inspectedQty + inspected >= f.receivedQty;
      await tx.update(inspections).set({ inspectedQty: f.inspectedQty + inspected, conformQty: f.conformQty + conform, nonConformQty: f.nonConformQty + nc, status: done ? "Inspection terminée" : "En cours" }).where(eq(inspections.id, f.id));
      let ncNo = "";
      if (nc > 0) {
        ncNo = await nextNo(tx, "NC");
        await tx.insert(nonConformities).values({ no: ncNo, fiId: f.id, sesId: r[0].id, model: f.model, qty: nc, defect: str(fd, "defect"), severity: str(fd, "severity") || "Mineure", expectedDecision: opt(fd, "expectedDecision"), responsible: opt(fd, "responsible") });
        await audit(tx, u, "NC", ncNo, "Non-conformité ouverte (unités bloquées)", { new: { qty: nc } });
      }
      await audit(tx, u, "FI", f.no, `Session ${ses}`, { new: { inspected, conform, nc } });
      return `${ses} enregistrée.${ncNo ? ` ${ncNo} ouverte – ${nc} unité(s) bloquée(s).` : ""}${done ? " Inspection terminée." : ""}`;
    });
  });
}

export async function decideNc(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("insp.do");
    const decision = str(fd, "decision", "Décision");
    const comment = str(fd, "comment", "Justification documentée");
    return await db.transaction(async (tx) => {
      const n = (await tx.select().from(nonConformities).where(eq(nonConformities.id, id(fd))).for("update"))[0];
      if (!n || n.status !== "Ouverte") throw new Error("NC déjà traitée.");
      if (decision === "Retouchée – conforme après réinspection") {
        await tx.update(inspections).set({ conformQty: sql`${inspections.conformQty} + ${n.qty}`, nonConformQty: sql`${inspections.nonConformQty} - ${n.qty}` }).where(eq(inspections.id, n.fiId));
      }
      await tx.update(nonConformities).set({ status: "Traitée", decision: `${decision} – ${comment}` }).where(eq(nonConformities.id, n.id));
      await audit(tx, u, "NC", n.no, `Décision : ${decision}`, { reason: comment });
      return `${n.no} traitée.`;
    });
  });
}

export async function proposePf(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("pf.propose");
    const qty = int(fd, "qty", "Quantité", 1);
    const vins = opt(fd, "vins");
    return await db.transaction(async (tx) => {
      const f = (await tx.select().from(inspections).where(eq(inspections.id, id(fd))).for("update"))[0];
      if (qty > f.conformQty - f.pfProposedQty) throw new Error(`Quantité > conformes non encore transférées (${f.conformQty - f.pfProposedQty}).`);
      if (vins) {
        const list = vins.split(/[\s,;]+/).filter(Boolean);
        if (list.length !== qty) throw new Error(`Nombre de VIN (${list.length}) ≠ quantité (${qty}).`);
      }
      await tx.update(inspections).set({ pfProposedQty: f.pfProposedQty + qty }).where(eq(inspections.id, f.id));
      const no = await nextNo(tx, "TFP");
      await tx.insert(pfTransfers).values({ no, fiId: f.id, model: f.model, qty, vins, proposedBy: u.id });
      await audit(tx, u, "TFP", no, `Transfert conformes vers PF proposé (${f.no})`, { new: { qty, vins } });
      return `${no} proposé au gestionnaire produits finis.`;
    });
  });
}

export async function receivePf(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("pf.receive");
    const accepted = int(fd, "accepted", "Quantité acceptée");
    return await db.transaction(async (tx) => {
      const t = (await tx.select().from(pfTransfers).where(eq(pfTransfers.id, id(fd))).for("update"))[0];
      if (!t || t.status !== "En attente") throw new Error("Transfert déjà réceptionné.");
      if (accepted > t.qty) throw new Error("Quantité acceptée > quantité transférée.");
      const epf = await nextNo(tx, "EPF");
      await tx.update(pfTransfers).set({ status: "Réceptionné", acceptedQty: accepted, epfNo: epf, receivedBy: u.id, receivedAt: new Date() }).where(eq(pfTransfers.id, t.id));
      const vinList = (t.vins ?? "").split(/[\s,;]+/).filter(Boolean).slice(0, accepted);
      await move(tx, { store: "PF", model: t.model, qty: accepted, sourceType: "Entrée PF", sourceNo: `${t.no}/${epf}`, idemKey: `TFP:${t.no}`, userId: u.id, vin: vinList.length ? vinList.join(",") : null });
      if (accepted < t.qty) await tx.update(inspections).set({ pfProposedQty: sql`${inspections.pfProposedQty} - ${t.qty - accepted}` }).where(eq(inspections.id, t.fiId));
      await audit(tx, u, "TFP", t.no, `Réceptionné en stock PF (${epf})`, { new: { accepted } });
      await audit(tx, u, "EPF", epf, `Entrée stock PF depuis ${t.no}`, { new: { accepted, vins: vinList } });
      return `${epf} : ${accepted} ${t.model} entrées en stock PF.${accepted < t.qty ? ` Reliquat ${t.qty - accepted} conservé « conforme en attente de transfert ».` : ""}`;
    });
  });
}

/* ================= Retours clients ================= */
export async function createReturn(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("ret.create");
    return await db.transaction(async (tx) => {
      const no = await nextNo(tx, "RET");
      await tx.insert(customerReturns).values({ no, client: str(fd, "client", "Client"), blNo: opt(fd, "blNo"), model: str(fd, "model", "Modèle"), qty: int(fd, "qty", "Quantité", 1), vin: opt(fd, "vin"), returnDate: str(fd, "returnDate", "Date"), reason: str(fd, "reason", "Motif"), condition: str(fd, "condition", "État constaté"), savNo: opt(fd, "savNo"), createdBy: u.id });
      await audit(tx, u, "RET", no, "Retour enregistré (À examiner, sans effet stock)");
      return `${no} enregistré – en attente de décision. Aucun mouvement de stock.`;
    });
  });
}

export async function decideReturn(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("ret.decide");
    const decision = str(fd, "decision", "Décision");
    const comment = str(fd, "comment", "Contrôle de l'état / justification");
    return await db.transaction(async (tx) => {
      const r = (await tx.select().from(customerReturns).where(eq(customerReturns.id, id(fd))).for("update"))[0];
      if (!r || r.status !== "À examiner") throw new Error("Retour déjà décidé.");
      if (decision === "Réintégration disponible" && r.createdBy === u.id) throw new Error("Séparation des tâches : la réintégration doit être validée par une autre personne que celle qui a enregistré le retour.");
      if (decision === "Réintégration disponible") await move(tx, { store: "PF", model: r.model, qty: r.qty, sourceType: "Retour client – réintégration", sourceNo: r.no, idemKey: `RET:${r.no}`, userId: u.id, vin: r.vin });
      if (decision === "Quarantaine") await move(tx, { store: "PF", state: "QUARANTAINE", model: r.model, qty: r.qty, sourceType: "Retour client – quarantaine", sourceNo: r.no, idemKey: `RET:${r.no}`, userId: u.id, vin: r.vin });
      await tx.update(customerReturns).set({ status: "Décidé", decision, decisionComment: comment, decidedBy: u.id }).where(eq(customerReturns.id, r.id));
      await audit(tx, u, "RET", r.no, `Décision : ${decision}`, { reason: comment });
      return `${r.no} : ${decision}.`;
    });
  });
}

export async function closeReturn(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("ret.decide", "ret.create");
    const r = (await db.select().from(customerReturns).where(eq(customerReturns.id, id(fd))))[0];
    if (r.status !== "Décidé") throw new Error("Le retour doit être décidé avant clôture.");
    await db.update(customerReturns).set({ status: "Clôturé" }).where(and(eq(customerReturns.id, r.id), eq(customerReturns.status, "Décidé")));
    await audit(db, u, "RET", r.no, "Clôturé", { reason: opt(fd, "comment") });
    return `${r.no} clôturé.`;
  });
}
