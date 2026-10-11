import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { exitSlips, motoModels, productions, transfers, users } from "@/db/schema";
import { Back, Badge, Card, Extra, Field, Flash, Grid, PageHeader, SearchBar, Stat, StatGrid, Table, Tabs, inputCls, match } from "@/components/ui";
import { Submit } from "@/components/client";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/perms";
import { fdate, fdt, getSetting, today } from "@/lib/core";
import { createPrj, createTrf, receiveBs } from "../ops-actions";

export const dynamic = "force-dynamic";
const B = "/production";

export default async function ProductionPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const r = u.role;
  const tab = ["bs", "prj", "trf"].includes(sp.tab ?? "") ? sp.tab! : "prj";
  const back = `${B}?tab=${tab}`;
  const [models, us, slips, prods, trfs] = await Promise.all([
    db.select().from(motoModels).where(eq(motoModels.active, true)), db.select().from(users), db.select().from(exitSlips).orderBy(desc(exitSlips.id)), db.select().from(productions).orderBy(desc(productions.id)), db.select().from(transfers).orderBy(desc(transfers.id)),
  ]);
  const uname = (i: number | null) => us.find((x) => x.id === i)?.fullName ?? "—";
  const maxH = Number(await getSetting("max_prod_inspection_hours")) || 48;
  const todayQ = prods.filter((p) => p.prodDate === today()).reduce((s, p) => s + p.qty, 0);
  const target = models.reduce((s, m) => s + m.dailyTarget, 0);
  const toTransfer = prods.reduce((s, p) => s + p.qty - p.transferredQty, 0);
  const late = prods.filter((p) => p.qty > p.transferredQty && Date.now() - new Date(p.createdAt).getTime() > maxH * 3600000).length;
  const prodStock = (await db.execute(sql`select model, sum(qty)::int q from stock_movements where store='PROD' group by model having sum(qty)<>0`)).rows as { model: string; q: number }[];

  return (
    <div>
      <PageHeader title="Production" subtitle="Réception des BS · Production journalière · Transfert vers inspection" />
      <Flash sp={sp} />
      <StatGrid>
        <Stat label="Produit aujourd'hui" value={`${todayQ} / ${target}`} tone={todayQ >= target ? "green" : "amber"} hint="objectif journalier (modèles actifs)" />
        <Stat label="BS à réceptionner" value={slips.filter((s) => s.status === "Émis").length} href={`${B}?tab=bs`} tone="blue" />
        <Stat label="Restant à transférer" value={toTransfer} href={`${B}?tab=trf`} tone="amber" />
        <Stat label="Transferts en attente qualité" value={trfs.filter((t) => t.status === "En attente").length} tone="blue" />
        <Stat label={`Retards > ${maxH} h`} value={late} tone="red" />
        <Stat label="Composants en stock production" value={prodStock.reduce((s, x) => s + Number(x.q), 0)} />
      </StatGrid>
      <Tabs base={B} active={tab} tabs={[{ key: "prj", label: "Production journalière" }, { key: "bs", label: "Réception des BS", count: slips.filter((s) => s.status === "Émis").length }, { key: "trf", label: "Transfert vers inspection" }]} />

      {tab === "bs" && (
        <Card title="Bons de sortie à réceptionner">
          <Table cols={["BS", "Modèle", "Qté envoyée", "Préparé par", "Date", "Réception"]} rows={slips.filter((s) => s.status === "Émis").map((s) => [<b key="n">{s.no}</b>, s.model, s.qty, uname(s.preparedBy), fdt(s.createdAt),
            can(r, "bs.receive") && s.preparedBy !== u.id ? <form key="f" action={receiveBs} className="flex flex-wrap gap-1"><Back to={back} /><input type="hidden" name="id" value={s.id} /><input name="accepted" defaultValue={s.qty} title="Quantité acceptée" className={`${inputCls} w-20`} /><input name="reason" placeholder="Motif si écart" className={`${inputCls} w-40`} /><Submit small variant="success" confirm={`Confirmer la réception du ${s.no} ? Sortie stock composants et entrée stock production simultanées.`}>Réceptionner</Submit></form> : <span key="x" className="text-xs text-slate-400">Non autorisé</span>])} empty="Aucun BS en attente." />
          <h4 className="mb-2 mt-5 text-sm font-semibold">Historique des réceptions (RP)</h4>
          <Table cols={["RP", "BS", "Modèle", "Accepté", "Refusé", "Motif", "Réceptionné par", "Date"]} rows={slips.filter((s) => s.rpNo).map((s) => [s.rpNo, s.no, s.model, s.acceptedQty, s.refusedQty, s.reason, uname(s.receivedBy), fdt(s.receivedAt)])} />
        </Card>
      )}

      {tab === "prj" && (
        <>
          {can(r, "prj.create") && (
            <Card title="+ Déclarer une production">
              <form action={createPrj} className="space-y-3"><Back to={back} />
                <Grid cols={4}>
                  <Field label="BS / réception production source"><select name="bsId" className={inputCls}><option value="">— Aucun (choisir modèle) —</option>{slips.filter((s) => s.status === "Réceptionné" && (s.acceptedQty ?? 0) > s.usedQty).map((s) => <option key={s.id} value={s.id}>{s.no} / {s.rpNo} – {s.model} (dispo {(s.acceptedQty ?? 0) - s.usedQty})</option>)}</select></Field>
                  <Field label="Modèle (si pas de BS)"><select name="model" className={inputCls}><option value="">—</option>{models.map((m) => <option key={m.id}>{m.code}</option>)}</select></Field>
                  <Field label="Date" required><input type="date" name="prodDate" defaultValue={today()} className={inputCls} /></Field>
                  <Field label="Motos produites" required><input name="qty" required className={inputCls} /></Field>
                </Grid>
                <Extra>
                  <Grid cols={4}>
                    <Field label="Équipe"><input name="team" className={inputCls} /></Field>
                    <Field label="Effectif"><input name="headcount" className={inputCls} /></Field>
                    <Field label="Lots de composants consommés (si suivi activé)"><input name="componentsUsed" className={inputCls} /></Field>
                    <Field label="Observations"><input name="obs" className={inputCls} /></Field>
                  </Grid>
                  <p className="mt-2 text-xs text-slate-500">Le nombre de motos n&apos;est pas comparé directement au nombre de composants (unités non équivalentes). Aucune consommation théorique n&apos;est inventée sans nomenclature paramétrée.</p>
                </Extra>
                <Submit confirm="Soumettre la déclaration de production ?">Soumettre la déclaration</Submit>
              </form>
            </Card>
          )}
          <Card title="Historique de production">
            <SearchBar base={B} tab="prj" q={sp.q} />
            <Table cols={["N°", "Date", "Modèle", "Produit", "Transféré", "Reste à transférer", "Source", "Équipe", "Consommé", "Responsable"]} rows={prods.filter((p) => match(sp.q, p.no, p.model, p.team)).map((p) => [<b key="n">{p.no}</b>, fdate(p.prodDate), p.model, p.qty, p.transferredQty, p.qty - p.transferredQty, slips.find((s) => s.id === p.bsId)?.no ?? "—", p.team, p.componentsUsed ?? "non renseigné", uname(p.createdBy)])} />
          </Card>
        </>
      )}

      {tab === "trf" && (
        <>
          <Card title="Productions prêtes à transférer">
            <Table cols={["PRJ", "Date", "Modèle", "Restant non transféré", "Âge", can(r, "trf.create") ? "Transférer" : ""]} rows={prods.filter((p) => p.qty > p.transferredQty).map((p) => { const h = Math.round((Date.now() - new Date(p.createdAt).getTime()) / 3600000); return [<b key="n">{p.no}</b>, fdate(p.prodDate), p.model, p.qty - p.transferredQty, <span key="h" className={h > maxH ? "font-bold text-red-700" : ""}>{h} h</span>,
              can(r, "trf.create") ? <form key="f" action={createTrf} className="flex gap-1"><Back to={back} /><input type="hidden" name="prjId" value={p.id} /><input name="qty" defaultValue={p.qty - p.transferredQty} className={`${inputCls} w-20`} /><Submit small confirm={`Transférer vers l'inspection (${p.model}) ?`}>+ Transfert</Submit></form> : ""]; })} empty="Rien à transférer." />
          </Card>
          <Card title="Transferts vers inspection">
            <Table cols={["TRF", "Date", "PRJ", "Modèle", "Qté", "Accepté", "Statut", "Émetteur", "Réceptionnaire", ""]} rows={trfs.map((t) => [<b key="n">{t.no}</b>, fdt(t.createdAt), prods.find((p) => p.id === t.prjId)?.no, t.model, t.qty, t.acceptedQty ?? "—", <Badge key="s" s={t.status} />, uname(t.issuedBy), uname(t.receivedBy), <Link key="p" className="text-red-700 underline" href={`/print/trf/${t.id}`}>🖨 Fiche</Link>])} />
          </Card>
        </>
      )}
    </div>
  );
}
