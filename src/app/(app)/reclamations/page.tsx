import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { claims, importFiles, purchaseOrders, receptions, users } from "@/db/schema";
import { Back, Badge, Btn, Card, Empty, Field, Flash, Grid, KV, PageHeader, SearchBar, Stat, StatGrid, Table, inputCls, match } from "@/components/ui";
import { Submit } from "@/components/client";
import { Attachments, History } from "@/components/docs";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/perms";
import { fdate, fdt, today } from "@/lib/core";
import { claimAction } from "../import/actions";

export const dynamic = "force-dynamic";
const B = "/reclamations";
const ACTIONS = ["", "Relance fournisseur", "Avoir fournisseur", "Accepter en l'état", "Annuler le reliquat", "Débloquer vers stock disponible", "Remplacement reçu (ajout au stock)"];

export default async function ClaimsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const r = u.role;
  const [us, files, recs, pos] = await Promise.all([db.select().from(users), db.select().from(importFiles), db.select().from(receptions), db.select().from(purchaseOrders)]);
  const uname = (i: number | null) => us.find((x) => x.id === i)?.fullName ?? "—";

  if (sp.id) {
    const c = (await db.select().from(claims).where(eq(claims.id, Number(sp.id))))[0];
    if (!c) return <Empty>Introuvable.</Empty>;
    const back = `${B}?id=${c.id}`;
    const f = files.find((x) => x.id === c.importId);
    const rc = recs.find((x) => x.id === c.receptionId);
    const po = pos.find((x) => x.id === c.poId);
    const H = () => <><Back to={back} /><input type="hidden" name="id" value={c.id} /></>;
    return (
      <div>
        <PageHeader title={c.kind === "RECLAMATION" ? `Réclamation ${c.claimNo}` : `Fiche d'écart ${c.no}`} actions={<Btn href={B} variant="secondary">← Liste</Btn>} />
        <Flash sp={sp} />
        <Card title={<span>Détail <Badge s={c.status} /></span>}>
          <KV items={[["Fiche d'écart", c.no], ["N° réclamation", c.claimNo ?? "— (écart non transformé)"], ["Dossier import", f ? <Link key="f" className="text-red-700 underline" href={`/import?id=${f.id}`}>{f.no}</Link> : "—"], ["Réception", rc ? <Link key="r" className="text-red-700 underline" href={`/reception?id=${rc.id}`}>{rc.no}</Link> : "—"], ["BC local", po ? <Link key="p" className="text-red-700 underline" href={`/achats?tab=bc&id=${po.id}`}>{po.no}</Link> : "—"], ["Modèle", c.model], ["Quantité", c.qty], ["Déclaré par", `${uname(c.createdBy)} – ${fdt(c.createdAt)}`], ["Date de relance", c.followUpDate ? <span key="d" className={c.followUpDate < today() && c.status !== "Clôturée" ? "font-bold text-red-700" : ""}>{fdate(c.followUpDate)}</span> : "—"], ["Réponse fournisseur", c.supplierResponse], ["Action proposée", c.proposedAction], ["Décision", c.decision], ["Décidé par", c.decidedBy ? uname(c.decidedBy) : "—"]]} />
          <p className="mt-3 rounded bg-slate-50 p-2 text-sm">{c.description}</p>
          <p className="mt-2 text-xs text-slate-500">Les quantités manquantes ne sont jamais ajoutées au stock. Les annulations de reliquat, déblocages et remplacements ne modifient le stock / le restant qu&apos;après validation du Directeur approvisionnement.</p>
          {c.status !== "Clôturée" && (
            <div className="mt-4 space-y-3">
              {c.kind === "ECART" && (can(r, "claim.create") || can(r, "claim.manage")) && <form action={claimAction}><H /><Submit name="step" value="convert" confirm="Transformer cet écart en réclamation fournisseur ?">Créer une réclamation fournisseur</Submit></form>}
              {can(r, "claim.manage") && c.status !== "Décision à valider" && (
                <form action={claimAction} className="space-y-2 rounded-lg border p-3"><H /><input type="hidden" name="step" value="update" />
                  <h4 className="text-sm font-semibold">Suivi / traitement</h4>
                  <Grid cols={4}>
                    <Field label="Statut"><select name="status" defaultValue={c.status} className={inputCls}>{["Ouverte", "En analyse", "En attente fournisseur", "Résolue"].map((s) => <option key={s}>{s}</option>)}</select></Field>
                    <Field label="Date de relance"><input type="date" name="followUpDate" defaultValue={c.followUpDate ?? ""} className={inputCls} /></Field>
                    <Field label="Quantité concernée"><input name="qty" defaultValue={c.qty} className={inputCls} /></Field>
                    <Field label="Action proposée"><select name="proposedAction" defaultValue={c.proposedAction ?? ""} className={inputCls}>{ACTIONS.map((a) => <option key={a} value={a}>{a || "—"}</option>)}</select></Field>
                  </Grid>
                  <Field label="Réponse du fournisseur"><textarea name="supplierResponse" defaultValue={c.supplierResponse ?? ""} rows={2} className={inputCls} /></Field>
                  <Submit variant="secondary" small>Enregistrer le suivi</Submit>
                </form>
              )}
              {can(r, "claim.decide") && c.status === "Décision à valider" && (
                <form action={claimAction} className="flex flex-wrap gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3"><H />
                  <p className="w-full text-sm">Décision proposée : <b>{c.proposedAction}</b> – {c.model} × {c.qty}</p>
                  <input name="comment" placeholder="Commentaire / motif" className={`${inputCls} max-w-md`} />
                  <Submit variant="success" name="step" value="decide" confirm={`Valider « ${c.proposedAction} » pour ${c.qty} ${c.model} ?`}>Valider la décision</Submit>
                  <Submit variant="danger" name="step" value="refuse">Refuser</Submit>
                </form>
              )}
              {can(r, "claim.manage") && c.status !== "Décision à valider" && (
                <form action={claimAction} className="flex flex-wrap gap-2"><H /><input name="decision" placeholder="Motif et décision de clôture *" className={`${inputCls} max-w-lg`} /><Submit variant="dark" name="step" value="close" confirm="Clôturer définitivement ?">Clôturer</Submit></form>
              )}
            </div>
          )}
        </Card>
        <Attachments docType="CLM" docId={c.id} docNo={c.claimNo ?? c.no} back={back} canUpload={c.status !== "Clôturée"} />
        <History docNo={c.no} />
        {c.claimNo && <History docNo={c.claimNo} />}
      </div>
    );
  }

  const list = (await db.select().from(claims).orderBy(desc(claims.id))).filter((c) => (!sp.f || c.status === sp.f) && match(sp.q, c.no, c.claimNo, c.model, c.description, c.status));
  const st = (s: string) => list.filter((c) => c.status === s).length;
  return (
    <div>
      <PageHeader title="Écarts et réclamations fournisseurs" subtitle="Un écart est d'abord enregistré ; la création d'une réclamation est une action explicite." />
      <Flash sp={sp} />
      <StatGrid>
        <Stat label="Ouvertes" value={st("Ouverte")} href={`${B}?f=Ouverte`} tone="red" />
        <Stat label="En analyse" value={st("En analyse")} href={`${B}?f=En analyse`} tone="amber" />
        <Stat label="Attente fournisseur" value={st("En attente fournisseur")} href={`${B}?f=En attente fournisseur`} tone="blue" />
        <Stat label="Décision à valider" value={st("Décision à valider")} href={`${B}?f=Décision à valider`} tone="red" />
        <Stat label="Résolues" value={st("Résolue")} href={`${B}?f=Résolue`} tone="green" />
        <Stat label="Relances en retard" value={list.filter((c) => c.followUpDate && c.followUpDate < today() && c.status !== "Clôturée").length} tone="red" />
      </StatGrid>
      <Card title="Liste">
        <SearchBar base={B} q={sp.q} />
        <Table cols={["Écart", "Réclamation", "Date", "Origine", "Modèle", "Qté", "Relance", "Statut", ""]} rows={list.map((c) => [c.no, c.claimNo ?? "—", fdate(c.createdAt), files.find((f) => f.id === c.importId)?.no ?? pos.find((p) => p.id === c.poId)?.no ?? "—", c.model, c.qty, fdate(c.followUpDate), <Badge key="s" s={c.status} />, <Link key="l" className="text-red-700 underline" href={`${B}?id=${c.id}`}>Traiter</Link>])} />
      </Card>
    </div>
  );
}
