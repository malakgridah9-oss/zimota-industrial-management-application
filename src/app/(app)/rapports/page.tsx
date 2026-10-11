import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { Card, Empty, Flash, PageHeader, Pager, SearchBar, Table, Tabs, inputCls } from "@/components/ui";
import { PrintButton } from "@/components/client";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/perms";
import { fdt } from "@/lib/core";

export const dynamic = "force-dynamic";
const B = "/rapports";
type Row = Record<string, string | number | null>;
const rows = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows as Row[];

const SEARCH: { label: string; href: (r: Row) => string; q: (s: string) => ReturnType<typeof sql> }[] = [
  { label: "Demande d'achat", href: (r) => `/achats?tab=da&id=${r.id}`, q: (s) => sql`select id, no, motif as info, status from purchase_requests where no ilike ${s} or motif ilike ${s}` },
  { label: "Bon de commande", href: (r) => `/achats?tab=bc&id=${r.id}`, q: (s) => sql`select p.id, p.no, s.name as info, p.status from purchase_orders p left join suppliers s on s.id=p.supplier_id where p.no ilike ${s} or s.name ilike ${s}` },
  { label: "Réception fournisseur", href: (r) => `/achats?tab=rcf&id=${r.id}`, q: (s) => sql`select id, no, bl_number as info, status from supplier_receipts where no ilike ${s} or bl_number ilike ${s}` },
  { label: "Facture", href: (r) => `/achats?tab=fac&id=${r.id}`, q: (s) => sql`select id, no, invoice_number as info, status from invoices where no ilike ${s} or invoice_number ilike ${s}` },
  { label: "Immobilisation", href: (r) => `/achats?tab=imm&id=${r.id}`, q: (s) => sql`select id, code as no, designation || ' ' || coalesce(serial,'') as info, assign_status as status from assets where code ilike ${s} or designation ilike ${s} or serial ilike ${s} or holder ilike ${s}` },
  { label: "Dossier import", href: (r) => `/import?id=${r.id}`, q: (s) => sql`select f.id, f.no, f.pi_number || ' ' || s.name as info, f.status from import_files f join suppliers s on s.id=f.supplier_id where f.no ilike ${s} or f.pi_number ilike ${s} or s.name ilike ${s} or f.models::text ilike ${s}` },
  { label: "Liste de colisage", href: (r) => `/import?id=${r.import_id}`, q: (s) => sql`select id, import_id, no, '' as info, status from packing_lists where no ilike ${s}` },
  { label: "Réception composants", href: (r) => `/reception?id=${r.id}`, q: (s) => sql`select id, no, lines::text as info, 'Validé' as status from receptions where no ilike ${s} or lines::text ilike ${s}` },
  { label: "Écart / réclamation", href: (r) => `/reclamations?id=${r.id}`, q: (s) => sql`select id, coalesce(claim_no, no) as no, model || ' ' || description as info, status from claims where no ilike ${s} or claim_no ilike ${s} or model ilike ${s}` },
  { label: "Bon de sortie", href: () => `/stock?tab=dem`, q: (s) => sql`select id, no, model || ' ' || coalesce(rp_no,'') as info, status from exit_slips where no ilike ${s} or rp_no ilike ${s} or model ilike ${s}` },
  { label: "Production", href: () => `/production?tab=prj`, q: (s) => sql`select id, no, model as info, status from productions where no ilike ${s} or model ilike ${s}` },
  { label: "Transfert inspection", href: () => `/production?tab=trf`, q: (s) => sql`select id, no, model as info, status from transfers where no ilike ${s}` },
  { label: "Fiche inspection", href: (r) => `/inspection?tab=fi&id=${r.id}`, q: (s) => sql`select id, no, model as info, status from inspections where no ilike ${s} or model ilike ${s}` },
  { label: "Transfert PF", href: () => `/pf?tab=rec`, q: (s) => sql`select id, no || ' ' || coalesce(epf_no,'') as no, model || ' ' || coalesce(vins,'') as info, status from pf_transfers where no ilike ${s} or epf_no ilike ${s} or vins ilike ${s}` },
  { label: "Livraison / BL", href: () => `/livraison?tab=bl`, q: (s) => sql`select id, no || ' ' || coalesce(bl_no,'') as no, sage_ref || ' – ' || client || ' – ' || model as info, status from deliveries where no ilike ${s} or bl_no ilike ${s} or sage_ref ilike ${s} or client ilike ${s} or vins ilike ${s} or model ilike ${s}` },
  { label: "Ordre de mission", href: () => `/livraison?tab=om`, q: (s) => sql`select id, no, driver || ' ' || plate as info, status from missions where no ilike ${s} or driver ilike ${s} or plate ilike ${s}` },
  { label: "Retour client", href: () => `/pf?tab=ret`, q: (s) => sql`select id, no, client || ' ' || model || ' ' || coalesce(vin,'') as info, status from customer_returns where no ilike ${s} or client ilike ${s} or vin ilike ${s}` },
  { label: "Dossier SAV", href: (r) => `/sav?id=${r.id}`, q: (s) => sql`select id, no, client || ' – ' || model || ' – ' || vin as info, status from sav_cases where no ilike ${s} or client ilike ${s} or vin ilike ${s}` },
];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const r = u.role;
  const canReports = can(r, "reports.view") || can(r, "view.all");
  const tabs = [
    { key: "search", label: "Recherche transversale", show: true },
    { key: "reports", label: "Rapports & exports", show: canReports },
    { key: "trace", label: "Traçabilité", show: canReports },
    { key: "audit", label: "Journal d'audit", show: can(r, "audit.view") },
  ].filter((t) => t.show);
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : canReports ? "reports" : "search";
  const from = sp.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = sp.to || new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader title="Rapports et statistiques" actions={<PrintButton />} />
      <Flash sp={sp} />
      <Tabs base={B} tabs={tabs} active={tab} />

      {tab === "search" && (async () => {
        const q = sp.q?.trim();
        const res = q ? (await Promise.all(SEARCH.map(async (s) => (await rows(s.q(`%${q}%`))).map((row) => ({ s, row }))))).flat() : [];
        return (
          <Card title="Recherche par numéro de document, modèle, fournisseur, client, VIN…">
            <SearchBar base={B} tab="search" q={q} />
            {!q ? <Empty>Saisissez un critère de recherche.</Empty> : <Table cols={["Type", "Numéro", "Information", "Statut", ""]} rows={res.slice(0, 200).map(({ s, row }) => [s.label, <b key="n">{row.no}</b>, <span key="i" className="text-xs">{String(row.info ?? "").slice(0, 120)}</span>, row.status, <Link key="l" className="text-red-700 underline" href={s.href(row)}>Ouvrir</Link>])} empty="Aucun résultat." />}
            {q && <p className="mt-3 text-sm"><Link className="text-red-700 underline" href={`${B}?tab=trace&vin=${encodeURIComponent(q)}`}>→ Reconstituer la traçabilité pour « {q} »</Link></p>}
          </Card>
        );
      })()}

      {tab === "reports" && (async () => {
        const [stock, achats, prod, qual, liv, sav, imp] = await Promise.all([
          rows(sql`select model, coalesce(sum(qty) filter (where store='COMP' and state='DISPONIBLE'),0)::int comp, coalesce(sum(qty) filter (where store='COMP' and state='BLOQUE'),0)::int bloque, coalesce(sum(qty) filter (where store='PROD'),0)::int prod, coalesce(sum(qty) filter (where store='PF' and state='DISPONIBLE'),0)::int pf, coalesce(sum(qty) filter (where store='PF' and state='QUARANTAINE'),0)::int quarantaine from stock_movements group by model order by model`),
          rows(sql`select status, count(*)::int n, coalesce(sum(total_ht),0)::float ht from purchase_orders where created_at::date between ${from} and ${to} group by status`),
          rows(sql`select model, sum(qty)::int produit, sum(transferred_qty)::int transfere from productions where prod_date between ${from} and ${to} group by model order by model`),
          rows(sql`select model, sum(inspected)::int insp, sum(conform)::int conf, sum(non_conform)::int nc from inspection_sessions s join inspections f on f.id=s.fi_id where s.created_at::date between ${from} and ${to} group by model`),
          rows(sql`select status, count(*)::int n, coalesce(sum(prepared_qty),0)::int q from deliveries where created_at::date between ${from} and ${to} group by status`),
          rows(sql`select status, count(*)::int n from sav_cases where created_at::date between ${from} and ${to} group by status`),
          rows(sql`select pl.model, sum(planned_qty)::int prevu, sum(received_qty)::int recu, sum(accepted_qty)::int accepte, sum(damaged_qty)::int endo, sum(cancelled_qty)::int annule from packing_lines pl group by pl.model order by pl.model`),
        ]);
        const ex = (t: string) => <a href={`/api/export?type=${t}`} className="no-print rounded-lg border px-3 py-1 text-xs">⬇ CSV / Excel</a>;
        return (
          <>
            <form className="no-print mb-4 flex flex-wrap items-end gap-2" method="get" action={B}>
              <input type="hidden" name="tab" value="reports" />
              <label className="text-xs">Du<input type="date" name="from" defaultValue={from} className={inputCls} /></label>
              <label className="text-xs">Au<input type="date" name="to" defaultValue={to} className={inputCls} /></label>
              <button className="rounded-lg border bg-white px-3 py-2 text-sm">Appliquer</button>
            </form>
            <Card title="Rapport de stock (tous stocks)" actions={ex("stock")}><Table cols={["Modèle", "Composants dispo.", "Bloqué", "Production", "PF dispo.", "Quarantaine"]} rows={stock.map((x) => [x.model, x.comp, x.bloque, x.prod, x.pf, x.quarantaine])} /></Card>
            <div className="grid gap-5 lg:grid-cols-2">
              <Card title="Achats locaux – BC par statut" actions={<div className="flex gap-1">{ex("da")}{ex("bc")}{ex("invoices")}</div>}><Table cols={["Statut", "Nombre", "Montant HT"]} rows={achats.map((x) => [x.status, x.n, Number(x.ht).toFixed(3) + " DT"])} /></Card>
              <Card title="Importations – suivi par modèle" actions={ex("imports")}><Table cols={["Modèle", "Prévu", "Reçu", "Accepté", "Endom.", "Annulé"]} rows={imp.map((x) => [x.model, x.prevu, x.recu, x.accepte, x.endo, x.annule])} /></Card>
              <Card title="Production par modèle" actions={ex("productions")}><Table cols={["Modèle", "Produit", "Transféré inspection"]} rows={prod.map((x) => [x.model, x.produit, x.transfere])} /></Card>
              <Card title="Qualité – taux de conformité" actions={ex("inspections")}><Table cols={["Modèle", "Inspectées", "Conformes", "NC", "Taux"]} rows={qual.map((x) => [x.model, x.insp, x.conf, x.nc, Number(x.insp) ? `${Math.round((Number(x.conf) / Number(x.insp)) * 100)} %` : "—"])} /></Card>
              <Card title="Livraisons par statut" actions={ex("deliveries")}><Table cols={["Statut", "Demandes", "Qté livrée"]} rows={liv.map((x) => [x.status, x.n, x.q])} /></Card>
              <Card title="SAV par statut" actions={<div className="flex gap-1">{ex("sav")}{ex("returns")}{ex("claims")}</div>}><Table cols={["Statut", "Dossiers"]} rows={sav.map((x) => [x.status, x.n])} /></Card>
            </div>
            <p className="text-xs text-slate-500">Indicateurs calculés uniquement à partir des données enregistrées ; aucune estimation n&apos;est ajoutée pour les données manquantes.</p>
          </>
        );
      })()}

      {tab === "trace" && (async () => {
        const v = sp.vin?.trim();
        if (!v) return <Card title="Traçabilité"><form method="get" action={B} className="flex gap-2"><input type="hidden" name="tab" value="trace" /><input name="vin" placeholder="VIN / châssis, n° TFP, BL, PRJ…" className={`${inputCls} max-w-md`} /><button className="rounded-lg border px-3 text-sm">Reconstituer</button></form></Card>;
        const like = `%${v}%`;
        const tfp = await rows(sql`select t.no tfp, t.epf_no, t.vins, f.no fi, tr.no trf, p.no prj, p.prod_date, b.no bs, b.rp_no, d.no dem from pf_transfers t join inspections f on f.id=t.fi_id join transfers tr on tr.id=f.trf_id join productions p on p.id=tr.prj_id left join exit_slips b on b.id=p.bs_id left join component_requests d on d.id=b.dem_id where t.vins ilike ${like} or t.no ilike ${like} or t.epf_no ilike ${like} or f.no ilike ${like} or tr.no ilike ${like} or p.no ilike ${like} or b.no ilike ${like}`);
        const dl = await rows(sql`select d.no, d.bl_no, d.sage_ref, d.client, d.status, m.no om, m.status om_status from deliveries d left join missions m on m.id=d.mission_id where d.vins ilike ${like} or d.bl_no ilike ${like} or d.no ilike ${like} or d.sage_ref ilike ${like}`);
        const rt = await rows(sql`select no, client, status, decision from customer_returns where vin ilike ${like} or no ilike ${like}`);
        const sv = await rows(sql`select id, no, client, status, production_defect from sav_cases where vin ilike ${like} or no ilike ${like}`);
        const au = await rows(sql`select created_at, user_name, doc_type, doc_no, action from audit_log where doc_no ilike ${like} or new_value ilike ${like} order by id limit 100`);
        return (
          <>
            <Card title={`Chaîne de traçabilité : ${v}`}>
              <h4 className="mb-1 text-sm font-semibold">Fabrication → inspection → stock PF</h4>
              <Table cols={["DEM", "BS / RP", "PRJ", "Date prod.", "TRF", "FI", "TFP / EPF", "VIN"]} rows={tfp.map((x) => [x.dem ?? "—", `${x.bs ?? "—"} / ${x.rp_no ?? "—"}`, x.prj, String(x.prod_date ?? ""), x.trf, x.fi, `${x.tfp} / ${x.epf_no ?? "—"}`, <span key="v" className="text-xs">{x.vins}</span>])} empty="Aucune donnée de fabrication liée." />
              <h4 className="mb-1 mt-4 text-sm font-semibold">Livraison</h4>
              <Table cols={["DLV", "BL", "Réf. Sage", "Client", "Statut", "OM", "Statut OM"]} rows={dl.map((x) => [x.no, x.bl_no, x.sage_ref, x.client, x.status, x.om, x.om_status])} empty="Aucune livraison liée." />
              <h4 className="mb-1 mt-4 text-sm font-semibold">Retours et SAV</h4>
              <Table cols={["Document", "Client", "Statut", "Décision / défaut production"]} rows={[...rt.map((x) => [x.no, x.client, x.status, x.decision]), ...sv.map((x) => [<Link key="s" className="text-red-700 underline" href={`/sav?id=${x.id}`}>{x.no}</Link>, x.client, x.status, x.production_defect ? "Défaut production" : ""])]} empty="Aucun retour / SAV." />
            </Card>
            <Card title="Événements tracés"><Table cols={["Date", "Utilisateur", "Document", "Action"]} rows={au.map((x) => [fdt(String(x.created_at)), x.user_name, `${x.doc_type} ${x.doc_no ?? ""}`, x.action])} /></Card>
          </>
        );
      })()}

      {tab === "audit" && (async () => {
        const page = Math.max(1, Number(sp.page) || 1);
        const like = `%${sp.q ?? ""}%`;
        const total = Number((await rows(sql`select count(*)::int n from audit_log where doc_no ilike ${like} or action ilike ${like} or user_name ilike ${like} or doc_type ilike ${like}`))[0].n);
        const list = await rows(sql`select * from audit_log where doc_no ilike ${like} or action ilike ${like} or user_name ilike ${like} or doc_type ilike ${like} order by id desc limit 50 offset ${(page - 1) * 50}`);
        return (
          <Card title="Journal d'audit (lecture seule)" actions={<a href="/api/export?type=audit" className="rounded-lg border px-3 py-1 text-xs">⬇ Export CSV</a>}>
            <SearchBar base={B} tab="audit" q={sp.q} />
            <Table cols={["Date/heure", "Utilisateur", "Type", "Document", "Action", "Ancienne valeur", "Nouvelle valeur", "Motif"]} rows={list.map((x) => [fdt(String(x.created_at)), x.user_name, x.doc_type, x.doc_no, x.action, <span key="o" className="block max-w-[200px] truncate text-xs text-slate-500" title={String(x.old_value ?? "")}>{x.old_value}</span>, <span key="n" className="block max-w-[260px] truncate text-xs" title={String(x.new_value ?? "")}>{x.new_value}</span>, x.reason])} />
            <Pager base={B} page={page} pages={Math.max(1, Math.ceil(total / 50))} params={{ tab: "audit", q: sp.q }} />
          </Card>
        );
      })()}
    </div>
  );
}
