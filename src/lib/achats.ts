import { inArray, ne, and, eq } from "drizzle-orm";
import { db } from "@/db";
import { invoices, purchaseOrderLines, purchaseOrders, supplierReceipts } from "@/db/schema";

export function lineAmounts(l: { qty: number; unitPrice: number; discount: number; tva: number }) {
  const ht = l.qty * l.unitPrice * (1 - l.discount / 100);
  const tva = ht * (l.tva / 100);
  return { ht, tva };
}

export function poTotals(lines: { qty: number; unitPrice: number; discount: number; tva: number }[], stamp: number) {
  let ht = 0, tva = 0;
  for (const l of lines) {
    const a = lineAmounts(l);
    ht += a.ht;
    tva += a.tva;
  }
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return { ht: r(ht), tva: r(tva), ttc: r(ht + tva + stamp) };
}

/** Rapprochement facture ↔ BC ↔ BL : retourne la liste des anomalies. */
export async function matchInvoice(inv: { id?: number; supplierId: number; poIds: number[]; receiptIds: number[]; ht: number; tva: number; stamp: number; ttc: number }) {
  const issues: string[] = [];
  if (!inv.poIds.length) return ["Aucun BC associé"];
  const pos = await db.select().from(purchaseOrders).where(inArray(purchaseOrders.id, inv.poIds));
  const lines = await db.select().from(purchaseOrderLines).where(inArray(purchaseOrderLines.poId, inv.poIds));
  const rcs = inv.receiptIds.length ? await db.select().from(supplierReceipts).where(inArray(supplierReceipts.id, inv.receiptIds)) : [];
  for (const p of pos) {
    if (p.supplierId !== inv.supplierId) issues.push(`Fournisseur différent sur ${p.no}`);
    if (!["Validé", "Émis", "Partiellement reçu", "Entièrement reçu", "Clôturé"].includes(p.status)) issues.push(`${p.no} non validé (${p.status})`);
  }
  if (!rcs.length) issues.push("Aucun BL / réception associé (pièce manquante)");
  for (const r of rcs) {
    if (!inv.poIds.includes(r.poId)) issues.push(`BL ${r.blNumber} n'appartient pas aux BC sélectionnés`);
    if (!["Reçu conforme", "Régularisé"].includes(r.status)) issues.push(`Réception ${r.no} non conforme/non confirmée (${r.status})`);
  }
  // received amount (valued at BC prices) vs invoiced
  let receivedHt = 0, orderedHt = 0;
  for (const l of lines) {
    const p = l.unitPrice * (1 - l.discount / 100);
    receivedHt += l.receivedQty * p;
    orderedHt += l.qty * p;
  }
  // amounts already invoiced on the same BC (avoid double counting)
  const others = await db.select().from(invoices).where(and(inv.id ? ne(invoices.id, inv.id) : undefined, ne(invoices.status, "Annulée")));
  const already = others.filter((o) => o.poIds.some((x) => inv.poIds.includes(x))).reduce((s, o) => s + o.ht, 0);
  const eps = 0.0015;
  if (inv.ht + already > orderedHt + eps) issues.push(`Montant HT facturé cumulé (${(inv.ht + already).toFixed(3)}) > montant commandé (${orderedHt.toFixed(3)}) – écart de prix ou double facturation`);
  if (inv.ht + already > receivedHt + eps) issues.push(`Montant HT facturé cumulé (${(inv.ht + already).toFixed(3)}) > valeur réceptionnée (${receivedHt.toFixed(3)}) – écart de quantité`);
  if (Math.abs(inv.ht + inv.tva + inv.stamp - inv.ttc) > eps) issues.push("TTC ≠ HT + TVA + timbre");
  return issues;
}

export async function receiptPendingQty(poLineId: number, poId: number) {
  const pend = await db.select().from(supplierReceipts).where(and(eq(supplierReceipts.poId, poId), eq(supplierReceipts.status, "En attente de réception")));
  return pend.reduce((s, r) => s + r.lines.filter((l) => l.poLineId === poLineId).reduce((a, l) => a + l.qty, 0), 0);
}
