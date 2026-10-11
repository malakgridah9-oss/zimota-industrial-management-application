import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getUser } from "@/lib/auth";
import { can } from "@/lib/perms";

export const dynamic = "force-dynamic";

const Q: Record<string, { perm: string[]; q: ReturnType<typeof sql> }> = {
  stock: { perm: ["stock.view", "reports.view", "view.all"], q: sql`select store as stock, state as etat, model as modele, sum(qty)::int as quantite from stock_movements group by 1,2,3 order by 1,3,2` },
  pf: { perm: ["pf.view", "reports.view", "view.all"], q: sql`select model as modele, state as etat, sum(qty)::int as quantite from stock_movements where store='PF' group by 1,2 order by 1` },
  movements: { perm: ["stock.view", "reports.view", "view.all"], q: sql`select m.created_at as date, store as stock, state as etat, model as modele, qty as quantite, source_type as type, source_no as document, location as emplacement, vin, u.full_name as utilisateur from stock_movements m left join users u on u.id=m.user_id order by m.id desc` },
  deliveries: { perm: ["dlv.create", "reports.view", "view.all"], q: sql`select no, bl_no as bl, sage_ref as ref_sage, client, address as adresse, model as modele, qty as qte_demandee, prepared_qty as qte_livree, vins, status as statut, bl_at as date_bl from deliveries order by id desc` },
  assets: { perm: ["asset.manage", "reports.view", "view.all"], q: sql`select code, designation, brand as marque, model as modele, serial as num_serie, acquisition_date as acquisition, refs as references, service, location as emplacement, holder as detenteur, condition as etat, assign_status as statut from assets order by id` },
  da: { perm: ["reports.view", "view.all"], q: sql`select d.no, d.created_at as date, u.full_name as demandeur, d.service, d.need_type as type, d.motif, d.urgency as urgence, d.status as statut from purchase_requests d left join users u on u.id=d.requester_id order by d.id desc` },
  bc: { perm: ["reports.view", "view.all"], q: sql`select p.no, p.created_at as date, s.name as fournisseur, p.total_ht as ht, p.total_tva as tva, p.stamp as timbre, p.total_ttc as ttc, p.status as statut, p.delivery_date as livraison from purchase_orders p left join suppliers s on s.id=p.supplier_id order by p.id desc` },
  invoices: { perm: ["reports.view", "view.all"], q: sql`select i.no, i.invoice_number as facture, i.invoice_date as date, s.name as fournisseur, i.ht, i.tva, i.stamp as timbre, i.ttc, i.status as statut from invoices i left join suppliers s on s.id=i.supplier_id order by i.id desc` },
  imports: { perm: ["reports.view", "view.all"], q: sql`select f.no, s.name as fournisseur, f.pi_number as pi, f.pi_date as date_pi, l.no as liste, pl.model as modele, pl.planned_qty as prevu, pl.cancelled_qty as annule, pl.received_qty as recu, pl.accepted_qty as accepte, pl.damaged_qty as endommage, (pl.planned_qty-pl.cancelled_qty-pl.received_qty) as restant, f.status as statut from import_files f join suppliers s on s.id=f.supplier_id left join packing_lists l on l.import_id=f.id left join packing_lines pl on pl.list_id=l.id order by f.id desc` },
  productions: { perm: ["reports.view", "view.all"], q: sql`select no, prod_date as date, model as modele, qty as produit, transferred_qty as transfere, team as equipe, components_used as composants from productions order by id desc` },
  inspections: { perm: ["reports.view", "view.all"], q: sql`select no, model as modele, received_qty as recues, inspected_qty as inspectees, conform_qty as conformes, non_conform_qty as non_conformes, status as statut from inspections order by id desc` },
  claims: { perm: ["reports.view", "view.all"], q: sql`select no as ecart, claim_no as reclamation, model as modele, qty as quantite, description, status as statut, decision from claims order by id desc` },
  returns: { perm: ["reports.view", "view.all"], q: sql`select no, return_date as date, client, bl_no as bl, model as modele, qty as quantite, vin, reason as motif, status as statut, decision from customer_returns order by id desc` },
  sav: { perm: ["reports.view", "view.all", "sav.manage"], q: sql`select no, created_at as date, client, model as modele, vin, km, priority as priorite, status as statut, production_defect as defaut_production from sav_cases order by id desc` },
  audit: { perm: ["audit.view"], q: sql`select created_at as date, user_name as utilisateur, doc_type as type, doc_no as document, action, old_value as ancien, new_value as nouveau, reason as motif from audit_log order by id desc limit 20000` },
};

export async function GET(req: Request) {
  const u = await getUser();
  if (!u) return new Response("Non autorisé", { status: 401 });
  const type = new URL(req.url).searchParams.get("type") ?? "";
  const def = Q[type];
  if (!def) return new Response("Type inconnu", { status: 400 });
  if (!def.perm.some((p) => can(u.role, p))) return new Response("Accès refusé", { status: 403 });
  const r = await db.execute(def.q);
  const rows = r.rows as Record<string, unknown>[];
  const cols = r.fields?.map((f) => f.name) ?? Object.keys(rows[0] ?? {});
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = v instanceof Date ? v.toLocaleString("fr-FR") : typeof v === "number" ? String(v).replace(".", ",") : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "\uFEFF" + [cols.join(";"), ...rows.map((row) => cols.map((c) => esc(row[c])).join(";"))].join("\r\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="zimota-${type}-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
