import Link from "next/link";
import type { ReactNode } from "react";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  assets, componentRequests, deliveries, exitSlips, importFiles, missions, packingLists, productions, purchaseOrderLines, purchaseOrders, purchaseRequestLines, purchaseRequests, receptions, suppliers, transfers, users,
} from "@/db/schema";
import { Logo } from "@/components/ui";
import { PrintButton } from "@/components/client";
import { requireUser } from "@/lib/auth";
import { fdate, fdt, getSettings, tnd } from "@/lib/core";
import { lineAmounts } from "@/lib/achats";

export const dynamic = "force-dynamic";

function Doc({ title, no, company, children, signatures }: { title: string; no: string; company: Record<string, string>; children: ReactNode; signatures: string[] }) {
  return (
    <main className="min-h-screen bg-slate-200 p-4 print:bg-white print:p-0">
      <div className="no-print mx-auto mb-3 flex max-w-4xl justify-between"><Link href="/" className="text-sm text-slate-600 underline">← Retour à l&apos;application</Link><PrintButton /></div>
      <div className="print-area mx-auto max-w-4xl rounded-lg bg-white p-10 shadow">
        <div className="flex items-start justify-between border-b-4 border-red-700 pb-4">
          <div className="flex items-center gap-4"><Logo className="h-20" /><div className="text-xs text-slate-600"><div className="text-sm font-bold text-slate-900">{company.company_name}</div><div>{company.company_address}</div></div></div>
          <div className="text-right"><div className="text-xl font-bold uppercase tracking-wide">{title}</div><div className="mt-1 font-mono text-lg text-red-700">{no}</div><div className="text-xs text-slate-500">Imprimé le {fdt(new Date())}</div></div>
        </div>
        <div className="mt-6 space-y-4 text-sm">{children}</div>
        <div className={`mt-12 grid gap-6`} style={{ gridTemplateColumns: `repeat(${signatures.length}, minmax(0, 1fr))` }}>
          {signatures.map((s) => <div key={s} className="h-24 rounded border border-dashed border-slate-400 p-2 text-xs text-slate-500">{s}</div>)}
        </div>
      </div>
    </main>
  );
}

const T = ({ cols, rows }: { cols: string[]; rows: ReactNode[][] }) => (
  <table className="w-full border-collapse text-sm"><thead><tr>{cols.map((c) => <th key={c} className="border bg-slate-100 px-2 py-1 text-left">{c}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="border px-2 py-1">{c}</td>)}</tr>)}</tbody></table>
);
const KV = ({ items }: { items: [string, ReactNode][] }) => <div className="grid grid-cols-2 gap-x-8 gap-y-1">{items.map(([k, v]) => <div key={k}><span className="text-slate-500">{k} : </span><b>{v ?? "—"}</b></div>)}</div>;

export default async function PrintPage({ params }: { params: Promise<{ type: string; id: string }> }) {
  await requireUser();
  const { type, id: rawId } = await params;
  const id = Number(rawId);
  const company = await getSettings();
  const us = await db.select().from(users);
  const uname = (i: number | null) => us.find((x) => x.id === i)?.fullName ?? "—";

  if (type === "bc") {
    const po = (await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)))[0];
    if (!po) return <p>Introuvable</p>;
    if (!["Validé", "Émis", "Partiellement reçu", "Entièrement reçu", "Clôturé"].includes(po.status)) return <p className="p-10 text-red-700">Impression du document définitif bloquée : BC non validé ({po.status}).</p>;
    const s = (await db.select().from(suppliers).where(eq(suppliers.id, po.supplierId ?? 0)))[0];
    const ls = await db.select({ l: purchaseOrderLines, d: purchaseRequests }).from(purchaseOrderLines).innerJoin(purchaseRequestLines, eq(purchaseRequestLines.id, purchaseOrderLines.daLineId)).innerJoin(purchaseRequests, eq(purchaseRequests.id, purchaseRequestLines.daId)).where(eq(purchaseOrderLines.poId, po.id));
    return (
      <Doc title="Bon de commande" no={po.no} company={company} signatures={["Responsable Achats Locaux", "Directeur Approvisionnement", "Cachet fournisseur"]}>
        <KV items={[["Date", fdate(po.createdAt)], ["Fournisseur", s?.name], ["Contact", s?.contact], ["Livraison", fdate(po.deliveryDate)], ["Validé le", fdt(po.validatedAt)], ["Réf. DA", [...new Set(ls.map((x) => x.d.no))].join(", ")]]} />
        <T cols={["Réf. DA", "Désignation", "Qté", "PU HT", "Remise", "TVA", "Montant HT"]} rows={ls.map(({ l, d }) => [d.no, l.designation, `${l.qty} ${l.unit}`, tnd(l.unitPrice), `${l.discount}%`, `${l.tva}%`, tnd(lineAmounts(l).ht)])} />
        <div className="ml-auto w-64 space-y-1"><div className="flex justify-between"><span>Total HT</span><b>{tnd(po.totalHt)}</b></div><div className="flex justify-between"><span>TVA</span><b>{tnd(po.totalTva)}</b></div><div className="flex justify-between"><span>Timbre fiscal</span><b>{tnd(po.stamp)}</b></div><div className="flex justify-between border-t pt-1 text-base"><span>Total TTC</span><b>{tnd(po.totalTtc)}</b></div></div>
        {po.conditions && <p><b>Conditions :</b> {po.conditions}</p>}
      </Doc>
    );
  }
  if (type === "imm") {
    const a = (await db.select().from(assets).where(eq(assets.id, id)))[0];
    if (!a) return <p>Introuvable</p>;
    return (
      <Doc title="Fiche d'affectation" no={a.code} company={company} signatures={["Salarié (bénéficiaire)", "Gestionnaire des immobilisations", "Responsable hiérarchique"]}>
        <KV items={[["Désignation", a.designation], ["Marque / modèle", `${a.brand ?? "—"} / ${a.model ?? "—"}`], ["N° de série", a.serial], ["Date d'acquisition", fdate(a.acquisitionDate)], ["Références", a.refs], ["Service", a.service], ["Emplacement", a.location], ["Personnel affecté", a.holder], ["État", a.condition], ["Date d'affectation", fdate(new Date())]]} />
        <p className="pt-4"><b>Accessoires remis :</b> ……………………………………………………………………………</p>
        <p className="text-xs text-slate-500">Le bénéficiaire reconnaît avoir reçu le matériel ci-dessus en bon état et s&apos;engage à le restituer sur demande.</p>
      </Doc>
    );
  }
  if (type === "rec") {
    const rc = (await db.select().from(receptions).where(eq(receptions.id, id)))[0];
    if (!rc) return <p>Introuvable</p>;
    const l = (await db.select().from(packingLists).where(eq(packingLists.id, rc.listId)))[0];
    const f = (await db.select().from(importFiles).where(eq(importFiles.id, l.importId)))[0];
    return (
      <Doc title="Fiche de réception" no={rc.no} company={company} signatures={["Magasinier", "Responsable achats/import"]}>
        <KV items={[["Dossier", f.no], ["Liste de colisage", l.no], ["Date", fdt(rc.createdAt)], ["Emplacement", rc.location], ["Magasinier", uname(rc.userId)]]} />
        <T cols={["Modèle", "Reçu", "Accepté", "Endommagé / bloqué", "Observation"]} rows={rc.lines.map((x) => [x.model, x.received, x.accepted, x.received - x.accepted, x.obs ?? ""])} />
      </Doc>
    );
  }
  if (type === "bs") {
    const b = (await db.select().from(exitSlips).where(eq(exitSlips.id, id)))[0];
    if (!b) return <p>Introuvable</p>;
    const d = (await db.select().from(componentRequests).where(eq(componentRequests.id, b.demId)))[0];
    return (
      <Doc title="Bon de sortie magasin" no={b.no} company={company} signatures={["Magasinier (préparé par)", "Responsable production (reçu par)"]}>
        <KV items={[["Demande", d?.no], ["Date", fdt(b.createdAt)], ["Préparé par", uname(b.preparedBy)], ["Statut", b.status], ["Réception production", b.rpNo ?? "—"]]} />
        <T cols={["Modèle", "Quantité préparée", "Quantité acceptée", "Refusée", "Motif"]} rows={[[b.model, b.qty, b.acceptedQty ?? "", b.refusedQty ?? "", b.reason ?? ""]]} />
      </Doc>
    );
  }
  if (type === "trf") {
    const t = (await db.select().from(transfers).where(eq(transfers.id, id)))[0];
    if (!t) return <p>Introuvable</p>;
    const p = (await db.select().from(productions).where(eq(productions.id, t.prjId)))[0];
    return (
      <Doc title="Transfert vers inspection" no={t.no} company={company} signatures={["Émetteur (production)", "Réceptionnaire (qualité)"]}>
        <KV items={[["Production", p?.no], ["Modèle", t.model], ["Quantité", t.qty], ["Date", fdt(t.createdAt)], ["Émetteur", uname(t.issuedBy)], ["Accepté", t.acceptedQty ?? "—"]]} />
      </Doc>
    );
  }
  if (type === "bl") {
    const d = (await db.select().from(deliveries).where(eq(deliveries.id, id)))[0];
    if (!d || !d.blNo) return <p>BL non généré.</p>;
    return (
      <Doc title="Bon de livraison" no={d.blNo} company={company} signatures={["Gestionnaire produits finis", "Transporteur", "Client (reçu conforme)"]}>
        <KV items={[["Date", fdt(d.blAt)], ["Référence commerciale Sage", d.sageRef], ["Client", d.client], ["Adresse", d.address], ["Demande", d.no], ["Transport", d.transportInfo]]} />
        <T cols={["Modèle", "Quantité", "VIN / châssis"]} rows={[[d.model, d.preparedQty, d.vins ?? "—"]]} />
      </Doc>
    );
  }
  if (type === "om") {
    const m = (await db.select().from(missions).where(eq(missions.id, id)))[0];
    if (!m) return <p>Introuvable</p>;
    const ds = m.deliveryIds.length ? await db.select().from(deliveries).where(inArray(deliveries.id, m.deliveryIds)) : [];
    return (
      <Doc title="Ordre de mission" no={m.no} company={company} signatures={["Responsable transport", "Chauffeur", "Client (preuve de remise)"]}>
        <KV items={[["Départ", fdt(m.departure)], ["Chauffeur", m.driver], ["Téléphone", m.driverPhone], ["Véhicule", m.vehicle], ["Immatriculation", m.plate], ["Transporteur", m.carrier], ["Statut", m.status]]} />
        <T cols={["Référence commerciale Sage", "Client", "Adresse de livraison", "Modèle", "Quantité"]} rows={ds.map((d) => [<b key="s">{d.sageRef}</b>, d.client, d.address, d.model, d.preparedQty])} />
        {m.instructions && <p><b>Instructions :</b> {m.instructions}</p>}
      </Doc>
    );
  }
  return <p className="p-10">Type de document inconnu.</p>;
}
