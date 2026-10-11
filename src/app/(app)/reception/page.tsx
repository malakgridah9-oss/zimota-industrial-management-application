import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { importFiles, packingLines, packingLists, receptions, suppliers, users, claims } from "@/db/schema";
import { Back, Badge, Btn, Card, Empty, Field, Flash, KV, PageHeader, SearchBar, Table, inputCls, match } from "@/components/ui";
import { Submit } from "@/components/client";
import { Attachments, History } from "@/components/docs";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/perms";
import { fdt } from "@/lib/core";
import { createClaim, createReception } from "../import/actions";

export const dynamic = "force-dynamic";
const B = "/reception";

export default async function ReceptionPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const r = u.role;
  const [lists, files, sups, us] = await Promise.all([db.select().from(packingLists), db.select().from(importFiles), db.select().from(suppliers), db.select().from(users)]);
  const uname = (i: number) => us.find((x) => x.id === i)?.fullName ?? "—";

  if (sp.new && can(r, "rec.create")) {
    const valid = lists.filter((l) => l.status === "Validée" && files.find((f) => f.id === l.importId)?.status === "Validé");
    const sel = sp.list ? valid.find((l) => l.id === Number(sp.list)) : undefined;
    const ls = sel ? await db.select().from(packingLines).where(eq(packingLines.listId, sel.id)) : [];
    const f = sel ? files.find((x) => x.id === sel.importId) : undefined;
    return (
      <div>
        <PageHeader title="Nouvelle réception de composants" actions={<Btn href={B} variant="secondary">← Réceptions</Btn>} />
        <Flash sp={sp} />
        <Card>
          <form method="get" action={B} className="mb-4 flex gap-2">
            <input type="hidden" name="new" value="1" />
            <select name="list" defaultValue={sp.list ?? ""} className={`${inputCls} max-w-md`}><option value="">— Sélectionner une liste de colisage validée —</option>{valid.map((l) => { const ff = files.find((x) => x.id === l.importId); return <option key={l.id} value={l.id}>{l.no} – {ff?.no} ({sups.find((s) => s.id === ff?.supplierId)?.name})</option>; })}</select>
            <button className="rounded-lg border px-3 text-sm">Charger</button>
          </form>
          {valid.length === 0 && <Empty>Aucune liste validée disponible. Le dossier et la liste doivent être validés par le Directeur approvisionnement.</Empty>}
          {sel && f && (
            <form action={createReception} className="space-y-3">
              <Back to={`${B}?new=1&list=${sel.id}`} /><input type="hidden" name="listId" value={sel.id} />
              <KV items={[["Dossier", f.no], ["Liste", sel.no], ["Fournisseur", sups.find((s) => s.id === f.supplierId)?.name ?? "—"]]} />
              <Table cols={["Modèle", "Prévu", "Déjà reçu", "Restant", "Reçu maintenant", "Accepté", "Endommagé/bloqué", "Observation"]} rows={ls.map((l) => { const rest = l.plannedQty - l.cancelledQty - l.receivedQty; return [<b key="m">{l.model}</b>, l.plannedQty - l.cancelledQty, l.receivedQty, rest, <input key="r" name={`rec_${l.id}`} defaultValue={0} className={`${inputCls} w-20`} />, <input key="a" name={`acc_${l.id}`} defaultValue={0} className={`${inputCls} w-20`} />, <input key="d" name={`dam_${l.id}`} defaultValue={0} className={`${inputCls} w-20`} />, <input key="o" name={`obs_${l.id}`} className={inputCls} />]; })} />
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Emplacement"><input name="location" placeholder="ex. Magasin A – Allée 3" className={inputCls} /></Field>
                <label className="mt-6 flex items-center gap-2 text-sm"><input type="checkbox" name="final" /> Dernière livraison attendue : créer une fiche d&apos;écart pour les quantités manquantes</label>
              </div>
              <p className="text-xs text-slate-500">Le stock disponible augmente uniquement de la quantité acceptée. Les unités endommagées/bloquées sont isolées (stock bloqué) et non disponibles pour la production.</p>
              <Submit variant="success" confirm="Valider la réception ? Le mouvement de stock sera enregistré une seule fois et la réception sera verrouillée.">Valider la réception</Submit>
            </form>
          )}
        </Card>
      </div>
    );
  }

  if (sp.id) {
    const rc = (await db.select().from(receptions).where(eq(receptions.id, Number(sp.id))))[0];
    if (!rc) return <Empty>Introuvable.</Empty>;
    const l = lists.find((x) => x.id === rc.listId)!;
    const f = files.find((x) => x.id === l.importId)!;
    const cl = await db.select().from(claims).where(eq(claims.receptionId, rc.id));
    const back = `${B}?id=${rc.id}`;
    return (
      <div>
        <PageHeader title={`Réception ${rc.no}`} actions={<><Btn href={`/print/rec/${rc.id}`} variant="secondary">🖨 Imprimer la fiche</Btn><Btn href={B} variant="secondary">← Réceptions</Btn></>} />
        <Flash sp={sp} />
        <Card title={<span>Détail <Badge s="Validé" /></span>}>
          <KV items={[["Dossier", <Link key="d" className="text-red-700 underline" href={`/import?id=${f.id}`}>{f.no}</Link>], ["Liste", l.no], ["Emplacement", rc.location], ["Magasinier", uname(rc.userId)], ["Date", fdt(rc.createdAt)]]} />
          <div className="mt-3"><Table cols={["Modèle", "Reçu", "Accepté", "Endommagé/bloqué", "Observation"]} rows={rc.lines.map((x) => [x.model, x.received, x.accepted, x.received - x.accepted, x.obs])} /></div>
          <p className="mt-2 text-xs text-slate-500">Réception verrouillée : toute correction passe par un ajustement (Gestion des stocks) lié à {rc.no}.</p>
        </Card>
        <Card title="Écarts / réclamations liés">
          <Table cols={["N°", "Modèle", "Qté", "Description", "Statut", ""]} rows={cl.map((c) => [c.claimNo ?? c.no, c.model, c.qty, c.description, <Badge key="s" s={c.status} />, <Link key="l" className="text-red-700 underline" href={`/reclamations?id=${c.id}`}>Ouvrir</Link>])} />
          {(can(r, "claim.create") || can(r, "claim.manage")) && (
            <form action={createClaim} className="mt-3 grid gap-2 md:grid-cols-5"><Back to={back} /><input type="hidden" name="receptionId" value={rc.id} />
              <select name="model" className={inputCls}>{rc.lines.map((x) => <option key={x.model}>{x.model}</option>)}</select>
              <input name="qty" placeholder="Quantité" className={inputCls} />
              <input name="description" placeholder="Description du problème *" className={`${inputCls} md:col-span-2`} />
              <Submit variant="secondary" small>Signaler un écart</Submit>
            </form>
          )}
        </Card>
        <Attachments docType="REC" docId={rc.id} docNo={rc.no} back={back} canUpload={can(r, "rec.create")} />
        <History docNo={rc.no} />
      </div>
    );
  }

  const recs = (await db.select().from(receptions).orderBy(desc(receptions.id))).filter((x) => { const l = lists.find((y) => y.id === x.listId); return match(sp.q, x.no, l?.no, x.lines.map((z) => z.model).join(" ")); });
  const pending = lists.filter((l) => l.status === "Validée" && files.find((f) => f.id === l.importId)?.status === "Validé");
  const pl = pending.length ? await db.select().from(packingLines).where(inArray(packingLines.listId, pending.map((l) => l.id))) : [];
  return (
    <div>
      <PageHeader title="Réception des composants" subtitle="Par liste de colisage validée et par modèle" actions={can(r, "rec.create") && <Btn href={`${B}?new=1`}>+ Nouvelle réception</Btn>} />
      <Flash sp={sp} />
      <Card title="Listes validées en attente de réception">
        <Table cols={["Liste", "Dossier", "Modèles", "Restant total", ""]} rows={pending.map((l) => { const ls = pl.filter((x) => x.listId === l.id); const rest = ls.reduce((s, x) => s + x.plannedQty - x.cancelledQty - x.receivedQty, 0); return [l.no, files.find((f) => f.id === l.importId)?.no, ls.map((x) => x.model).join(", "), rest, rest > 0 && can(r, "rec.create") ? <Link key="l" className="text-red-700 underline" href={`${B}?new=1&list=${l.id}`}>Réceptionner</Link> : "Soldée"]; })} />
      </Card>
      <Card title="Réceptions enregistrées">
        <SearchBar base={B} q={sp.q} />
        <Table cols={["N°", "Date", "Liste", "Modèles", "Reçu", "Accepté", "Bloqué", "Magasinier", ""]} rows={recs.map((x) => [<b key="n">{x.no}</b>, fdt(x.createdAt), lists.find((l) => l.id === x.listId)?.no, x.lines.map((z) => z.model).join(", "), x.lines.reduce((s, z) => s + z.received, 0), x.lines.reduce((s, z) => s + z.accepted, 0), x.lines.reduce((s, z) => s + z.received - z.accepted, 0), uname(x.userId), <Link key="l" className="text-red-700 underline" href={`${B}?id=${x.id}`}>Consulter</Link>])} />
      </Card>
    </div>
  );
}
