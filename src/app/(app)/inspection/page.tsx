import { desc } from "drizzle-orm";
import { db } from "@/db";
import { inspectionSessions, inspections, nonConformities, pfTransfers, transfers, users } from "@/db/schema";
import { Back, Badge, Card, Field, Flash, Grid, PageHeader, Stat, StatGrid, Table, Tabs, inputCls } from "@/components/ui";
import { Submit } from "@/components/client";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/perms";
import { fdt } from "@/lib/core";
import { addSession, decideNc, proposePf, receiveTrf } from "../ops-actions";

export const dynamic = "force-dynamic";
const B = "/inspection";

export default async function InspectionPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const r = u.role;
  const tab = ["trf", "fi", "nc", "pf"].includes(sp.tab ?? "") ? sp.tab! : "fi";
  const back = `${B}?tab=${tab}${sp.id ? `&id=${sp.id}` : ""}`;
  const [us, trfs, fis, sess, ncs, tfps] = await Promise.all([db.select().from(users), db.select().from(transfers).orderBy(desc(transfers.id)), db.select().from(inspections).orderBy(desc(inspections.id)), db.select().from(inspectionSessions).orderBy(desc(inspectionSessions.id)), db.select().from(nonConformities).orderBy(desc(nonConformities.id)), db.select().from(pfTransfers).orderBy(desc(pfTransfers.id))]);
  const uname = (i: number | null) => us.find((x) => x.id === i)?.fullName ?? "—";
  const totInsp = fis.reduce((s, f) => s + f.inspectedQty, 0), totConf = fis.reduce((s, f) => s + f.conformQty, 0);
  const sel = sp.id ? fis.find((f) => f.id === Number(sp.id)) : undefined;

  return (
    <div>
      <PageHeader title="Inspection qualité et conformité" subtitle="Seules les unités inspectées et conformes peuvent entrer en stock produits finis" />
      <Flash sp={sp} />
      <StatGrid>
        <Stat label="Transferts à réceptionner" value={trfs.filter((t) => t.status === "En attente").length} href={`${B}?tab=trf`} tone="blue" />
        <Stat label="Unités à inspecter" value={fis.reduce((s, f) => s + f.receivedQty - f.inspectedQty, 0)} href={`${B}?tab=fi`} tone="amber" />
        <Stat label="Taux de conformité" value={totInsp ? `${Math.round((totConf / totInsp) * 100)} %` : "—"} tone="green" />
        <Stat label="NC ouvertes (bloquées)" value={ncs.filter((n) => n.status === "Ouverte").reduce((s, n) => s + n.qty, 0)} href={`${B}?tab=nc`} tone="red" />
        <Stat label="Conformes à transférer PF" value={fis.reduce((s, f) => s + f.conformQty - f.pfProposedQty, 0)} href={`${B}?tab=pf`} tone="green" />
        <Stat label="TFP en attente PF" value={tfps.filter((t) => t.status === "En attente").length} />
      </StatGrid>
      <Tabs base={B} active={tab} tabs={[{ key: "trf", label: "Transferts reçus", count: trfs.filter((t) => t.status === "En attente").length }, { key: "fi", label: "À inspecter / fiches" }, { key: "nc", label: "Non-conformités", count: ncs.filter((n) => n.status === "Ouverte").length }, { key: "pf", label: "Transfert vers PF" }]} />

      {tab === "trf" && (
        <Card title="File des transferts en attente de réception">
          <Table cols={["TRF", "Modèle", "Qté transférée", "Émis par", "Date", "Réception"]} rows={trfs.filter((t) => t.status === "En attente").map((t) => [<b key="n">{t.no}</b>, t.model, t.qty, uname(t.issuedBy), fdt(t.createdAt),
            can(r, "trf.receive") ? <form key="f" action={receiveTrf} className="flex flex-wrap gap-1"><Back to={back} /><input type="hidden" name="id" value={t.id} /><input name="accepted" defaultValue={t.qty} className={`${inputCls} w-20`} /><input name="reason" placeholder="Motif si écart" className={`${inputCls} w-40`} /><Submit small variant="success" confirm={`Confirmer le comptage physique du ${t.no} ?`}>Accepter</Submit></form> : ""])} empty="Aucun transfert en attente." />
        </Card>
      )}

      {tab === "fi" && (
        <>
          {sel && (
            <Card title={<span>Fiche {sel.no} – {sel.model} <Badge s={sel.status} /></span>}>
              <p className="mb-3 text-sm">Reçues : <b>{sel.receivedQty}</b> · Inspectées : <b>{sel.inspectedQty}</b> · Conformes : <b className="text-emerald-700">{sel.conformQty}</b> · Non conformes : <b className="text-red-700">{sel.nonConformQty}</b> · Restant : <b>{sel.receivedQty - sel.inspectedQty}</b></p>
              {can(r, "insp.do") && sel.receivedQty > sel.inspectedQty && (
                <form action={addSession} className="space-y-3 rounded-lg border p-3"><Back to={back} /><input type="hidden" name="id" value={sel.id} />
                  <h4 className="text-sm font-semibold">Nouvelle session d&apos;inspection</h4>
                  <Grid cols={4}>
                    <Field label="Inspectées" required><input name="inspected" required className={inputCls} /></Field>
                    <Field label="Conformes" required><input name="conform" required defaultValue={0} className={inputCls} /></Field>
                    <Field label="Non conformes" required><input name="nonConform" required defaultValue={0} className={inputCls} /></Field>
                    <Field label="Observations"><input name="defects" className={inputCls} /></Field>
                  </Grid>
                  <div className="rounded bg-red-50 p-2">
                    <p className="mb-2 text-xs font-medium text-red-800">Si non conformes &gt; 0 :</p>
                    <Grid cols={4}>
                      <Field label="Défaut constaté"><input name="defect" className={inputCls} /></Field>
                      <Field label="Gravité"><select name="severity" className={inputCls}><option>Mineure</option><option>Majeure</option><option>Critique</option></select></Field>
                      <Field label="Décision attendue"><input name="expectedDecision" placeholder="Retouche, rebut…" className={inputCls} /></Field>
                      <Field label="Responsable du traitement"><input name="responsible" className={inputCls} /></Field>
                    </Grid>
                  </div>
                  <Submit confirm="Enregistrer cette session ? Contrôle : inspectées = conformes + non conformes.">Enregistrer la session</Submit>
                </form>
              )}
              <h4 className="mb-2 mt-4 text-sm font-semibold">Sessions</h4>
              <Table cols={["SES", "Date", "Inspectées", "Conformes", "Non conformes", "Défauts", "Inspecteur"]} rows={sess.filter((s) => s.fiId === sel.id).map((s) => [s.no, fdt(s.createdAt), s.inspected, s.conform, s.nonConform, s.defects, uname(s.userId)])} />
            </Card>
          )}
          <Card title="Fiches d'inspection">
            <Table cols={["FI", "TRF", "Modèle", "Reçues", "Inspectées", "Conformes", "NC", "Restant", "Taux", "Statut", ""]} rows={fis.map((f) => [<b key="n">{f.no}</b>, trfs.find((t) => t.id === f.trfId)?.no, f.model, f.receivedQty, f.inspectedQty, f.conformQty, f.nonConformQty, f.receivedQty - f.inspectedQty, f.inspectedQty ? `${Math.round((f.conformQty / f.inspectedQty) * 100)}%` : "—", <Badge key="s" s={f.status} />, <a key="l" className="text-red-700 underline" href={`${B}?tab=fi&id=${f.id}`}>Ouvrir</a>])} />
          </Card>
        </>
      )}

      {tab === "nc" && (
        <Card title="Fiches de non-conformité">
          <Table cols={["NC", "FI", "Modèle", "Qté bloquée", "Défaut", "Gravité", "Décision attendue", "Responsable", "Statut", "Décision"]} rows={ncs.map((n) => [<b key="n">{n.no}</b>, fis.find((f) => f.id === n.fiId)?.no, n.model, n.qty, n.defect, n.severity, n.expectedDecision, n.responsible, <Badge key="s" s={n.status} />,
            n.status === "Ouverte" && can(r, "insp.do") ? <form key="f" action={decideNc} className="flex flex-col gap-1"><Back to={back} /><input type="hidden" name="id" value={n.id} /><select name="decision" className={inputCls}><option>Retouchée – conforme après réinspection</option><option>Rebut</option><option>Retour fournisseur</option><option>Démontage / récupération pièces</option></select><input name="comment" placeholder="Justification *" className={inputCls} /><Submit small>Décider</Submit></form> : n.decision])} />
        </Card>
      )}

      {tab === "pf" && (
        <>
          <Card title="Conformes en attente de transfert vers le stock PF">
            <Table cols={["FI", "Modèle", "Conformes", "Déjà proposées", "Disponibles", can(r, "pf.propose") ? "Proposer" : ""]} rows={fis.filter((f) => f.conformQty > f.pfProposedQty).map((f) => [<b key="n">{f.no}</b>, f.model, f.conformQty, f.pfProposedQty, f.conformQty - f.pfProposedQty,
              can(r, "pf.propose") ? <form key="f" action={proposePf} className="flex flex-wrap gap-1"><Back to={back} /><input type="hidden" name="id" value={f.id} /><input name="qty" defaultValue={f.conformQty - f.pfProposedQty} className={`${inputCls} w-20`} /><input name="vins" placeholder="VIN/châssis (séparés par virgule, optionnel)" className={`${inputCls} w-72`} /><Submit small confirm="Proposer ce transfert vers le stock PF ?">Proposer</Submit></form> : ""])} empty="Aucune unité conforme en attente." />
          </Card>
          <Card title="Transferts vers PF (TFP)">
            <Table cols={["TFP", "FI", "Modèle", "Qté", "Accepté", "EPF", "Statut", "Proposé par", "Date"]} rows={tfps.map((t) => [<b key="n">{t.no}</b>, fis.find((f) => f.id === t.fiId)?.no, t.model, t.qty, t.acceptedQty ?? "—", t.epfNo ?? "—", <Badge key="s" s={t.status} />, uname(t.proposedBy), fdt(t.createdAt)])} />
          </Card>
        </>
      )}
    </div>
  );
}
