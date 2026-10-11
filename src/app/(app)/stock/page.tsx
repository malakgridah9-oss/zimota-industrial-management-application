import Link from "next/link";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { adjustments, componentRequests, exitSlips, motoModels, stockMovements, users } from "@/db/schema";
import { Back, Badge, Card, Field, Flash, Grid, PageHeader, Pager, SearchBar, Stat, StatGrid, Table, Tabs, inputCls, match, paginate } from "@/components/ui";
import { Submit } from "@/components/client";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/perms";
import { fdate, fdt, today } from "@/lib/core";
import { createBs, createDem, decideAdjustment, requestAdjustment } from "../ops-actions";

export const dynamic = "force-dynamic";
const B = "/stock";

export default async function StockPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const r = u.role;
  const all = can(r, "view.all");
  const tabs = [
    { key: "stock", label: "Stock composants", show: can(r, "stock.view") || all },
    { key: "mvt", label: "Mouvements", show: can(r, "stock.view") || all },
    { key: "dem", label: "Demandes & bons de sortie", show: can(r, "bs.prepare") || can(r, "dem.create") || all },
    { key: "adj", label: "Ajustements", show: can(r, "adj.request") || can(r, "adj.validate") || all },
  ].filter((t) => t.show);
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : tabs[0]?.key ?? "stock";
  const [models, us] = await Promise.all([db.select().from(motoModels), db.select().from(users)]);
  const uname = (i: number | null) => us.find((x) => x.id === i)?.fullName ?? "—";
  const back = `${B}?tab=${tab}`;

  const bal = (await db.execute(sql`select store, state, model, coalesce(sum(qty),0)::int q from stock_movements group by store, state, model`)).rows as { store: string; state: string; model: string; q: number }[];
  const g = (store: string, state: string, model: string) => Number(bal.find((b) => b.store === store && b.state === state && b.model === model)?.q ?? 0);
  const slips = await db.select().from(exitSlips).orderBy(desc(exitSlips.id));
  const reserved = (m: string) => slips.filter((s) => s.model === m && s.status === "Émis").reduce((a, s) => a + s.qty, 0);

  return (
    <div>
      <PageHeader title="Gestion des stocks" subtitle="Disponible = entrées acceptées − sorties validées ± ajustements validés · Réservé = BS émis non réceptionnés" />
      <Flash sp={sp} />
      <Tabs base={B} tabs={tabs} active={tab} />

      {tab === "stock" && (async () => {
        const rows = models.filter((m) => m.active).map((m) => ({ m, disp: g("COMP", "DISPONIBLE", m.code), res: reserved(m.code), blq: g("COMP", "BLOQUE", m.code), prod: g("PROD", "DISPONIBLE", m.code) }));
        return (
          <>
            <StatGrid>
              <Stat label="Disponible (physique)" value={rows.reduce((s, x) => s + x.disp, 0)} tone="green" />
              <Stat label="Réservé (BS émis)" value={rows.reduce((s, x) => s + x.res, 0)} tone="blue" />
              <Stat label="Bloqué / endommagé" value={rows.reduce((s, x) => s + x.blq, 0)} tone="red" />
              <Stat label="En stock production" value={rows.reduce((s, x) => s + x.prod, 0)} />
              <Stat label="Modèles en rupture" value={rows.filter((x) => x.disp - x.res <= 0).length} tone="red" />
              <Stat label="Modèles stock faible" value={rows.filter((x) => x.disp - x.res > 0 && x.disp - x.res < x.m.lowStock).length} tone="amber" />
            </StatGrid>
            <Card title="Stock par modèle" actions={<a href="/api/export?type=stock" className="rounded-lg border px-3 py-1.5 text-sm">⬇ Export CSV</a>}>
              <Table cols={["Modèle", "Disponible physique", "Réservé", "Libre", "Bloqué", "Stock production", "Seuil", "Alerte"]} rows={rows.map((x) => [<b key="m">{x.m.code}</b>, x.disp, x.res, <b key="l">{x.disp - x.res}</b>, x.blq ? <span key="b" className="text-red-700">{x.blq}</span> : 0, x.prod, x.m.lowStock, x.disp - x.res <= 0 ? <Badge key="a" s="Rupture" /> : x.disp - x.res < x.m.lowStock ? <Badge key="a" s="Stock faible (attente)" /> : <Badge key="a" s="Disponible" />])} />
            </Card>
            <Card title="Stock composants par emplacement (si renseigné)">
              <Table cols={["Emplacement", "Modèle", "Disponible", "Bloqué"]} rows={((await db.execute(sql`select coalesce(location,'(non renseigné)') loc, model, coalesce(sum(qty) filter (where state='DISPONIBLE'),0)::int d, coalesce(sum(qty) filter (where state='BLOQUE'),0)::int b from stock_movements where store='COMP' group by 1,2 having sum(qty)<>0 order by 1,2`)).rows as { loc: string; model: string; d: number; b: number }[]).map((x) => [x.loc, x.model, x.d, x.b])} />
            </Card>
          </>
        );
      })()}

      {tab === "mvt" && (async () => {
        const mv = (await db.select().from(stockMovements).orderBy(desc(stockMovements.id))).filter((m) => (!sp.store || m.store === sp.store) && match(sp.q, m.model, m.sourceNo, m.sourceType, m.vin, m.location));
        const pg = paginate(mv, Number(sp.page), 30);
        return (
          <Card title="Journal des mouvements (non supprimables)" actions={<a href="/api/export?type=movements" className="rounded-lg border px-3 py-1.5 text-sm">⬇ Export CSV</a>}>
            <SearchBar base={B} tab="mvt" q={sp.q} extra={<select name="store" defaultValue={sp.store ?? ""} className={`${inputCls} max-w-[160px]`}><option value="">Tous stocks</option><option value="COMP">Composants</option><option value="PROD">Production</option><option value="PF">Produits finis</option></select>} />
            <Table cols={["Date", "Stock", "État", "Modèle", "Qté", "Document source", "Type", "Emplacement / VIN", "Utilisateur"]} rows={pg.items.map((m) => [fdt(m.createdAt), m.store, m.state, m.model, <b key="q" className={m.qty < 0 ? "text-red-700" : "text-emerald-700"}>{m.qty > 0 ? "+" : ""}{m.qty}</b>, m.sourceNo, m.sourceType, [m.location, m.vin].filter(Boolean).join(" · "), uname(m.userId)])} />
            <Pager base={B} page={pg.page} pages={pg.pages} params={{ tab: "mvt", q: sp.q, store: sp.store }} />
          </Card>
        );
      })()}

      {tab === "dem" && (async () => {
        const dems = await db.select().from(componentRequests).orderBy(componentRequests.neededDate);
        const prio: Record<string, number> = { "Très urgente": 0, Urgente: 1, Normale: 2 };
        const open = dems.filter((d) => ["À préparer", "Partiellement préparée"].includes(d.status)).sort((a, b) => a.neededDate.localeCompare(b.neededDate) || (prio[a.priority] ?? 3) - (prio[b.priority] ?? 3));
        return (
          <>
            {can(r, "dem.create") && (
              <Card title="+ Nouvelle demande de composants">
                <form action={createDem} className="space-y-3"><Back to={back} />
                  <Grid cols={4}>
                    <Field label="Modèle" required><select name="model" required className={inputCls}>{models.filter((m) => m.active).map((m) => <option key={m.id}>{m.code}</option>)}</select></Field>
                    <Field label="Quantité" required><input name="qty" required className={inputCls} /></Field>
                    <Field label="Date nécessaire" required><input type="date" name="neededDate" defaultValue={today()} required className={inputCls} /></Field>
                    <Field label="Priorité"><select name="priority" className={inputCls}><option>Normale</option><option>Urgente</option><option>Très urgente</option></select></Field>
                  </Grid>
                  <Field label="Observation"><input name="obs" className={inputCls} /></Field>
                  <Submit>Envoyer au magasin</Submit>
                </form>
              </Card>
            )}
            <Card title="File des demandes (triée par date souhaitée et priorité)">
              <Table cols={["N°", "Modèle", "Demandée", "Préparée", "Restant", "Date", "Priorité", "Libre en stock", "Statut", can(r, "bs.prepare") ? "Préparer un BS" : ""]} rows={open.map((d) => { const free = g("COMP", "DISPONIBLE", d.model) - reserved(d.model); return [<b key="n">{d.no}</b>, d.model, d.qty, d.preparedQty, d.qty - d.preparedQty, fdate(d.neededDate), d.priority, free, <Badge key="s" s={d.status} />, can(r, "bs.prepare") ? <form key="f" action={createBs} className="flex gap-1"><Back to={back} /><input type="hidden" name="demId" value={d.id} /><input name="qty" defaultValue={Math.max(0, Math.min(d.qty - d.preparedQty, free))} className={`${inputCls} w-20`} /><Submit small confirm={`Émettre un bon de sortie pour ${d.model} ?`}>Émettre BS</Submit></form> : ""]; })} />
            </Card>
            <Card title="Bons de sortie">
              <Table cols={["N° BS", "Demande", "Modèle", "Qté", "Préparé par", "Statut", "RP", "Accepté / refusé", ""]} rows={slips.map((s) => [<b key="n">{s.no}</b>, dems.find((d) => d.id === s.demId)?.no, s.model, s.qty, uname(s.preparedBy), <Badge key="s" s={s.status} />, s.rpNo ?? "—", s.acceptedQty !== null ? `${s.acceptedQty} / ${s.refusedQty}` : "—", <Link key="p" className="text-red-700 underline" href={`/print/bs/${s.id}`}>🖨 Imprimer</Link>])} />
            </Card>
            <Card title="Demandes servies / historique">
              <Table cols={["N°", "Modèle", "Demandée", "Préparée", "Statut", "Demandeur"]} rows={dems.filter((d) => !open.includes(d)).map((d) => [d.no, d.model, d.qty, d.preparedQty, <Badge key="s" s={d.status} />, uname(d.requestedBy)])} />
            </Card>
          </>
        );
      })()}

      {tab === "adj" && (async () => {
        const adjs = await db.select().from(adjustments).orderBy(desc(adjustments.id));
        return (
          <>
            {can(r, "adj.request") && (
              <Card title="+ Demande d'ajustement">
                <form action={requestAdjustment} className="space-y-3"><Back to={back} />
                  <Grid cols={4}>
                    <Field label="Stock" required><select name="store" className={inputCls}><option value="COMP">Composants</option><option value="PF">Produits finis</option><option value="PROD">Production</option></select></Field>
                    <Field label="État" required><select name="state" className={inputCls}><option>DISPONIBLE</option><option>BLOQUE</option><option>QUARANTAINE</option></select></Field>
                    <Field label="Modèle" required><select name="model" className={inputCls}>{models.map((m) => <option key={m.id}>{m.code}</option>)}</select></Field>
                    <Field label="Quantité (+ entrée / − sortie)" required><input name="qty" required className={inputCls} /></Field>
                    <Field label="Document source (REC, BS, EPF…)" required className="md:col-span-2"><input name="sourceDoc" required className={inputCls} /></Field>
                    <Field label="Motif" required className="md:col-span-2"><input name="reason" required className={inputCls} /></Field>
                  </Grid>
                  <Submit>Soumettre</Submit>
                </form>
              </Card>
            )}
            <Card title="Ajustements">
              <Table cols={["N°", "Date", "Stock", "Modèle", "Qté", "Source", "Motif", "Demandeur", "Statut", ""]} rows={adjs.map((a) => [<b key="n">{a.no}</b>, fdate(a.createdAt), `${a.store}/${a.state}`, a.model, a.qty, a.sourceDoc, a.reason, uname(a.requestedBy), <Badge key="s" s={a.status} />,
                a.status === "À valider" && can(r, "adj.validate") && a.requestedBy !== u.id ? <form key="f" action={decideAdjustment} className="flex gap-1"><Back to={back} /><input type="hidden" name="id" value={a.id} /><input name="comment" placeholder="Commentaire" className={`${inputCls} w-32`} /><Submit small variant="success" name="decision" value="approve" confirm={`Valider ${a.no} : ${a.qty > 0 ? "+" : ""}${a.qty} ${a.model} (${a.store}) ?`}>Valider</Submit><Submit small variant="danger" name="decision" value="reject">Refuser</Submit></form> : a.decidedBy ? `${uname(a.decidedBy)}${a.decisionComment ? " – " + a.decisionComment : ""}` : a.requestedBy === u.id && a.status === "À valider" ? <span key="w" className="text-xs text-slate-400">validation par un tiers</span> : ""])} />
            </Card>
          </>
        );
      })()}
    </div>
  );
}
