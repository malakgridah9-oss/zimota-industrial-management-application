import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { motoModels, savCases } from "@/db/schema";
import { Back, Badge, Btn, Card, Empty, Extra, Field, Flash, Grid, KV, PageHeader, SearchBar, Stat, StatGrid, Table, Tabs, inputCls, match } from "@/components/ui";
import { Submit } from "@/components/client";
import { Attachments, History } from "@/components/docs";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/perms";
import { fdate, fdt, today } from "@/lib/core";
import { createSav, savStep } from "./actions";

export const dynamic = "force-dynamic";
const B = "/sav";
const TABS: { key: string; label: string; fields: [string, string, string?][] }[] = [
  { key: "reception", label: "Réception", fields: [["date", "Date de réception *", "date"], ["km", "Kilométrage *"], ["accessoires", "Accessoires"], ["etat", "État général"], ["obs", "Observations"]] },
  { key: "diagnostic", label: "Diagnostic", fields: [["defaut", "Défaut constaté *"], ["cause", "Cause possible"], ["garantie", "Décision de garantie * (Sous garantie / Hors garantie)"], ["technicien", "Technicien *"], ["devis", "Devis (si nécessaire)"]] },
  { key: "repair", label: "Réparation", fields: [["travaux", "Travaux réalisés *"], ["pieces", "Pièces utilisées"], ["temps", "Temps passé (h)"], ["debut", "Début", "date"], ["fin", "Fin", "date"]] },
  { key: "final", label: "Contrôle final", fields: [["inspecteur", "Inspecteur *"], ["resultat", "Résultat * (Conforme / Non conforme)"], ["obs", "Observations"]] },
  { key: "billing", label: "Facturation", fields: [["montant", "Montant (DT)"], ["facture", "N° facture"], ["obs", "Observations"]] },
  { key: "restitution", label: "Restitution", fields: [["date", "Date de restitution *", "date"], ["preuve", "Preuve de remise *"], ["recupere_par", "Récupéré par"]] },
];
const days = (a: Date | string, b?: Date | string | null) => Math.round(((b ? new Date(b) : new Date()).getTime() - new Date(a).getTime()) / 86400000);

export default async function SavPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const canEdit = can(u.role, "sav.manage");
  const models = await db.select().from(motoModels).where(eq(motoModels.active, true));

  if (sp.new && canEdit) {
    return (
      <div>
        <PageHeader title="Nouveau dossier SAV" actions={<Btn href={B} variant="secondary">← Dossiers</Btn>} />
        <Flash sp={sp} />
        <Card>
          <p className="mb-3 text-xs text-slate-500">Saisie manuelle : aucune récupération automatique depuis une base de vente ou un BL n&apos;est effectuée.</p>
          <form action={createSav} className="space-y-3"><Back to={`${B}?new=1`} />
            <Grid cols={4}>
              <Field label="Client" required><input name="client" required className={inputCls} /></Field>
              <Field label="Téléphone"><input name="phone" className={inputCls} /></Field>
              <Field label="Modèle" required><select name="model" className={inputCls}>{models.map((m) => <option key={m.id}>{m.code}</option>)}</select></Field>
              <Field label="VIN / châssis" required><input name="vin" required className={inputCls} /></Field>
              <Field label="Kilométrage" required><input name="km" required className={inputCls} /></Field>
              <Field label="Priorité"><select name="priority" className={inputCls}><option>Normale</option><option>Haute</option><option>Urgente</option></select></Field>
              <Field label="Description" required className="md:col-span-2"><input name="description" required className={inputCls} /></Field>
            </Grid>
            <Extra><Grid cols={3}><Field label="Adresse"><input name="address" className={inputCls} /></Field><Field label="BL de vente (facultatif)"><input name="blNo" className={inputCls} /></Field><Field label="Date de vente"><input type="date" name="saleDate" className={inputCls} /></Field></Grid></Extra>
            <Submit>Créer le dossier</Submit>
          </form>
        </Card>
      </div>
    );
  }

  if (sp.id) {
    const s = (await db.select().from(savCases).where(eq(savCases.id, Number(sp.id))))[0];
    if (!s) return <Empty>Introuvable.</Empty>;
    const t = TABS.some((x) => x.key === sp.t) ? sp.t! : sp.t === "docs" || sp.t === "hist" ? sp.t : "reception";
    const back = `${B}?id=${s.id}&t=${t}`;
    const cur = TABS.find((x) => x.key === t);
    const saved = s.data[t] ?? {};
    return (
      <div>
        <PageHeader title={`Dossier ${s.no}`} actions={<Btn href={B} variant="secondary">← Dossiers</Btn>} />
        <Flash sp={sp} />
        <Card title={<span>{s.client} – {s.model} – VIN {s.vin} <Badge s={s.status} /></span>}>
          <KV items={[["Téléphone", s.phone], ["Adresse", s.address], ["BL de vente", s.blNo ?? "non renseigné"], ["Date de vente", fdate(s.saleDate)], ["Kilométrage", s.km], ["Priorité", s.priority], ["Ouvert le", fdt(s.createdAt)], ["Délai de traitement", `${days(s.createdAt, s.closedAt)} j`], ["Défaut imputable production", s.productionDefect ? "Oui" : "Non"]]} />
          <p className="mt-3 rounded bg-slate-50 p-2 text-sm">{s.description}</p>
        </Card>
        <div className="mb-4 flex gap-1 overflow-x-auto border-b">
          {[...TABS.map((x) => ({ key: x.key, label: x.label })), { key: "docs", label: "Documents" }, { key: "hist", label: "Historique" }].map((x) => (
            <Link key={x.key} href={`${B}?id=${s.id}&t=${x.key}`} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${t === x.key ? "border-red-600 font-semibold text-red-700" : "border-transparent text-slate-500"}`}>{x.label} {s.data[x.key] ? "✓" : ""}</Link>
          ))}
        </div>
        {cur && (
          <Card title={cur.label}>
            {Object.keys(saved).length > 0 && <div className="mb-3 rounded bg-emerald-50 p-2"><KV items={Object.entries(saved).map(([k, v]) => [cur.fields.find((f) => f[0] === k)?.[1].replace(" *", "") ?? k, k === "le" ? fdt(v) : v])} /></div>}
            {canEdit && s.status !== "Clôturé" && (
              <form action={savStep} className="space-y-3"><Back to={back} /><input type="hidden" name="id" value={s.id} /><input type="hidden" name="step" value={cur.key} />
                <Grid cols={3}>{cur.fields.map(([k, l, type]) => <Field key={k} label={l}>{k === "resultat" ? <select name={k} className={inputCls}><option>Conforme</option><option>Non conforme</option></select> : k === "garantie" ? <select name={k} className={inputCls}><option>Sous garantie</option><option>Hors garantie</option><option>À déterminer</option></select> : <input name={k} type={type ?? "text"} defaultValue={k === "date" ? today() : k === "km" ? String(s.km) : saved[k] ?? ""} className={inputCls} />}</Field>)}</Grid>
                {cur.key === "diagnostic" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="productionDefect" defaultChecked={s.productionDefect} /> Défaut imputable à la production</label>}
                {cur.key === "final" && <p className="text-xs text-slate-500">Résultat « Non conforme » → le dossier revient en réparation.</p>}
                {cur.key === "billing" && <p className="text-xs text-slate-500">Facultatif pour une intervention prise en charge sous garantie. Les pièces SAV ne modifient pas le stock composants (processus de sortie SAV non configuré).</p>}
                <Submit>Enregistrer</Submit>
              </form>
            )}
          </Card>
        )}
        {t === "docs" && <Attachments docType="SAV" docId={s.id} docNo={s.no} back={back} canUpload={canEdit} />}
        {t === "hist" && <History docNo={s.no} />}
        {canEdit && s.status !== "Clôturé" && (
          <Card title="Rejet / clôture">
            <form action={savStep} className="flex flex-wrap gap-2"><Back to={back} /><input type="hidden" name="id" value={s.id} />
              <input name="reason" placeholder="Motif *" className={`${inputCls} max-w-md`} />
              {!["Restitué", "Rejeté"].includes(s.status) && <Submit variant="danger" name="step" value="reject" confirm="Rejeter ce dossier ?">Rejeter</Submit>}
              <Submit variant="dark" name="step" value="close" confirm="Clôturer ce dossier ?">Clôturer</Submit>
            </form>
          </Card>
        )}
      </div>
    );
  }

  const tab = sp.tab === "defects" ? "defects" : "list";
  const all = await db.select().from(savCases).orderBy(desc(savCases.id));
  const open = all.filter((s) => s.status !== "Clôturé");
  const late = open.filter((s) => days(s.createdAt) > 7);
  return (
    <div>
      <PageHeader title="Gestion SAV" subtitle="Dossiers autonomes – VIN saisi manuellement comme clé de recherche" actions={canEdit && <Btn href={`${B}?new=1`}>+ Nouveau dossier SAV</Btn>} />
      <Flash sp={sp} />
      <StatGrid>
        <Stat label="Nouveaux" value={all.filter((s) => s.status === "Nouveau").length} tone="amber" />
        <Stat label="En diagnostic" value={all.filter((s) => ["Réceptionné", "En diagnostic"].includes(s.status)).length} tone="blue" />
        <Stat label="En réparation" value={all.filter((s) => ["En réparation", "Contrôle final"].includes(s.status)).length} tone="blue" />
        <Stat label="En retard (> 7 j)" value={late.length} tone="red" />
        <Stat label="Prêts à restituer" value={all.filter((s) => s.status === "Prêt à restituer").length} tone="green" />
        <Stat label="Défauts production" value={all.filter((s) => s.productionDefect).length} href={`${B}?tab=defects`} tone="red" />
      </StatGrid>
      <Tabs base={B} active={tab} tabs={[{ key: "list", label: "Dossiers" }, { key: "defects", label: "Défauts de production" }]} />
      {tab === "list" ? (
        <Card title="Dossiers SAV">
          <SearchBar base={B} q={sp.q} />
          <Table cols={["N°", "Date", "Client", "Modèle", "VIN", "Priorité", "Délai", "Statut", ""]} rows={all.filter((s) => match(sp.q, s.no, s.client, s.vin, s.model, s.phone)).map((s) => [<b key="n">{s.no}</b>, fdate(s.createdAt), s.client, s.model, s.vin, s.priority, <span key="d" className={s.status !== "Clôturé" && days(s.createdAt) > 7 ? "font-bold text-red-700" : ""}>{days(s.createdAt, s.closedAt)} j</span>, <Badge key="s" s={s.status} />, <Link key="l" className="text-red-700 underline" href={`${B}?id=${s.id}`}>Ouvrir</Link>])} />
        </Card>
      ) : (
        <Card title="Défauts imputables à la production (récurrence)">
          <Table cols={["Modèle", "Défaut", "Occurrences", "Dossiers"]} rows={Object.values(all.filter((s) => s.productionDefect).reduce((acc, s) => { const d = s.data.diagnostic?.defaut ?? "non renseigné"; const k = `${s.model}|${d}`; (acc[k] ??= { m: s.model, d, n: 0, nos: [] as string[] }).n++; acc[k].nos.push(s.no); return acc; }, {} as Record<string, { m: string; d: string; n: number; nos: string[] }>)).sort((a, b) => b.n - a.n).map((x) => [x.m, x.d, <b key="n" className={x.n > 1 ? "text-red-700" : ""}>{x.n}</b>, x.nos.join(", ")])} />
        </Card>
      )}
    </div>
  );
}
