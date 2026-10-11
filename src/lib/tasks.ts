import { sql } from "drizzle-orm";
import { db } from "@/db";
import { can } from "./perms";
import type { CurrentUser } from "./auth";

export type Task = { label: string; count: number; href: string; tone?: string };

async function n(q: ReturnType<typeof sql>): Promise<number> {
  const r = await db.execute(q);
  return Number((r.rows[0] as { n: number } | undefined)?.n ?? 0);
}

export async function getTasks(u: CurrentUser): Promise<Task[]> {
  const r = u.role;
  const all = can(r, "view.all");
  const t: Task[] = [];
  const add = async (cond: boolean, label: string, href: string, q: ReturnType<typeof sql>, tone = "amber") => {
    if (!cond) return;
    const c = await n(q);
    if (c > 0) t.push({ label, count: c, href, tone });
  };
  await add(can(r, "da.create") && !can(r, "da.process"), "Mes DA à corriger", "/achats?tab=da", sql`select count(*)::int n from purchase_requests where requester_id=${u.id} and status='À corriger'`, "red");
  await add(can(r, "da.process") || all, "DA soumises à examiner", "/achats?tab=da", sql`select count(*)::int n from purchase_requests where status in ('Soumise','En cours de vérification')`);
  await add(can(r, "bc.manage") || all, "DA acceptées non commandées", "/achats?tab=bc", sql`select count(distinct da_id)::int n from purchase_request_lines l join purchase_requests d on d.id=l.da_id where d.status in ('Acceptée pour traitement','Partiellement commandée') and l.ordered_qty < l.qty`);
  await add(can(r, "bc.validate") || all, "BC en attente de validation", "/achats?tab=bc", sql`select count(*)::int n from purchase_orders where status in ('En attente de validation','À revalider')`, "red");
  await add(can(r, "bc.manage"), "BC validés à émettre", "/achats?tab=bc", sql`select count(*)::int n from purchase_orders where status='Validé'`);
  await add(can(r, "rcf.confirm") || all, "Réceptions fournisseur à confirmer", "/achats?tab=rcf", sql`select count(*)::int n from supplier_receipts where status='En attente de réception'`);
  await add(can(r, "inv.manage") || all, "Réceptions avec anomalie", "/achats?tab=rcf", sql`select count(*)::int n from supplier_receipts where status in ('Réception avec anomalie','En cours de régularisation')`, "red");
  await add(can(r, "inv.daf") || all, "Dossiers transmis au DAF", "/achats?tab=fac", sql`select count(*)::int n from invoices where status='Transmise au DAF'`);
  await add(can(r, "asset.manage") || all, "Immobilisations non affectées / non justifiées", "/achats?tab=imm", sql`select count(*)::int n from assets where assign_status in ('Non affecté','Affectation non justifiée')`);
  await add(can(r, "imp.validate") || all, "Listes de colisage à valider", "/import", sql`select count(*)::int n from packing_lists where status='À valider'`, "red");
  await add(can(r, "rec.create") || all, "Listes validées à réceptionner", "/reception", sql`select count(distinct l.id)::int n from packing_lists l join packing_lines p on p.list_id=l.id join import_files f on f.id=l.import_id where l.status='Validée' and f.status='Validé' and p.planned_qty - p.cancelled_qty - p.received_qty > 0`);
  await add(can(r, "claim.manage") || all, "Écarts / réclamations ouverts", "/reclamations", sql`select count(*)::int n from claims where status not in ('Clôturée')`, "red");
  await add(can(r, "claim.decide"), "Décisions de réclamation à valider", "/reclamations", sql`select count(*)::int n from claims where status='Décision à valider'`, "red");
  await add(can(r, "adj.validate") || all, "Ajustements à valider", "/stock?tab=adj", sql`select count(*)::int n from adjustments where status='À valider' and requested_by<>${u.id}`, "red");
  await add(can(r, "bs.prepare") || all, "Demandes de composants à préparer", "/stock?tab=dem", sql`select count(*)::int n from component_requests where status in ('À préparer','Partiellement préparée')`);
  await add(can(r, "bs.receive") || all, "Bons de sortie à réceptionner", "/production?tab=bs", sql`select count(*)::int n from exit_slips where status='Émis'`);
  await add(can(r, "trf.create") || all, "Motos produites à transférer en inspection", "/production?tab=trf", sql`select coalesce(sum(qty-transferred_qty),0)::int n from productions`);
  await add(can(r, "trf.receive") || all, "Transferts à réceptionner (qualité)", "/inspection?tab=trf", sql`select count(*)::int n from transfers where status='En attente'`);
  await add(can(r, "insp.do") || all, "Fiches d'inspection ouvertes", "/inspection", sql`select count(*)::int n from inspections where status in ('À inspecter','En cours')`);
  await add(can(r, "pf.propose") || all, "Conformes en attente de transfert PF", "/inspection?tab=pf", sql`select coalesce(sum(conform_qty-pf_proposed_qty),0)::int n from inspections`);
  await add(can(r, "pf.receive") || all, "Transferts PF à réceptionner", "/pf", sql`select count(*)::int n from pf_transfers where status='En attente'`);
  await add(can(r, "dlv.validate") || all, "Livraisons à préparer / valider", "/livraison", sql`select count(*)::int n from deliveries where status in ('À préparer','Réservée','Préparée')`);
  await add(can(r, "om.manage") || all, "Références Sage sans ordre de mission", "/livraison?tab=om", sql`select count(*)::int n from deliveries where bl_no is not null and mission_id is null`);
  await add(can(r, "om.driver"), "Mes missions en cours", "/livraison?tab=om", sql`select count(*)::int n from missions where driver_user_id=${u.id} and status in ('Planifiée','En cours')`);
  await add(can(r, "ret.decide") || all, "Retours clients à décider", "/pf?tab=ret", sql`select count(*)::int n from customer_returns where status='À examiner'`, "red");
  await add(can(r, "sav.manage") || all, "Dossiers SAV ouverts", "/sav", sql`select count(*)::int n from sav_cases where status not in ('Clôturé')`);
  await add(can(r, "exc.decide"), "Autorisations exceptionnelles à décider", "/admin?tab=exc", sql`select count(*)::int n from exception_requests where status='À valider' and requested_by<>${u.id}`, "red");
  return t;
}
