"use server";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { deliveries, missions, users } from "@/db/schema";
import { requirePerm } from "@/lib/auth";
import { act, audit, balance, getSetting, id, int, lockStock, move, nextNo, opt, reservedPf, str, type Tx } from "@/lib/core";
import { can } from "@/lib/perms";

async function freePf(tx: Tx, model: string, excludeQty = 0) {
  await lockStock(tx, "PF", model);
  return (await balance(tx, "PF", model)) - (await reservedPf(tx, model)) + excludeQty;
}

export async function createDlv(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("dlv.create");
    const qty = int(fd, "qty", "Quantité", 1);
    const model = str(fd, "model", "Modèle");
    const reserve = fd.get("reserve") === "on";
    return await db.transaction(async (tx) => {
      if (reserve) {
        const free = await freePf(tx, model);
        if (qty > free) throw new Error(`Stock PF libre insuffisant pour ${model} : ${free}.`);
      }
      const no = await nextNo(tx, "DLV");
      await tx.insert(deliveries).values({ no, client: str(fd, "client", "Client"), address: str(fd, "address", "Adresse"), sageRef: str(fd, "sageRef", "Référence commerciale Sage"), model, qty, wantedDate: opt(fd, "wantedDate"), reserved: reserve, status: reserve ? "Réservée" : "À préparer", createdBy: u.id });
      await audit(tx, u, "DLV", no, reserve ? "Demande créée et stock réservé" : "Demande de livraison créée");
      return `${no} créée${reserve ? " – stock réservé" : ""}.`;
    });
  });
}

export async function prepareDlv(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("dlv.validate");
    const prepared = int(fd, "preparedQty", "Quantité préparée", 1);
    const vinTracking = (await getSetting("vin_tracking")) === "1";
    return await db.transaction(async (tx) => {
      const d = (await tx.select().from(deliveries).where(eq(deliveries.id, id(fd))).for("update"))[0];
      if (!d || !["À préparer", "Réservée", "Préparée"].includes(d.status)) throw new Error("Livraison non préparable.");
      if (prepared > d.qty) throw new Error("Quantité préparée > quantité demandée.");
      const free = await freePf(tx, d.model, d.reserved ? d.qty : 0);
      if (prepared > free) throw new Error(`Stock PF disponible insuffisant : ${free}.`);
      const vins = opt(fd, "vins");
      if (vins) {
        const list = vins.split(/[\s,;]+/).filter(Boolean);
        if (list.length !== prepared) throw new Error(`Nombre de VIN (${list.length}) ≠ quantité préparée (${prepared}).`);
        for (const v of list) {
          const r = await tx.execute(sql`select coalesce(sum(case when qty>0 then 1 else -1 end),0)::int n from stock_movements where store='PF' and state='DISPONIBLE' and model=${d.model} and (',' || vin || ',') like ${"%," + v + ",%"}`);
          if (Number((r.rows[0] as { n: number }).n) <= 0) throw new Error(`VIN ${v} non disponible / non conforme en stock PF pour ${d.model}.`);
        }
      } else if (vinTracking && fd.get("requireVin") === "1") throw new Error("Suivi VIN activé : saisissez les VIN livrés.");
      await tx.update(deliveries).set({ preparedQty: prepared, vins, transportInfo: opt(fd, "transportInfo"), status: "Préparée", reserved: true, qty: d.qty }).where(eq(deliveries.id, d.id));
      await audit(tx, u, "DLV", d.no, "Préparée", { new: { prepared, vins } });
      return `${d.no} préparée.`;
    });
  });
}

export async function validateExit(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("dlv.validate");
    return await db.transaction(async (tx) => {
      const d = (await tx.select().from(deliveries).where(eq(deliveries.id, id(fd))).for("update"))[0];
      if (!d || d.blNo) throw new Error("Le BL a déjà été généré pour cette sortie.");
      if (d.status !== "Préparée" || !d.preparedQty) throw new Error("La livraison doit être préparée.");
      const bl = await nextNo(tx, "BL");
      const r = await tx.update(deliveries).set({ blNo: bl, blAt: new Date(), status: "BL généré", reserved: false, qty: d.qty }).where(and(eq(deliveries.id, d.id), isNull(deliveries.blNo))).returning();
      if (!r.length) throw new Error("Double validation détectée.");
      await move(tx, { store: "PF", model: d.model, qty: -d.preparedQty, sourceType: "Livraison", sourceNo: `${d.no}/${bl}`, idemKey: `DLV:${d.no}`, userId: u.id, vin: d.vins });
      await audit(tx, u, "DLV", d.no, `Sortie validée – ${bl} généré`, { new: { qty: d.preparedQty } });
      await audit(tx, u, "BL", bl, `BL généré pour ${d.no} (réf. Sage ${d.sageRef})`);
      return `${bl} généré et sortie de stock enregistrée (une seule fois).`;
    });
  });
}

export async function cancelDlv(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("dlv.validate", "dlv.create");
    const reason = str(fd, "reason", "Motif");
    const d = (await db.select().from(deliveries).where(eq(deliveries.id, id(fd))))[0];
    if (d.blNo) throw new Error("BL déjà généré : utilisez un retour client.");
    await db.update(deliveries).set({ status: "Annulée", reserved: false }).where(eq(deliveries.id, d.id));
    await audit(db, u, "DLV", d.no, "Annulée", { reason });
    return `${d.no} annulée, réservation libérée.`;
  });
}

export async function createOm(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("om.manage");
    const ids = fd.getAll("dlv").map(Number).filter(Boolean);
    if (!ids.length) throw new Error("Sélectionnez au moins une référence commerciale Sage.");
    const driverUserId = Number(fd.get("driverUserId") || 0) || null;
    let driver = opt(fd, "driver");
    if (driverUserId && !driver) driver = (await db.select().from(users).where(eq(users.id, driverUserId)))[0]?.fullName ?? null;
    if (!driver) throw new Error("Chauffeur obligatoire.");
    return await db.transaction(async (tx) => {
      const no = await nextNo(tx, "OM");
      const m = await tx.insert(missions).values({ no, deliveryIds: ids, departure: str(fd, "departure", "Date et heure de départ"), driver: driver!, driverPhone: opt(fd, "driverPhone"), vehicle: opt(fd, "vehicle"), plate: str(fd, "plate", "Immatriculation"), carrier: opt(fd, "carrier"), instructions: opt(fd, "instructions"), driverUserId, createdBy: u.id }).returning({ id: missions.id });
      const upd = await tx.update(deliveries).set({ missionId: m[0].id }).where(and(inArray(deliveries.id, ids), isNull(deliveries.missionId), sql`${deliveries.blNo} is not null`)).returning({ id: deliveries.id, sageRef: deliveries.sageRef });
      if (upd.length !== ids.length) throw new Error("Une ou plusieurs références possèdent déjà un ordre de mission.");
      await audit(tx, u, "OM", no, "Ordre de mission créé", { new: { sage: upd.map((x) => x.sageRef), driver } });
      return { msg: `${no} créé. Aucune nouvelle sortie de stock (déjà enregistrée au BL).`, to: `/print/om/${m[0].id}` };
    });
  });
}

export async function updateOm(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm("om.manage", "om.driver");
    const status = str(fd, "status");
    return await db.transaction(async (tx) => {
      const m = (await tx.select().from(missions).where(eq(missions.id, id(fd))).for("update"))[0];
      if (!m || ["Annulé", "Livré"].includes(m.status)) throw new Error("Mission verrouillée.");
      if (!can(u.role, "om.manage") && m.driverUserId !== u.id) throw new Error("Mission non affectée à votre compte.");
      if (status === "Annulé" && !can(u.role, "om.manage")) throw new Error("Seul le responsable peut annuler une mission.");
      const proof = opt(fd, "proof"), incident = opt(fd, "incident"), reason = opt(fd, "reason");
      if (status === "Livré" && !proof) throw new Error("Le statut « Livré » exige une confirmation / signature / preuve de remise.");
      if (status === "Incident" && !incident) throw new Error("Décrivez l'incident.");
      if (status === "Annulé" && !reason) throw new Error("Motif d'annulation obligatoire.");
      if (!["En cours", "Livré", "Incident", "Annulé"].includes(status)) throw new Error("Statut invalide.");
      await tx.update(missions).set({ status, proof: proof ?? m.proof, incident: incident ?? m.incident }).where(eq(missions.id, m.id));
      const dlvStatus: Record<string, string> = { "En cours": "Expédiée", Livré: "Livrée", Incident: "Incident" };
      if (status === "Annulé") await tx.update(deliveries).set({ missionId: null, status: "BL généré" }).where(eq(deliveries.missionId, m.id));
      else await tx.update(deliveries).set({ status: dlvStatus[status] }).where(eq(deliveries.missionId, m.id));
      await audit(tx, u, "OM", m.no, `Statut : ${status}`, { old: m.status, new: status, reason: proof ?? incident ?? reason });
      if (status === "Annulé") {
        const ds = await tx.select().from(deliveries).where(inArray(deliveries.id, m.deliveryIds));
        for (const d of ds) await audit(tx, u, "ALERTE", d.sageRef, `Mission ${m.no} annulée – référence Sage à replanifier`, { reason });
      }
      return `${m.no} : ${status}.`;
    });
  });
}
