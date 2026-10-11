import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  assetMoves, assets, invoices, purchaseOrderLines, purchaseOrders, purchaseRequestLines, purchaseRequests, supplierReceipts, suppliers, users,
} from "@/db/schema";
import { Back, Badge, Btn, Card, Empty, Extra, Field, Flash, Grid, KV, PageHeader, Pager, SearchBar, Stat, StatGrid, Table, Tabs, inputCls, match, paginate } from "@/components/ui";
import { Submit } from "@/components/client";
import { Attachments, History } from "@/components/docs";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/perms";
import { fdate, fdt, getSetting, tnd, today } from "@/lib/core";
import { lineAmounts, matchInvoice } from "@/lib/achats";
import {
  assetAction, cancelDa, cancelPo, closePo, confirmReceipt, createInvoice, createPo, createReceipt, decidePo, editPo, emitPo, invoiceAction, processDa, regularizeReceipt, saveDa, submitPo,
} from "./actions";

export const dynamic = "force-dynamic";
type SP = Record<string, string | undefined>;
const B = "/achats";

export default async function AchatsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const r = u.role;
  const all = can(r, "view.all");
  const tabs = [
    { key: "dash", label: "Tableau de bord", show: true },
    { key: "da", label: "Demandes d'achat", show: can(r, "da.create") || can(r, "da.process") || all },
    { key: "bc", label: "Bons de commande", show: can(r, "bc.manage") || can(r, "bc.validate") || can(r, "inv.daf") || all },
    { key: "rcf", label: "Réceptions / BL", show: can(r, "rcf.admin") || can(r, "rcf.confirm") || all },
    { key: "fac", label: "Factures", show: can(r, "inv.manage") || can(r, "inv.daf") || all },
    { key: "rap", label: "Rapprochement", show: can(r, "inv.manage") || can(r, "inv.daf") || can(r, "bc.validate") || all },
    { key: "imm", label: "Immobilisations", show: can(r, "asset.manage") || all },
  ].filter((t) => t.show);
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : r === "DEMANDEUR" ? "da" : r === "IMMO" ? "imm" : r === "DAF" ? "fac" : "dash";
  const [userList, supplierList] = await Promise.all([db.select().from(users), db.select().from(suppliers)]);
  const uname = (id: number | null | undefined) => userList.find((x) => x.id === id)?.fullName ?? "—";
  const sname = (id: number | null | undefined) => supplierList.find((x) => x.id === id)?.name ?? "—";
  const ctx: Ctx = { sp, u, uname, sname, supplierList, all };

  return (
    <div>
      <PageHeader title="Achats locaux" subtitle="DA → BC → Réception → Facture → Transmission DAF · Immobilisations" />
      <Flash sp={sp} />
      <Tabs base={B} tabs={tabs} active={tab} />
      {tab === "dash" && <Dash />}
      {tab === "da" && <DaTab ctx={ctx} />}
      {tab === "bc" && <BcTab ctx={ctx} />}
      {tab === "rcf" && <RcfTab ctx={ctx} />}
      {tab === "fac" && <FacTab ctx={ctx} />}
      {tab === "rap" && <RapTab ctx={ctx} />}
      {tab === "imm" && <ImmTab ctx={ctx} />}
    </div>
  );
}

type Ctx = {
  sp: SP; u: Awaited<ReturnType<typeof requireUser>>; uname: (id: number | null | undefined) => string; sname: (id: number | null | undefined) => string;
  supplierList: (typeof suppliers.$inferSelect)[]; all: boolean;
};

/* ----------------------------- Dashboard ----------------------------- */
async function Dash() {
  const [das, pos, rcs, invs, ims, lines] = await Promise.all([
    db.select().from(purchaseRequests), db.select().from(purchaseOrders), db.select().from(supplierReceipts), db.select().from(invoices), db.select().from(assets), db.select().from(purchaseRequestLines),
  ]);
  const c = (arr: { status: string }[], ...s: string[]) => arr.filter((x) => s.includes(x.status)).length;
  const late = pos.filter((p) => ["Émis", "Partiellement reçu"].includes(p.status) && p.deliveryDate && p.deliveryDate < today()).length;
  const accNotOrdered = das.filter((d) => d.status === "Acceptée pour traitement" && lines.filter((l) => l.daId === d.id).every((l) => l.orderedQty === 0)).length;
  return (
    <>
      <h3 className="mb-2 text-sm font-semibold text-slate-600">Demandes d&apos;achat</h3>
      <StatGrid>
        <Stat label="Brouillons" value={c(das, "Brouillon")} href={`${B}?tab=da&f=Brouillon`} />
        <Stat label="Soumises" value={c(das, "Soumise", "En cours de vérification")} href={`${B}?tab=da&f=Soumise`} tone="amber" />
        <Stat label="À corriger" value={c(das, "À corriger")} href={`${B}?tab=da&f=À corriger`} tone="red" />
        <Stat label="Acceptées non commandées" value={accNotOrdered} href={`${B}?tab=da&f=Acceptée pour traitement`} tone="blue" />
        <Stat label="Partiellement commandées" value={c(das, "Partiellement commandée")} href={`${B}?tab=da&f=Partiellement commandée`} tone="blue" />
        <Stat label="Clôturées / entièrement cdées" value={c(das, "Clôturée", "Entièrement commandée")} href={`${B}?tab=da&f=Entièrement commandée`} tone="green" />
      </StatGrid>
      <h3 className="mb-2 text-sm font-semibold text-slate-600">Bons de commande et réceptions</h3>
      <StatGrid>
        <Stat label="BC en attente validation" value={c(pos, "En attente de validation")} href={`${B}?tab=bc&f=En attente de validation`} tone="amber" />
        <Stat label="BC à revalider" value={c(pos, "À revalider")} href={`${B}?tab=bc&f=À revalider`} tone="red" />
        <Stat label="BC en retard" value={late} href={`${B}?tab=bc&f=late`} tone="red" />
        <Stat label="BC partiellement reçus" value={c(pos, "Partiellement reçu")} href={`${B}?tab=bc&f=Partiellement reçu`} tone="blue" />
        <Stat label="Réceptions avec anomalie" value={c(rcs, "Réception avec anomalie")} href={`${B}?tab=rcf&f=Réception avec anomalie`} tone="red" />
        <Stat label="En régularisation" value={c(rcs, "En cours de régularisation")} href={`${B}?tab=rcf&f=En cours de régularisation`} tone="amber" />
      </StatGrid>
      <h3 className="mb-2 text-sm font-semibold text-slate-600">Factures et immobilisations</h3>
      <StatGrid>
        <Stat label="Factures avec écarts" value={c(invs, "Écart à traiter")} href={`${B}?tab=fac&f=Écart à traiter`} tone="red" />
        <Stat label="Prêtes pour le DAF" value={c(invs, "Rapprochée", "Écart justifié")} href={`${B}?tab=fac&f=Rapprochée`} tone="green" />
        <Stat label="Transmises au DAF" value={c(invs, "Transmise au DAF")} href={`${B}?tab=fac&f=Transmise au DAF`} tone="blue" />
        <Stat label="Immo. non affectées" value={ims.filter((a) => a.assignStatus === "Non affecté").length} href={`${B}?tab=imm&f=Non affecté`} tone="amber" />
        <Stat label="Immo. sans fiche signée" value={ims.filter((a) => a.assignStatus === "Affectation non justifiée").length} href={`${B}?tab=imm&f=Affectation non justifiée`} tone="red" />
        <Stat label="Immo. sans emplacement" value={ims.filter((a) => !a.location).length} href={`${B}?tab=imm&f=noloc`} tone="amber" />
      </StatGrid>
    </>
  );
}

/* ----------------------------- DA ----------------------------- */
async function DaTab({ ctx }: { ctx: Ctx }) {
  const { sp, u, uname } = ctx;
  const r = u.role;
  if (sp.new || sp.edit) {
    let d: typeof purchaseRequests.$inferSelect | undefined;
    let ls: (typeof purchaseRequestLines.$inferSelect)[] = [];
    if (sp.edit) {
      d = (await db.select().from(purchaseRequests).where(eq(purchaseRequests.id, Number(sp.edit))))[0];
      ls = d ? await db.select().from(purchaseRequestLines).where(eq(purchaseRequestLines.daId, d.id)) : [];
    }
    return (
      <Card title={d ? `Modifier ${d.no}` : "Nouvelle demande d'achat"}>
        <form action={saveDa} className="space-y-4">
          <Back to={d ? `${B}?tab=da&edit=${d.id}` : `${B}?tab=da&new=1`} />
          {d && <input type="hidden" name="id" value={d.id} />}
          <KV items={[["N°", d?.no ?? "Attribué automatiquement (DA-AAAA-NNNN)"], ["Date", fdate(d?.createdAt ?? new Date())], ["Demandeur", u.fullName], ["Service", u.service ?? "—"]]} />
          <Grid>
            <Field label="Type de besoin" required>
              <select name="needType" defaultValue={d?.needType ?? "Usine/SAV"} className={inputCls}>
                <option>Usine/SAV</option><option>Hors Usine/SAV</option><option>Point de vente</option>
              </select>
            </Field>
            <Field label="Point de vente (si applicable)"><input name="pointOfSale" defaultValue={d?.pointOfSale ?? ""} className={inputCls} /></Field>
            <Field label="Urgence" required>
              <select name="urgency" defaultValue={d?.urgency ?? "Normale"} className={inputCls}><option>Normale</option><option>Urgente</option><option>Très urgente</option></select>
            </Field>
            <Field label="Motif" required className="md:col-span-3"><input name="motif" required defaultValue={d?.motif ?? ""} className={inputCls} /></Field>
          </Grid>
          <Extra><Field label="Justification"><textarea name="justification" defaultValue={d?.justification ?? ""} className={inputCls} rows={2} /></Field></Extra>
          <div>
            <h4 className="mb-2 text-sm font-semibold">Lignes (remplir uniquement les lignes utiles)</h4>
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => {
                const l = ls[i];
                return (
                  <div key={i} className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-2 md:grid-cols-12">
                    <input name={`designation_${i}`} defaultValue={l?.designation} placeholder={`Désignation ${i + 1}${i === 0 ? " *" : ""}`} className={`${inputCls} col-span-2 md:col-span-4`} />
                    <input name={`qty_${i}`} defaultValue={l?.qty} placeholder="Qté" className={`${inputCls} md:col-span-1`} />
                    <input name={`unit_${i}`} defaultValue={l?.unit ?? "U"} placeholder="Unité" className={`${inputCls} md:col-span-1`} />
                    <select name={`urg_${i}`} defaultValue={l?.urgency ?? "Normale"} className={`${inputCls} md:col-span-2`}><option>Normale</option><option>Urgente</option></select>
                    <input name={`just_${i}`} defaultValue={l?.justification ?? ""} placeholder="Justification" className={`${inputCls} md:col-span-3`} />
                    <label className="flex items-center gap-1 text-xs md:col-span-1"><input type="checkbox" name={`asset_${i}`} defaultChecked={l?.isAsset} /> Immo.</label>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Submit variant="secondary" name="intent" value="draft">Enregistrer brouillon</Submit>
            <Submit name="intent" value="submit" confirm="Soumettre cette demande au Responsable Achats Locaux ?">Soumettre au Responsable Achats Locaux</Submit>
          </div>
        </form>
      </Card>
    );
  }
  if (sp.id) {
    const d = (await db.select().from(purchaseRequests).where(eq(purchaseRequests.id, Number(sp.id))))[0];
    if (!d) return <Empty>DA introuvable.</Empty>;
    if (d.requesterId !== u.id && !can(r, "da.process") && !ctx.all && !can(r, "bc.manage")) return <Empty>Accès non autorisé.</Empty>;
    const ls = await db.select().from(purchaseRequestLines).where(eq(purchaseRequestLines.daId, d.id));
    const back = `${B}?tab=da&id=${d.id}`;
    const pol = ls.length ? await db.select({ l: purchaseOrderLines, po: purchaseOrders }).from(purchaseOrderLines).innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.poId)).where(inArray(purchaseOrderLines.daLineId, ls.map((l) => l.id))) : [];
    return (
      <>
        <Card title={<span>{d.no} <Badge s={d.status} /></span>} actions={<Btn href={`${B}?tab=da`} variant="secondary">← Liste</Btn>}>
          <KV items={[["Demandeur", uname(d.requesterId)], ["Service", d.service], ["Date", fdate(d.createdAt)], ["Type de besoin", d.needType], ["Point de vente", d.pointOfSale], ["Urgence", d.urgency], ["Motif", d.motif], ["Justification", d.justification], ["Dernier commentaire", d.comment]]} />
          <div className="mt-4">
            <Table cols={["Désignation", "Qté demandée", "Unité", "Commandée", "Restante", "Immo.", "Justification"]} rows={ls.map((l) => [l.designation, l.qty, l.unit, l.orderedQty, l.qty - l.orderedQty, l.isAsset ? "✔" : "", l.justification])} />
          </div>
          {pol.length > 0 && <p className="mt-3 text-sm">BC liés : {[...new Set(pol.map((x) => x.po.no))].map((no) => { const p = pol.find((x) => x.po.no === no)!.po; return <Link key={no} className="mr-2 text-red-700 underline" href={`${B}?tab=bc&id=${p.id}`}>{no}</Link>; })}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {d.requesterId === u.id && ["Brouillon", "À corriger"].includes(d.status) && <Btn href={`${B}?tab=da&edit=${d.id}`}>Modifier / Soumettre</Btn>}
          </div>
          {can(r, "da.process") && ["Soumise", "En cours de vérification"].includes(d.status) && d.requesterId !== u.id && (
            <form action={processDa} className="mt-4 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <Back to={back} /><input type="hidden" name="id" value={d.id} />
              <Field label="Commentaire (obligatoire pour correction ou rejet)"><textarea name="comment" className={inputCls} rows={2} /></Field>
              <div className="flex flex-wrap gap-2">
                {d.status === "Soumise" && <Submit variant="secondary" name="decision" value="review">Prendre en vérification</Submit>}
                <Submit variant="success" name="decision" value="accept" confirm="Accepter cette DA pour traitement ?">Accepter pour traitement</Submit>
                <Submit variant="secondary" name="decision" value="return">Retourner pour correction</Submit>
                <Submit variant="danger" name="decision" value="reject" confirm="Rejeter définitivement cette DA ?">Rejeter</Submit>
              </div>
            </form>
          )}
          {(d.requesterId === u.id || can(r, "da.process")) && !["Annulée", "Rejetée", "Clôturée", "Entièrement commandée"].includes(d.status) && (
            <form action={cancelDa} className="mt-3 flex flex-wrap gap-2">
              <Back to={back} /><input type="hidden" name="id" value={d.id} />
              <input name="reason" placeholder="Motif d'annulation" className={`${inputCls} max-w-sm`} />
              <Submit variant="danger" small confirm="Annuler cette DA ?">Annuler la DA</Submit>
            </form>
          )}
        </Card>
        <Attachments docType="DA" docId={d.id} docNo={d.no} back={back} canUpload={d.requesterId === u.id || can(r, "da.process")} />
        <History docNo={d.no} />
      </>
    );
  }
  let list = await db.select().from(purchaseRequests).orderBy(desc(purchaseRequests.id));
  if (!can(r, "da.process") && !ctx.all && !can(r, "bc.manage")) list = list.filter((d) => d.requesterId === u.id);
  list = list.filter((d) => (!sp.f || d.status === sp.f || (sp.f === "Soumise" && d.status === "En cours de vérification")) && match(sp.q, d.no, d.motif, uname(d.requesterId), d.service, d.needType, d.urgency));
  const pg = paginate(list, Number(sp.page));
  return (
    <Card title={can(r, "da.process") ? "File centralisée des DA" : "Mes demandes d'achat"} actions={can(r, "da.create") && <Btn href={`${B}?tab=da&new=1`}>+ Nouvelle demande d&apos;achat</Btn>}>
      <SearchBar base={B} tab="da" q={sp.q} extra={<select name="f" defaultValue={sp.f ?? ""} className={`${inputCls} max-w-[220px]`}><option value="">Tous statuts</option>{["Brouillon", "Soumise", "À corriger", "Acceptée pour traitement", "Partiellement commandée", "Entièrement commandée", "Rejetée", "Annulée", "Clôturée"].map((s) => <option key={s}>{s}</option>)}</select>} />
      <Table cols={["N°", "Date", "Demandeur", "Service", "Type", "Motif", "Urgence", "Statut", ""]} rows={pg.items.map((d) => [<b key="n">{d.no}</b>, fdate(d.createdAt), uname(d.requesterId), d.service, d.needType, d.motif, d.urgency === "Normale" ? d.urgency : <span key="u" className="font-semibold text-red-700">{d.urgency}</span>, <Badge key="s" s={d.status} />, <Link key="l" className="text-red-700 underline" href={`${B}?tab=da&id=${d.id}`}>Consulter</Link>])} />
      <Pager base={B} page={pg.page} pages={pg.pages} params={{ tab: "da", q: sp.q, f: sp.f }} />
    </Card>
  );
}

/* ----------------------------- BC ----------------------------- */
function SupplierSelect({ list, value }: { list: Ctx["supplierList"]; value?: number | null }) {
  return (
    <select name="supplierId" required defaultValue={value ?? ""} className={inputCls}>
      <option value="">— Fournisseur —</option>
      {list.filter((s) => s.kind === "LOCAL").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}

async function BcTab({ ctx }: { ctx: Ctx }) {
  const { sp, u, uname, sname } = ctx;
  const r = u.role;
  const threshold = Number(await getSetting("bc_threshold")) || 100;
  if (sp.new && can(r, "bc.manage")) {
    const rows = await db.select({ l: purchaseRequestLines, d: purchaseRequests }).from(purchaseRequestLines).innerJoin(purchaseRequests, eq(purchaseRequests.id, purchaseRequestLines.daId)).where(inArray(purchaseRequests.status, ["Acceptée pour traitement", "Partiellement commandée"]));
    const avail = rows.filter((x) => x.l.qty - x.l.orderedQty > 1e-9);
    return (
      <Card title="Nouveau bon de commande (à partir de DA acceptées)">
        {avail.length === 0 ? <Empty>Aucune ligne de DA acceptée avec reliquat à commander.</Empty> : (
          <form action={createPo} className="space-y-4">
            <Back to={`${B}?tab=bc&new=1`} />
            <Grid>
              <Field label="Fournisseur" required><SupplierSelect list={ctx.supplierList} /></Field>
              <Field label="Délai / date de livraison"><input type="date" name="deliveryDate" className={inputCls} /></Field>
              <Field label="Timbre fiscal (DT)" required><input name="stamp" defaultValue="1.000" className={inputCls} /></Field>
            </Grid>
            <Table cols={["✔", "DA", "Désignation", "Reliquat", "Qté à commander", "PU HT", "Remise %", "TVA %", "Immo."]} rows={avail.map(({ l, d }) => [
              <input key="c" type="checkbox" name="line" value={l.id} />, d.no, l.designation, `${l.qty - l.orderedQty} ${l.unit}`,
              <input key="q" name={`qty_${l.id}`} defaultValue={l.qty - l.orderedQty} className={`${inputCls} w-20`} />,
              <input key="p" name={`price_${l.id}`} placeholder="0.000" className={`${inputCls} w-24`} />,
              <input key="r" name={`disc_${l.id}`} defaultValue="0" className={`${inputCls} w-16`} />,
              <input key="t" name={`tva_${l.id}`} defaultValue="19" className={`${inputCls} w-16`} />, l.isAsset ? "✔" : "",
            ])} />
            <Extra>
              <Grid cols={2}>
                <Field label="Conditions de paiement / livraison"><textarea name="conditions" className={inputCls} rows={2} /></Field>
                <Field label="Observations"><textarea name="observations" className={inputCls} rows={2} /></Field>
              </Grid>
            </Extra>
            <p className="text-xs text-slate-500">Circuit : montant HT &lt; {threshold.toFixed(3)} DT → validation automatique ; ≥ seuil → Directeur Approvisionnement.</p>
            <div className="flex gap-2">
              <Submit variant="secondary" name="intent" value="draft">Enregistrer brouillon</Submit>
              <Submit name="intent" value="submit" confirm="Créer le BC et lancer le circuit de validation ?">Créer et soumettre</Submit>
            </div>
          </form>
        )}
      </Card>
    );
  }
  if (sp.id) {
    const po = (await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, Number(sp.id))))[0];
    if (!po) return <Empty>BC introuvable.</Empty>;
    const ls = await db.select({ l: purchaseOrderLines, dl: purchaseRequestLines, d: purchaseRequests }).from(purchaseOrderLines).innerJoin(purchaseRequestLines, eq(purchaseRequestLines.id, purchaseOrderLines.daLineId)).innerJoin(purchaseRequests, eq(purchaseRequests.id, purchaseRequestLines.daId)).where(eq(purchaseOrderLines.poId, po.id));
    const back = `${B}?tab=bc&id=${po.id}`;
    const printable = ["Validé", "Émis", "Partiellement reçu", "Entièrement reçu", "Clôturé"].includes(po.status);
    const editable = can(r, "bc.manage") && ["Brouillon", "En attente de validation", "Validé", "Rejeté", "À revalider", "Émis"].includes(po.status);
    return (
      <>
        <Card title={<span>{po.no} <Badge s={po.status} /></span>} actions={<div className="flex gap-2">{printable ? <Btn href={`/print/bc/${po.id}`} variant="secondary">🖨 Imprimer PDF</Btn> : <span className="text-xs text-slate-500">Impression bloquée jusqu&apos;à validation</span>}<Btn href={`${B}?tab=bc`} variant="secondary">← Liste</Btn></div>}>
          <KV items={[["Fournisseur", sname(po.supplierId)], ["Date", fdate(po.createdAt)], ["Créé par", uname(po.createdBy)], ["Livraison prévue", fdate(po.deliveryDate)], ["Validé par", po.validatedBy ? `${uname(po.validatedBy)} – ${fdt(po.validatedAt)}` : po.validatedAt ? `Automatique – ${fdt(po.validatedAt)}` : "—"], ["Émis le", fdt(po.sentAt)], ["Conditions", po.conditions], ["Motif rejet/annulation", po.rejectReason]]} />
          {sp.edit && editable ? (
            <form action={editPo} className="mt-4 space-y-3">
              <Back to={back} /><input type="hidden" name="id" value={po.id} />
              <Grid>
                <Field label="Fournisseur" required><SupplierSelect list={ctx.supplierList} value={po.supplierId} /></Field>
                <Field label="Date de livraison"><input type="date" name="deliveryDate" defaultValue={po.deliveryDate ?? ""} className={inputCls} /></Field>
                <Field label="Timbre"><input name="stamp" defaultValue={po.stamp} className={inputCls} /></Field>
              </Grid>
              <Table cols={["DA", "Désignation", "Qté", "PU HT", "Remise %", "TVA %"]} rows={ls.map(({ l, d }) => [d.no, l.designation, <input key="q" name={`qty_${l.id}`} defaultValue={l.qty} className={`${inputCls} w-20`} />, <input key="p" name={`price_${l.id}`} defaultValue={l.unitPrice} className={`${inputCls} w-24`} />, <input key="d" name={`disc_${l.id}`} defaultValue={l.discount} className={`${inputCls} w-16`} />, <input key="t" name={`tva_${l.id}`} defaultValue={l.tva} className={`${inputCls} w-16`} />])} />
              <input type="hidden" name="conditions" value={po.conditions ?? ""} />
              <Field label="Motif de la modification" required><input name="reason" required className={inputCls} /></Field>
              {["Validé", "Émis"].includes(po.status) && <p className="text-xs font-medium text-amber-700">⚠ Ce BC est validé : toute modification le fera passer à « À revalider » si le montant ≥ seuil.</p>}
              <div className="flex gap-2"><Submit variant="secondary" name="intent" value="draft">Brouillon</Submit><Submit name="intent" value="submit" confirm="Enregistrer les modifications et relancer le circuit ?">Enregistrer et soumettre</Submit></div>
            </form>
          ) : (
            <div className="mt-4">
              <Table cols={["Réf. DA / ligne", "Désignation", "Qté", "PU HT", "Remise", "TVA", "Montant HT", "Reçue", "Reliquat"]} rows={ls.map(({ l, d, dl }) => [`${d.no} / L${dl.id}`, <span key="d">{l.designation} {l.isAsset && <Badge s="Immo." />}</span>, `${l.qty} ${l.unit}`, tnd(l.unitPrice), `${l.discount}%`, `${l.tva}%`, tnd(lineAmounts(l).ht), l.receivedQty, l.qty - l.receivedQty])} />
              <div className="mt-3 ml-auto max-w-xs space-y-1 text-sm">
                <div className="flex justify-between"><span>Total HT</span><b>{tnd(po.totalHt)}</b></div>
                <div className="flex justify-between"><span>TVA</span><b>{tnd(po.totalTva)}</b></div>
                <div className="flex justify-between"><span>Timbre fiscal</span><b>{tnd(po.stamp)}</b></div>
                <div className="flex justify-between border-t pt-1 text-base"><span>Total TTC</span><b className="text-red-700">{tnd(po.totalTtc)}</b></div>
              </div>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {editable && !sp.edit && <Btn href={`${back}&edit=1`} variant="secondary">Modifier</Btn>}
            {can(r, "bc.manage") && ["Brouillon", "Rejeté"].includes(po.status) && <form action={submitPo}><Back to={back} /><input type="hidden" name="id" value={po.id} /><Submit>Soumettre</Submit></form>}
            {can(r, "bc.manage") && po.status === "Validé" && <form action={emitPo}><Back to={back} /><input type="hidden" name="id" value={po.id} /><Submit variant="success" confirm={`Émettre ${po.no} au fournisseur ${sname(po.supplierId)} pour ${tnd(po.totalTtc)} TTC ?`}>Émettre au fournisseur</Submit></form>}
          </div>
          {can(r, "bc.validate") && ["En attente de validation", "À revalider"].includes(po.status) && (
            <form action={decidePo} className="mt-4 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <Back to={back} /><input type="hidden" name="id" value={po.id} />
              <p className="text-sm">Résumé : <b>{sname(po.supplierId)}</b> – {ls.length} ligne(s) – <b>{tnd(po.totalHt)} HT</b> / {tnd(po.totalTtc)} TTC</p>
              <Field label="Motif (obligatoire en cas de rejet)"><input name="reason" className={inputCls} /></Field>
              <div className="flex gap-2"><Submit variant="success" name="decision" value="validate" confirm={`Valider ${po.no} (${tnd(po.totalHt)} HT) ?`}>Valider</Submit><Submit variant="danger" name="decision" value="reject">Rejeter</Submit></div>
            </form>
          )}
          {can(r, "bc.manage") && !["Annulé", "Clôturé"].includes(po.status) && (
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              <form action={cancelPo} className="flex gap-2"><Back to={back} /><input type="hidden" name="id" value={po.id} /><input name="reason" placeholder="Motif d'annulation" className={inputCls} /><Submit variant="danger" small confirm="Annuler ce BC ?">Annuler</Submit></form>
              {["Entièrement reçu", "Partiellement reçu"].includes(po.status) && <form action={closePo} className="flex gap-2"><Back to={back} /><input type="hidden" name="id" value={po.id} /><input name="reason" placeholder={po.status === "Partiellement reçu" ? "Motif clôture du reliquat" : "Soldé"} className={inputCls} /><Submit variant="secondary" small>Clôturer</Submit></form>}
            </div>
          )}
        </Card>
        <Attachments docType="BC" docId={po.id} docNo={po.no} back={back} canUpload={can(r, "bc.manage")} />
        <History docNo={po.no} />
      </>
    );
  }
  let list = await db.select().from(purchaseOrders).orderBy(desc(purchaseOrders.id));
  list = list.filter((p) => (!sp.f || p.status === sp.f || (sp.f === "late" && ["Émis", "Partiellement reçu"].includes(p.status) && !!p.deliveryDate && p.deliveryDate < today())) && match(sp.q, p.no, sname(p.supplierId), p.status));
  const pg = paginate(list, Number(sp.page));
  return (
    <Card title="Bons de commande" actions={can(r, "bc.manage") && <Btn href={`${B}?tab=bc&new=1`}>+ Nouveau BC</Btn>}>
      <SearchBar base={B} tab="bc" q={sp.q} />
      <Table cols={["N°", "Date", "Fournisseur", "HT", "TTC", "Livraison", "Statut", "Responsable", ""]} rows={pg.items.map((p) => [<b key="n">{p.no}</b>, fdate(p.createdAt), sname(p.supplierId), tnd(p.totalHt), tnd(p.totalTtc), fdate(p.deliveryDate), <Badge key="s" s={p.status} />, uname(p.createdBy), <Link key="l" className="text-red-700 underline" href={`${B}?tab=bc&id=${p.id}`}>{p.status.includes("attente") || p.status === "À revalider" ? "Traiter" : "Consulter"}</Link>])} />
      <Pager base={B} page={pg.page} pages={pg.pages} params={{ tab: "bc", q: sp.q, f: sp.f }} />
    </Card>
  );
}

/* ----------------------------- Réceptions fournisseur ----------------------------- */
async function RcfTab({ ctx }: { ctx: Ctx }) {
  const { sp, u, uname, sname } = ctx;
  const r = u.role;
  if (sp.new && can(r, "rcf.admin")) {
    const open = await db.select().from(purchaseOrders).where(inArray(purchaseOrders.status, ["Émis", "Partiellement reçu"]));
    const po = sp.po ? open.find((p) => p.id === Number(sp.po)) : undefined;
    const ls = po ? await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, po.id)) : [];
    return (
      <Card title="Nouvelle réception administrative (BL fournisseur)">
        <form method="get" action={B} className="mb-4 flex gap-2">
          <input type="hidden" name="tab" value="rcf" /><input type="hidden" name="new" value="1" />
          <select name="po" defaultValue={sp.po ?? ""} className={`${inputCls} max-w-md`}><option value="">— Sélectionner un BC émis —</option>{open.map((p) => <option key={p.id} value={p.id}>{p.no} – {sname(p.supplierId)}</option>)}</select>
          <button className="rounded-lg border px-3 text-sm">Charger</button>
        </form>
        {po && (
          <form action={createReceipt} className="space-y-3">
            <Back to={`${B}?tab=rcf&new=1&po=${po.id}`} /><input type="hidden" name="poId" value={po.id} />
            <KV items={[["BC", po.no], ["Fournisseur", sname(po.supplierId)], ["Livraison prévue", fdate(po.deliveryDate)]]} />
            <Grid>
              <Field label="N° BL fournisseur" required><input name="blNumber" required className={inputCls} /></Field>
              <Field label="Date de réception" required><input type="date" name="receiptDate" defaultValue={today()} required className={inputCls} /></Field>
              <Field label="Commentaire"><input name="comment" className={inputCls} /></Field>
            </Grid>
            <Table cols={["Désignation", "Commandée", "Déjà reçue", "Reliquat", "Qté reçue", "État", "Commentaire"]} rows={ls.map((l) => [l.designation, l.qty, l.receivedQty, l.qty - l.receivedQty, <input key="q" name={`qty_${l.id}`} defaultValue={l.qty - l.receivedQty} className={`${inputCls} w-20`} />, <select key="s" name={`state_${l.id}`} className={`${inputCls} w-36`}><option>Conforme</option><option>Non conforme</option><option>Anomalie</option></select>, <input key="c" name={`com_${l.id}`} className={inputCls} />])} />
            <Submit confirm="Enregistrer cette réception ? La confirmation physique « Reçu conforme » sera faite par le réceptionnaire habilité.">Enregistrer la réception</Submit>
          </form>
        )}
      </Card>
    );
  }
  if (sp.id) {
    const rc = (await db.select().from(supplierReceipts).where(eq(supplierReceipts.id, Number(sp.id))))[0];
    if (!rc) return <Empty>Réception introuvable.</Empty>;
    const po = (await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, rc.poId)))[0];
    const ls = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, po.id));
    const back = `${B}?tab=rcf&id=${rc.id}`;
    const canConfirm = can(r, "rcf.confirm") && rc.status === "En attente de réception";
    return (
      <>
        <Card title={<span>{rc.no} <Badge s={rc.status} /></span>} actions={<Btn href={`${B}?tab=rcf`} variant="secondary">← Liste</Btn>}>
          <KV items={[["BC", <Link key="b" className="text-red-700 underline" href={`${B}?tab=bc&id=${po.id}`}>{po.no}</Link>], ["Fournisseur", sname(po.supplierId)], ["N° BL", rc.blNumber], ["Date réception", fdate(rc.receiptDate)], ["Enregistrée par", uname(rc.createdBy)], ["Reçu conforme par", rc.confirmedBy ? `${uname(rc.confirmedBy)} – ${fdt(rc.confirmedAt)}` : "Non confirmé"], ["Commentaire", rc.comment]]} />
          {canConfirm ? (
            <form action={confirmReceipt} className="mt-4 space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <Back to={back} /><input type="hidden" name="id" value={rc.id} />
              <p className="text-sm font-medium">Vérification physique : confirmez les quantités réellement reçues et l&apos;état de chaque ligne.</p>
              <Table cols={["Désignation", "Qté déclarée", "Qté réellement reçue", "État", "Commentaire"]} rows={rc.lines.map((l) => { const pl = ls.find((x) => x.id === l.poLineId); return [pl?.designation, l.qty, <input key="q" name={`qty_${l.poLineId}`} defaultValue={l.qty} className={`${inputCls} w-20`} />, <select key="s" name={`state_${l.poLineId}`} defaultValue={l.state} className={`${inputCls} w-36`}><option>Conforme</option><option>Non conforme</option><option>Anomalie</option></select>, <input key="c" name={`com_${l.poLineId}`} defaultValue={l.comment ?? ""} className={inputCls} />]; })} />
              <Submit variant="success" confirm="Confirmer la réception physique ? Votre identité, la date et l'heure seront enregistrées.">Confirmer « Reçu conforme » / signaler anomalie</Submit>
            </form>
          ) : (
            <div className="mt-4"><Table cols={["Désignation", "Qté", "État", "Commentaire"]} rows={rc.lines.map((l) => [ls.find((x) => x.id === l.poLineId)?.designation, l.qty, <Badge key="s" s={l.state} />, l.comment])} /></div>
          )}
          {["Réception avec anomalie", "En cours de régularisation"].includes(rc.status) && (can(r, "rcf.admin") || can(r, "rcf.confirm")) && (
            <form action={regularizeReceipt} className="mt-3 flex gap-2"><Back to={back} /><input type="hidden" name="id" value={rc.id} /><input name="comment" placeholder="Commentaire de régularisation" className={inputCls} /><Submit variant="secondary" small>{rc.status === "Réception avec anomalie" ? "Mettre en régularisation" : "Marquer régularisé"}</Submit></form>
          )}
        </Card>
        <Attachments docType="RCF" docId={rc.id} docNo={rc.no} back={back} />
        <History docNo={rc.no} />
      </>
    );
  }
  const list = (await db.select().from(supplierReceipts).orderBy(desc(supplierReceipts.id))).filter((x) => (!sp.f || x.status === sp.f) && match(sp.q, x.no, x.blNumber, x.status));
  const pos = await db.select().from(purchaseOrders);
  const pg = paginate(list, Number(sp.page));
  return (
    <Card title="Réceptions / BL fournisseurs" actions={can(r, "rcf.admin") && <Btn href={`${B}?tab=rcf&new=1`}>+ Nouvelle réception</Btn>}>
      <SearchBar base={B} tab="rcf" q={sp.q} />
      <Table cols={["N°", "BC", "Fournisseur", "BL", "Date", "Statut", "Confirmé par", ""]} rows={pg.items.map((x) => { const p = pos.find((y) => y.id === x.poId); return [<b key="n">{x.no}</b>, p?.no, sname(p?.supplierId), x.blNumber, fdate(x.receiptDate), <Badge key="s" s={x.status} />, x.confirmedBy ? uname(x.confirmedBy) : "—", <Link key="l" className="text-red-700 underline" href={`${B}?tab=rcf&id=${x.id}`}>{x.status === "En attente de réception" && can(r, "rcf.confirm") ? "Confirmer" : "Consulter"}</Link>]; })} />
      <Pager base={B} page={pg.page} pages={pg.pages} params={{ tab: "rcf", q: sp.q, f: sp.f }} />
    </Card>
  );
}

/* ----------------------------- Factures ----------------------------- */
async function FacTab({ ctx }: { ctx: Ctx }) {
  const { sp, u, uname, sname } = ctx;
  const r = u.role;
  const pos = await db.select().from(purchaseOrders);
  const rcs = await db.select().from(supplierReceipts);
  if (sp.new && can(r, "inv.manage")) {
    const okPos = pos.filter((p) => ["Validé", "Émis", "Partiellement reçu", "Entièrement reçu", "Clôturé"].includes(p.status));
    return (
      <Card title="Enregistrer une facture fournisseur">
        <form action={createInvoice} className="space-y-3">
          <Back to={`${B}?tab=fac&new=1`} />
          <Grid>
            <Field label="Fournisseur" required><SupplierSelect list={ctx.supplierList} /></Field>
            <Field label="N° facture" required><input name="invoiceNumber" required className={inputCls} /></Field>
            <Field label="Date facture" required><input type="date" name="invoiceDate" required defaultValue={today()} className={inputCls} /></Field>
            <Field label="Montant HT (DT)" required><input name="ht" required className={inputCls} /></Field>
            <Field label="TVA (DT)" required><input name="tva" required className={inputCls} /></Field>
            <Field label="Timbre fiscal (DT)" required><input name="stamp" defaultValue="1.000" className={inputCls} /></Field>
          </Grid>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="BC associés"><div className="max-h-48 space-y-1 overflow-y-auto rounded border p-2 text-sm">{okPos.map((p) => <label key={p.id} className="flex gap-2"><input type="checkbox" name="poIds" value={p.id} />{p.no} – {sname(p.supplierId)} – {tnd(p.totalHt)} HT</label>)}</div></Field>
            <Field label="BL / réceptions associés"><div className="max-h-48 space-y-1 overflow-y-auto rounded border p-2 text-sm">{rcs.map((x) => <label key={x.id} className="flex gap-2"><input type="checkbox" name="receiptIds" value={x.id} />{x.no} – BL {x.blNumber} ({pos.find((p) => p.id === x.poId)?.no}) – {x.status}</label>)}</div></Field>
          </div>
          <Field label="Commentaire"><input name="comment" className={inputCls} /></Field>
          <p className="text-xs text-slate-500">Le TTC est calculé (HT + TVA + timbre). Le rapprochement BC/BL/facture est effectué automatiquement.</p>
          <Submit>Enregistrer et rapprocher</Submit>
        </form>
      </Card>
    );
  }
  if (sp.id) {
    const inv = (await db.select().from(invoices).where(eq(invoices.id, Number(sp.id))))[0];
    if (!inv) return <Empty>Facture introuvable.</Empty>;
    const issues = await matchInvoice(inv);
    const back = `${B}?tab=fac&id=${inv.id}`;
    const ActionBtn = ({ step, label, v = "secondary" }: { step: string; label: string; v?: string }) => <Submit variant={v} name="step" value={step} small>{label}</Submit>;
    return (
      <>
        <Card title={<span>{inv.no} – Facture {inv.invoiceNumber} <Badge s={inv.status} /></span>} actions={<Btn href={`${B}?tab=fac`} variant="secondary">← Liste</Btn>}>
          <KV items={[["Fournisseur", sname(inv.supplierId)], ["Date", fdate(inv.invoiceDate)], ["BC", inv.poIds.map((i) => pos.find((p) => p.id === i)?.no).join(", ")], ["BL", inv.receiptIds.map((i) => rcs.find((p) => p.id === i)?.blNumber).join(", ") || "—"], ["HT", tnd(inv.ht)], ["TVA", tnd(inv.tva)], ["Timbre", tnd(inv.stamp)], ["TTC", tnd(inv.ttc)], ["Saisie par", uname(inv.createdBy)]]} />
          <div className="mt-4">
            <h4 className="mb-1 text-sm font-semibold">Contrôle de rapprochement</h4>
            {issues.length === 0 ? <p className="text-sm text-emerald-700">✓ Aucun écart détecté.</p> : <ul className="list-disc pl-5 text-sm text-red-700">{issues.map((i) => <li key={i}>{i}</li>)}</ul>}
          </div>
          <p className="mt-3 text-xs text-slate-500">« Transmise au DAF » signifie uniquement que le dossier est prêt pour le contrôle financier ; seuls le DAF / la Comptabilité mettent à jour les statuts comptables.</p>
          {can(r, "inv.manage") && (
            <form action={invoiceAction} className="mt-3 flex flex-wrap gap-2"><Back to={back} /><input type="hidden" name="id" value={inv.id} />
              <input name="comment" placeholder="Justification / motif" className={`${inputCls} max-w-md`} />
              {inv.status === "Écart à traiter" && <ActionBtn step="justify" label="Justifier / autoriser l'écart" />}
              {["Rapprochée", "Écart justifié"].includes(inv.status) && <ActionBtn step="transmit" label="Transmettre au DAF" v="primary" />}
              {!["Comptabilisée", "Payée", "Annulée"].includes(inv.status) && <ActionBtn step="cancel" label="Annuler" v="danger" />}
            </form>
          )}
          {can(r, "inv.daf") && (
            <form action={invoiceAction} className="mt-3 flex flex-wrap gap-2 rounded-lg bg-sky-50 p-3"><Back to={back} /><input type="hidden" name="id" value={inv.id} />
              <input name="comment" placeholder="Commentaire DAF" className={`${inputCls} max-w-md`} />
              {inv.status === "Transmise au DAF" && <><ActionBtn step="bap" label="Bon à payer (BAP)" v="success" /><ActionBtn step="return" label="Retourner aux achats" v="danger" /></>}
              {inv.status === "Bon à payer" && <ActionBtn step="post" label="Marquer comptabilisée" v="success" />}
              {inv.status === "Comptabilisée" && <ActionBtn step="pay" label="Marquer payée" v="success" />}
            </form>
          )}
        </Card>
        <Attachments docType="FAC" docId={inv.id} docNo={inv.no} back={back} canUpload={can(r, "inv.manage") || can(r, "inv.daf")} />
        <History docNo={inv.no} />
      </>
    );
  }
  let list = await db.select().from(invoices).orderBy(desc(invoices.id));
  if (can(r, "inv.daf") && !can(r, "inv.manage")) list = list.filter((i) => ["Transmise au DAF", "Bon à payer", "Comptabilisée", "Payée"].includes(i.status));
  list = list.filter((i) => (!sp.f || i.status === sp.f) && match(sp.q, i.no, i.invoiceNumber, sname(i.supplierId)));
  const pg = paginate(list, Number(sp.page));
  return (
    <Card title="Factures fournisseurs" actions={can(r, "inv.manage") && <Btn href={`${B}?tab=fac&new=1`}>+ Nouvelle facture</Btn>}>
      <SearchBar base={B} tab="fac" q={sp.q} />
      <Table cols={["N°", "Facture", "Date", "Fournisseur", "BC", "TTC", "Statut", ""]} rows={pg.items.map((i) => [<b key="n">{i.no}</b>, i.invoiceNumber, fdate(i.invoiceDate), sname(i.supplierId), i.poIds.map((x) => pos.find((p) => p.id === x)?.no).join(", "), tnd(i.ttc), <Badge key="s" s={i.status} />, <Link key="l" className="text-red-700 underline" href={`${B}?tab=fac&id=${i.id}`}>Consulter</Link>])} />
      <Pager base={B} page={pg.page} pages={pg.pages} params={{ tab: "fac", q: sp.q, f: sp.f }} />
    </Card>
  );
}

/* ----------------------------- Rapprochement ----------------------------- */
async function RapTab({ ctx }: { ctx: Ctx }) {
  const { sp, sname } = ctx;
  const [pos, lines, dls, das, rcs, invs] = await Promise.all([db.select().from(purchaseOrders).orderBy(desc(purchaseOrders.id)), db.select().from(purchaseOrderLines), db.select().from(purchaseRequestLines), db.select().from(purchaseRequests), db.select().from(supplierReceipts), db.select().from(invoices)]);
  const rows = pos.filter((p) => match(sp.q, p.no, sname(p.supplierId))).map((p) => {
    const ls = lines.filter((l) => l.poId === p.id);
    const daNos = [...new Set(ls.map((l) => das.find((d) => d.id === dls.find((x) => x.id === l.daLineId)?.daId)?.no))].join(", ");
    const demanded = ls.reduce((s, l) => s + (dls.find((x) => x.id === l.daLineId)?.qty ?? 0), 0);
    const ordered = ls.reduce((s, l) => s + l.qty, 0);
    const received = ls.reduce((s, l) => s + l.receivedQty, 0);
    const pi = invs.filter((i) => i.poIds.includes(p.id) && i.status !== "Annulée");
    const invoiced = pi.reduce((s, i) => s + i.ht / i.poIds.length, 0);
    const prc = rcs.filter((x) => x.poId === p.id);
    const alerts: string[] = [];
    if (prc.some((x) => ["Réception avec anomalie", "En cours de régularisation"].includes(x.status))) alerts.push("Anomalie réception");
    if (prc.some((x) => x.status === "En attente de réception")) alerts.push("Réception non confirmée");
    if (received > 0 && !pi.length) alerts.push("Facture manquante");
    if (invoiced > p.totalHt + 0.001) alerts.push("Facturé > commandé");
    if (p.deliveryDate && p.deliveryDate < today() && ["Émis", "Partiellement reçu"].includes(p.status)) alerts.push("Retard livraison");
    const daf = pi.some((i) => ["Transmise au DAF", "Bon à payer", "Comptabilisée", "Payée"].includes(i.status));
    return [<Link key="n" href={`${B}?tab=bc&id=${p.id}`} className="font-semibold text-red-700 underline">{p.no}</Link>, daNos, sname(p.supplierId), demanded, ordered, received, tnd(p.totalHt), tnd(invoiced), <Badge key="s" s={p.status} />, pi.map((i) => i.status).join(", ") || "—", daf ? "✔" : "—", alerts.length ? <span key="a" className="text-xs font-semibold text-red-700">{alerts.join(" · ")}</span> : <span key="a" className="text-xs text-emerald-700">OK</span>];
  });
  return (
    <Card title="Rapprochement DA → BC → BL → Facture → DAF">
      <SearchBar base={B} tab="rap" q={sp.q} />
      <Table cols={["BC", "DA", "Fournisseur", "Qté dem.", "Qté cdée", "Qté reçue", "HT BC", "HT facturé", "Statut BC", "Factures", "DAF", "Alertes"]} rows={rows} />
    </Card>
  );
}

/* ----------------------------- Immobilisations ----------------------------- */
async function ImmTab({ ctx }: { ctx: Ctx }) {
  const { sp, u, sname, uname } = ctx;
  const canEdit = can(u.role, "asset.manage");
  if (sp.id) {
    const a = (await db.select().from(assets).where(eq(assets.id, Number(sp.id))))[0];
    if (!a) return <Empty>Introuvable.</Empty>;
    const moves = await db.select().from(assetMoves).where(eq(assetMoves.assetId, a.id)).orderBy(desc(assetMoves.id));
    const back = `${B}?tab=imm&id=${a.id}`;
    const H = ({ step }: { step: string }) => <><Back to={back} /><input type="hidden" name="id" value={a.id} /><input type="hidden" name="step" value={step} /></>;
    return (
      <>
        <Card title={<span>{a.code} – {a.designation} <Badge s={a.assignStatus} /></span>} actions={<div className="flex gap-2"><Btn href={`/print/imm/${a.id}`} variant="secondary">🖨 Fiche d&apos;affectation</Btn><Btn href={`${B}?tab=imm`} variant="secondary">← Liste</Btn></div>}>
          <KV items={[["Marque", a.brand], ["Modèle", a.model], ["N° série", a.serial], ["Acquisition", fdate(a.acquisitionDate)], ["Fournisseur", sname(a.supplierId)], ["Références DA/BC/BL", a.refs], ["Service", a.service], ["Emplacement", a.location], ["Personnel affecté", a.holder], ["État", a.condition]]} />
          {canEdit && !["Cédé", "Mis au rebut"].includes(a.assignStatus) && (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <form action={assetAction} className="space-y-2 rounded-lg border p-3"><H step="complete" /><h4 className="text-sm font-semibold">Compléter la fiche</h4>
                <Grid cols={2}><input name="brand" defaultValue={a.brand ?? ""} placeholder="Marque" className={inputCls} /><input name="model" defaultValue={a.model ?? ""} placeholder="Modèle" className={inputCls} /><input name="serial" defaultValue={a.serial ?? ""} placeholder="N° série" className={inputCls} /><input name="condition" defaultValue={a.condition ?? ""} placeholder="État" className={inputCls} /></Grid>
                <Submit variant="secondary" small>Enregistrer</Submit>
              </form>
              <form action={assetAction} className="space-y-2 rounded-lg border p-3"><H step={a.holder ? "transfer" : "assign"} /><h4 className="text-sm font-semibold">{a.holder ? "Transfert / changement de détenteur" : "Affectation"}</h4>
                <Grid cols={2}><input name="holder" placeholder="Personnel affecté *" className={inputCls} /><input name="service" defaultValue={a.service ?? ""} placeholder="Service *" className={inputCls} /><input name="location" placeholder="Emplacement *" className={inputCls} /><input name="reason" placeholder={a.holder ? "Motif *" : "Accessoires / commentaire"} className={inputCls} /></Grid>
                <Submit small>Enregistrer</Submit>
              </form>
              {a.assignStatus === "Affectation non justifiée" && <form action={assetAction} className="rounded-lg border border-amber-200 bg-amber-50 p-3"><H step="justify" /><p className="mb-2 text-sm">Imprimez la fiche, faites-la signer, joignez le scan ci-dessous puis validez.</p><Submit variant="success" small>Valider le justificatif signé</Submit></form>}
              <form action={assetAction} className="space-y-2 rounded-lg border p-3"><Back to={back} /><input type="hidden" name="id" value={a.id} /><h4 className="text-sm font-semibold">Restitution / cession / mise au rebut</h4>
                <input name="reason" placeholder="Motif, accessoires restitués, état constaté *" className={inputCls} />
                <Grid cols={2}><input name="condition" placeholder="État du matériel" className={inputCls} /><input name="location" placeholder="Nouvel emplacement (restitution)" className={inputCls} /></Grid>
                <div className="flex flex-wrap gap-2"><Submit variant="secondary" small name="step" value="restitution">Restitution</Submit><Submit variant="danger" small name="step" value="cession" confirm="Confirmer la cession ?">Cession</Submit><Submit variant="danger" small name="step" value="rebut" confirm="Confirmer la mise au rebut ?">Mise au rebut</Submit></div>
              </form>
            </div>
          )}
        </Card>
        <Card title="Mouvements (historique non effaçable)">
          <Table cols={["Date", "Type", "Ancien détenteur", "Nouveau", "Ancien empl.", "Nouvel empl.", "Motif", "Par"]} rows={moves.map((m) => [fdt(m.createdAt), m.kind, m.oldHolder, m.newHolder, m.oldLocation, m.newLocation, m.reason, uname(m.userId)])} />
        </Card>
        <Attachments docType="IMM" docId={a.id} docNo={a.code} back={back} canUpload={canEdit} />
        <History docNo={a.code} />
      </>
    );
  }
  const list = (await db.select().from(assets).orderBy(desc(assets.id))).filter((a) => (!sp.f || a.assignStatus === sp.f || (sp.f === "noloc" && !a.location)) && match(sp.q, a.code, a.designation, a.service, a.holder, a.serial, a.location));
  const pg = paginate(list, Number(sp.page));
  return (
    <Card title="Registre des immobilisations" actions={<a href="/api/export?type=assets" className="rounded-lg border px-3 py-2 text-sm">⬇ Export Excel (CSV)</a>}>
      <SearchBar base={B} tab="imm" q={sp.q} extra={<select name="f" defaultValue={sp.f ?? ""} className={`${inputCls} max-w-[220px]`}><option value="">Tous</option><option>Non affecté</option><option>Affectation non justifiée</option><option>Affecté</option><option value="noloc">Sans emplacement</option><option>Cédé</option><option>Mis au rebut</option></select>} />
      <Table cols={["Code", "Désignation", "N° série", "Service", "Emplacement", "Détenteur", "Statut", ""]} rows={pg.items.map((a) => [<b key="c">{a.code}</b>, a.designation, a.serial ?? <span key="s" className="text-xs text-slate-400">non renseigné</span>, a.service, a.location ?? <span key="l" className="text-xs text-red-600">sans emplacement</span>, a.holder, <Badge key="b" s={a.assignStatus} />, <Link key="k" className="text-red-700 underline" href={`${B}?tab=imm&id=${a.id}`}>Consulter</Link>])} />
      <Pager base={B} page={pg.page} pages={pg.pages} params={{ tab: "imm", q: sp.q, f: sp.f }} />
    </Card>
  );
}
