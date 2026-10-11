import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { customerReturns, motoModels, pfTransfers, stockMovements, users } from "@/db/schema";
import { Back, Badge, Card, Extra, Field, Flash, Grid, PageHeader, Pager, Stat, StatGrid, Table, Tabs, inputCls, paginate } from "@/components/ui";
import { Submit } from "@/components/client";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/perms";
import { fdate, fdt, today } from "@/lib/core";
import { closeReturn, createReturn, decideReturn, receivePf } from "../ops-actions";

export const dynamic = "force-dynamic";
const B = "/pf";

export default async function PfPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const r = u.role;
  const tab = ["rec", "stock", "mvt", "ret"].includes(sp.tab ?? "") ? sp.tab! : can(r, "pf.receive") || can(r, "pf.view") || can(r, "view.all") ? "rec" : "ret";
  const back = `${B}?tab=${tab}`;
  const [us, models, tfps, rets] = await Promise.all([db.select().from(users), db.select().from(motoModels), db.select().from(pfTransfers).orderBy(desc(pfTransfers.id)), db.select().from(customerReturns).orderBy(desc(customerReturns.id))]);
  const uname = (i: number | null) => us.find((x) => x.id === i)?.fullName ?? "—";
  const bal = (await db.execute(sql`select state, model, sum(qty)::int q from stock_movements where store='PF' group by state, model`)).rows as { state: string; model: string; q: number }[];
  const res = (await db.execute(sql`select model, sum(qty)::int q from deliveries where reserved and bl_no is null and status<>'Annulée' group by model`)).rows as { model: string; q: number }[];
  const g = (st: string, m: string) => Number(bal.find((b) => b.state === st && b.model === m)?.q ?? 0);
  const rv = (m: string) => Number(res.find((x) => x.model === m)?.q ?? 0);
  const rows = models.map((m) => ({ m: m.code, d: g("DISPONIBLE", m.code), r: rv(m.code), q: g("QUARANTAINE", m.code) })).filter((x) => x.d || x.r || x.q);

  return (
    <div>
      <PageHeader title="Stock des produits finis" subtitle="Entrées acceptées · réservations · sorties livraison · retours décidés" />
      <Flash sp={sp} />
      <StatGrid>
        <Stat label="Transferts à réceptionner" value={tfps.filter((t) => t.status === "En attente").length} href={`${B}?tab=rec`} tone="blue" />
        <Stat label="PF disponibles" value={rows.reduce((s, x) => s + x.d, 0)} href={`${B}?tab=stock`} tone="green" />
        <Stat label="Réservés livraison" value={rows.reduce((s, x) => s + x.r, 0)} tone="amber" />
        <Stat label="Libres à la vente" value={rows.reduce((s, x) => s + x.d - x.r, 0)} tone="green" />
        <Stat label="Quarantaine (non vendable)" value={rows.reduce((s, x) => s + x.q, 0)} tone="red" />
        <Stat label="Retours à décider" value={rets.filter((x) => x.status === "À examiner").length} href={`${B}?tab=ret`} tone="red" />
      </StatGrid>
      <Tabs base={B} active={tab} tabs={[{ key: "rec", label: "Réception PF", count: tfps.filter((t) => t.status === "En attente").length }, { key: "stock", label: "Stock PF" }, { key: "mvt", label: "Historique" }, { key: "ret", label: "Retours clients", count: rets.filter((x) => x.status === "À examiner").length }]} />

      {tab === "rec" && (
        <Card title="Transferts conformes à réceptionner">
          <Table cols={["TFP", "Modèle", "Qté proposée", "VIN", "Proposé par", "Date", "Réception"]} rows={tfps.filter((t) => t.status === "En attente").map((t) => [<b key="n">{t.no}</b>, t.model, t.qty, <span key="v" className="text-xs">{t.vins ?? "—"}</span>, uname(t.proposedBy), fdt(t.createdAt),
            can(r, "pf.receive") ? <form key="f" action={receivePf} className="flex gap-1"><Back to={back} /><input type="hidden" name="id" value={t.id} /><input name="accepted" defaultValue={t.qty} className={`${inputCls} w-20`} /><Submit small variant="success" confirm={`Confirmer l'entrée en stock PF de ${t.model} ?`}>Accepter</Submit></form> : ""])} empty="Aucun transfert en attente." />
          <h4 className="mb-2 mt-5 text-sm font-semibold">Entrées réalisées (EPF)</h4>
          <Table cols={["EPF", "TFP", "Modèle", "Proposé", "Accepté", "Reçu par", "Date"]} rows={tfps.filter((t) => t.epfNo).map((t) => [t.epfNo, t.no, t.model, t.qty, t.acceptedQty, uname(t.receivedBy), fdt(t.receivedAt)])} />
        </Card>
      )}

      {tab === "stock" && (async () => {
        const vins = (await db.execute(sql`select model, string_agg(vin, ',') v from stock_movements where store='PF' and vin is not null group by model`)).rows as { model: string; v: string }[];
        return (
          <Card title="Stock PF par modèle" actions={<a href="/api/export?type=pf" className="rounded-lg border px-3 py-1.5 text-sm">⬇ Export CSV</a>}>
            <Table cols={["Modèle", "Disponible", "Réservé", "Libre", "Quarantaine", "VIN tracés"]} rows={rows.map((x) => [<b key="m">{x.m}</b>, x.d, x.r, <b key="l">{x.d - x.r}</b>, x.q ? <span key="q" className="text-red-700">{x.q}</span> : 0, <span key="v" className="text-xs text-slate-500">{vins.find((v) => v.model === x.m)?.v ?? "—"}</span>])} />
          </Card>
        );
      })()}

      {tab === "mvt" && (async () => {
        const mv = await db.select().from(stockMovements).where(eq(stockMovements.store, "PF")).orderBy(desc(stockMovements.id));
        const pg = paginate(mv, Number(sp.page), 30);
        return (
          <Card title="Historique PF (entrées, sorties, retours, ajustements)">
            <Table cols={["Date", "État", "Modèle", "Qté", "Source", "Type", "VIN", "Utilisateur"]} rows={pg.items.map((m) => [fdt(m.createdAt), m.state, m.model, <b key="q" className={m.qty < 0 ? "text-red-700" : "text-emerald-700"}>{m.qty}</b>, m.sourceNo, m.sourceType, m.vin, uname(m.userId)])} />
            <Pager base={B} page={pg.page} pages={pg.pages} params={{ tab: "mvt" }} />
          </Card>
        );
      })()}

      {tab === "ret" && (
        <>
          {can(r, "ret.create") && (
            <Card title="+ Nouveau retour client">
              <form action={createReturn} className="space-y-3"><Back to={back} />
                <Grid cols={4}>
                  <Field label="Client" required><input name="client" required className={inputCls} /></Field>
                  <Field label="Modèle" required><select name="model" className={inputCls}>{models.map((m) => <option key={m.id}>{m.code}</option>)}</select></Field>
                  <Field label="Quantité" required><input name="qty" defaultValue={1} className={inputCls} /></Field>
                  <Field label="Date" required><input type="date" name="returnDate" defaultValue={today()} className={inputCls} /></Field>
                  <Field label="Motif" required className="md:col-span-2"><input name="reason" required className={inputCls} /></Field>
                  <Field label="État constaté" required className="md:col-span-2"><input name="condition" required className={inputCls} /></Field>
                </Grid>
                <Extra><Grid cols={3}><Field label="N° BL (si disponible)"><input name="blNo" className={inputCls} /></Field><Field label="VIN / châssis"><input name="vin" className={inputCls} /></Field><Field label="Dossier SAV lié"><input name="savNo" className={inputCls} /></Field></Grid></Extra>
                <Submit>Enregistrer le retour (sans effet stock)</Submit>
              </form>
            </Card>
          )}
          <Card title="Retours clients">
            <Table cols={["RET", "Date", "Client", "BL", "Modèle", "Qté", "VIN", "Motif / état", "Statut", "Décision"]} rows={rets.map((x) => [<b key="n">{x.no}</b>, fdate(x.returnDate), x.client, x.blNo, x.model, x.qty, x.vin, <span key="m" className="text-xs">{x.reason} / {x.condition}</span>, <Badge key="s" s={x.status} />,
              x.status === "À examiner" && can(r, "ret.decide") ? <form key="f" action={decideReturn} className="flex flex-col gap-1"><Back to={back} /><input type="hidden" name="id" value={x.id} /><select name="decision" className={inputCls}><option>Quarantaine</option><option>Réintégration disponible</option><option>Réparation (SAV)</option><option>Remplacement</option><option>Autre décision documentée</option></select><input name="comment" placeholder="Contrôle de l'état / justification *" className={inputCls} /><Submit small confirm="Confirmer la décision ? Un mouvement de stock sera créé uniquement pour réintégration ou quarantaine.">Décider</Submit></form>
                : x.status === "Décidé" ? <div key="d"><div className="text-xs">{x.decision} – {x.decisionComment}</div>{(can(r, "ret.decide") || can(r, "ret.create")) && <form action={closeReturn} className="mt-1"><Back to={back} /><input type="hidden" name="id" value={x.id} /><Submit small variant="secondary">Clôturer</Submit></form>}</div> : <span key="d" className="text-xs">{x.decision}</span>])} />
          </Card>
        </>
      )}
    </div>
  );
}
