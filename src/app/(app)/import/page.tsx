import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { claims, importFiles, motoModels, packingLines, packingLists, suppliers } from "@/db/schema";
import { Back, Badge, Btn, Card, Empty, Extra, Field, Flash, Grid, KV, PageHeader, SearchBar, Stat, StatGrid, Table, inputCls, match } from "@/components/ui";
import { Submit } from "@/components/client";
import { Attachments, History } from "@/components/docs";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/perms";
import { fdate, tnd, today } from "@/lib/core";
import { addFee, addPackingList, createImport, decideImport, decideList, updateImportExtra } from "./actions";

export const dynamic = "force-dynamic";
const B = "/import";
const EXTRA: [string, string, string?][] = [
  ["devise", "Devise"], ["incoterm", "Incoterm"], ["paiement", "Conditions de paiement"], ["lc", "LC / titre d'importation"], ["swift", "SWIFT"], ["transport", "Transport"], ["conteneur", "Conteneur"],
  ["port_chargement", "Port de chargement"], ["port_dechargement", "Port de déchargement"], ["etd", "Date départ (ETD)", "date"], ["eta", "Date arrivée (ETA)", "date"], ["bl", "N° BL maritime"], ["ci", "Commercial Invoice"], ["certificat", "Certificat d'origine"], ["assurance", "Assurance"], ["douane", "Déclaration douane"],
];

function ExtraFields({ v }: { v?: Record<string, string> }) {
  return <Grid cols={4}>{EXTRA.map(([k, l, t]) => <Field key={k} label={l}><input name={k} type={t ?? "text"} defaultValue={v?.[k] ?? ""} className={inputCls} /></Field>)}</Grid>;
}

export default async function ImportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const r = u.role;
  const [sups, models] = await Promise.all([db.select().from(suppliers), db.select().from(motoModels).where(eq(motoModels.active, true))]);
  const sname = (i: number) => sups.find((s) => s.id === i)?.name ?? "—";

  if (sp.new && can(r, "imp.manage")) {
    return (
      <div>
        <PageHeader title="Nouveau dossier d'importation" />
        <Flash sp={sp} />
        <Card>
          <form action={createImport} className="space-y-4">
            <Back to={`${B}?new=1`} />
            <Grid>
              <Field label="Fournisseur" required><select name="supplierId" required className={inputCls}><option value="">—</option>{sups.filter((s) => s.kind === "ETRANGER").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
              <Field label="N° de commande PI (Proforma Invoice)" required><input name="piNumber" required className={inputCls} /></Field>
              <Field label="Date de la PI" required><input type="date" name="piDate" required defaultValue={today()} className={inputCls} /></Field>
            </Grid>
            <Field label="Modèle(s)" required>
              <div className="flex flex-wrap gap-2 rounded-lg border p-2">{models.map((m) => <label key={m.id} className="flex items-center gap-1 rounded bg-slate-50 px-2 py-1 text-sm"><input type="checkbox" name="models" value={m.code} />{m.code}</label>)}</div>
            </Field>
            <Extra><ExtraFields /></Extra>
            <Submit>Créer le dossier</Submit>
          </form>
        </Card>
      </div>
    );
  }

  if (sp.id) {
    const f = (await db.select().from(importFiles).where(eq(importFiles.id, Number(sp.id))))[0];
    if (!f) return <Empty>Dossier introuvable.</Empty>;
    const lists = await db.select().from(packingLists).where(eq(packingLists.importId, f.id));
    const lines = lists.length ? await db.select().from(packingLines).where(inArray(packingLines.listId, lists.map((l) => l.id))) : [];
    const cl = await db.select().from(claims).where(eq(claims.importId, f.id));
    const back = `${B}?id=${f.id}`;
    const active = lines.filter((l) => lists.find((x) => x.id === l.listId)?.status !== "Refusée");
    const byModel = [...new Set(active.map((l) => l.model))].map((m) => {
      const ls = active.filter((l) => l.model === m);
      const s = (k: "plannedQty" | "receivedQty" | "acceptedQty" | "damagedQty" | "cancelledQty") => ls.reduce((a, l) => a + l[k], 0);
      return { m, planned: s("plannedQty"), received: s("receivedQty"), accepted: s("acceptedQty"), damaged: s("damagedQty"), cancelled: s("cancelledQty") };
    });
    const totalFees = f.fees.reduce((s, x) => s + x.amount, 0);
    return (
      <div>
        <PageHeader title={`Dossier ${f.no}`} actions={<Btn href={B} variant="secondary">← Dossiers</Btn>} />
        <Flash sp={sp} />
        <Card title={<span>Informations principales <Badge s={f.status} /></span>}>
          <KV items={[["Fournisseur", sname(f.supplierId)], ["N° PI", f.piNumber], ["Date PI", fdate(f.piDate)], ["Modèles", f.models.join(", ")], ...EXTRA.filter(([k]) => f.extra[k]).map(([k, l]) => [l, f.extra[k]] as [string, string])]} />
          <div className="mt-4 flex flex-wrap gap-2">
            {can(r, "imp.manage") && f.status === "Brouillon" && <form action={decideImport}><Back to={back} /><input type="hidden" name="id" value={f.id} /><Submit name="step" value="submit">Soumettre à validation</Submit></form>}
            {can(r, "imp.validate") && f.status === "À valider" && <form action={decideImport}><Back to={back} /><input type="hidden" name="id" value={f.id} /><Submit variant="success" name="step" value="validate" confirm="Valider le dossier ? Toutes les listes doivent être validées.">Valider le dossier</Submit></form>}
            {can(r, "imp.validate") && f.status === "Validé" && <form action={decideImport} className="flex gap-2"><Back to={back} /><input type="hidden" name="id" value={f.id} /><input name="reason" placeholder="Décision formelle (si reliquat/écarts)" className={inputCls} /><Submit variant="dark" name="step" value="close" confirm="Clôturer le dossier ?">Clôturer</Submit></form>}
          </div>
          {can(r, "imp.manage") && f.status !== "Clôturé" && (
            <Extra title={f.status === "Validé" ? "Corriger les informations logistiques (ajustement motivé)" : "Modifier les informations complémentaires"}>
              <form action={updateImportExtra} className="space-y-3"><Back to={back} /><input type="hidden" name="id" value={f.id} /><ExtraFields v={f.extra} /><Field label="Motif" required={f.status === "Validé"}><input name="reason" className={inputCls} /></Field><Submit variant="secondary" small>Enregistrer</Submit></form>
            </Extra>
          )}
        </Card>

        <Card title="Suivi par modèle">
          <Table cols={["Modèle", "Prévu", "Reçu", "Accepté", "Endommagé/bloqué", "Annulé", "Restant", "Écart"]} rows={byModel.map((x) => [<b key="m">{x.m}</b>, x.planned, x.received, x.accepted, x.damaged, x.cancelled, x.planned - x.cancelled - x.received, <span key="e" className={x.planned - x.cancelled - x.accepted ? "font-semibold text-red-700" : ""}>{x.planned - x.cancelled - x.accepted}</span>])} empty="Aucune liste de colisage." />
        </Card>

        <Card title={`Listes de colisage (${lists.length})`}>
          {lists.map((l) => (
            <div key={l.id} className="mb-3 rounded-lg border p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><b>{l.no} <Badge s={l.status} /></b>
                {can(r, "imp.validate") && l.status === "À valider" && <form action={decideList} className="flex gap-2"><Back to={back} /><input type="hidden" name="id" value={l.id} /><input name="reason" placeholder="Motif si refus" className={`${inputCls} w-48`} /><Submit variant="success" small name="decision" value="validate" confirm={`Valider les quantités de ${l.no} ?`}>Valider</Submit><Submit variant="danger" small name="decision" value="reject">Refuser</Submit></form>}
              </div>
              <Table cols={["Modèle", "Prévu", "Annulé", "Reçu", "Accepté", "Endommagé", "Restant"]} rows={lines.filter((x) => x.listId === l.id).map((x) => [x.model, x.plannedQty, x.cancelledQty, x.receivedQty, x.acceptedQty, x.damagedQty, x.plannedQty - x.cancelledQty - x.receivedQty])} />
            </div>
          ))}
          {can(r, "imp.manage") && ["Brouillon", "À valider", "Validé"].includes(f.status) && (
            <form action={addPackingList} className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3"><Back to={back} /><input type="hidden" name="id" value={f.id} />
              <h4 className="text-sm font-semibold">+ Ajouter une liste de colisage</h4>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex gap-1">
                    <select name={`model_${i}`} defaultValue={f.models[i] ?? ""} className={inputCls}><option value="">—</option>{models.map((m) => <option key={m.id}>{m.code}</option>)}</select>
                    <input name={`qty_${i}`} placeholder="Qté" className={`${inputCls} w-20`} />
                  </div>
                ))}
              </div>
              <Submit small>Ajouter et soumettre à validation</Submit>
            </form>
          )}
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card title={`Frais enregistrés – coût final : ${tnd(totalFees)}`}>
            <Table cols={["Libellé", "Montant"]} rows={f.fees.map((x) => [x.label, tnd(x.amount)])} empty="Aucun frais saisi (non estimé automatiquement)." />
            {can(r, "imp.manage") && f.status !== "Clôturé" && <form action={addFee} className="mt-3 flex gap-2"><Back to={back} /><input type="hidden" name="id" value={f.id} /><input name="label" placeholder="Fret, douane, transit…" className={inputCls} /><input name="amount" placeholder="Montant DT" className={`${inputCls} w-32`} /><Submit small variant="secondary">Ajouter</Submit></form>}
          </Card>
          <Card title="Écarts et réclamations">
            <Table cols={["N°", "Modèle", "Qté", "Statut", ""]} rows={cl.map((c) => [c.claimNo ?? c.no, c.model, c.qty, <Badge key="s" s={c.status} />, <Link key="l" href={`/reclamations?id=${c.id}`} className="text-red-700 underline">Ouvrir</Link>])} />
          </Card>
        </div>
        <Attachments docType="IMP" docId={f.id} docNo={f.no} back={back} canUpload={can(r, "imp.manage")} />
        <History docNo={f.no} />
      </div>
    );
  }

  const files = (await db.select().from(importFiles).orderBy(desc(importFiles.id))).filter((f) => match(sp.q, f.no, f.piNumber, sname(f.supplierId), f.models.join(" "), f.status));
  const allLists = await db.select().from(packingLists);
  const soon = files.filter((f) => f.extra.eta && f.extra.eta >= today() && f.status !== "Clôturé" && new Date(f.extra.eta).getTime() - Date.now() < 7 * 86400000).length;
  return (
    <div>
      <PageHeader title="Achats / importations" subtitle="Dossiers IMP, listes de colisage, frais, suivi des quantités" actions={can(r, "imp.manage") && <Btn href={`${B}?new=1`}>+ Nouveau dossier d&apos;importation</Btn>} />
      <Flash sp={sp} />
      <StatGrid>
        <Stat label="Dossiers en brouillon" value={files.filter((f) => f.status === "Brouillon").length} />
        <Stat label="À valider" value={files.filter((f) => f.status === "À valider").length} tone="amber" />
        <Stat label="Listes à valider" value={allLists.filter((l) => l.status === "À valider").length} tone="red" />
        <Stat label="Dossiers validés" value={files.filter((f) => f.status === "Validé").length} tone="green" />
        <Stat label="Arrivées ≤ 7 jours" value={soon} tone="blue" />
        <Stat label="Clôturés" value={files.filter((f) => f.status === "Clôturé").length} />
      </StatGrid>
      <Card title="Dossiers d'importation">
        <SearchBar base={B} q={sp.q} />
        <Table cols={["N°", "Fournisseur", "PI", "Date PI", "Modèles", "ETA", "Listes", "Statut", ""]} rows={files.map((f) => [<b key="n">{f.no}</b>, sname(f.supplierId), f.piNumber, fdate(f.piDate), f.models.join(", "), f.extra.eta ? fdate(f.extra.eta) : "non renseignée", allLists.filter((l) => l.importId === f.id).length, <Badge key="s" s={f.status} />, <Link key="l" className="text-red-700 underline" href={`${B}?id=${f.id}`}>Ouvrir</Link>])} />
      </Card>
    </div>
  );
}
