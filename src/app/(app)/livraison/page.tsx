import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { deliveries, missions, motoModels, users } from "@/db/schema";
import { Back, Badge, Card, Extra, Field, Flash, Grid, PageHeader, SearchBar, Stat, StatGrid, Table, Tabs, inputCls, match } from "@/components/ui";
import { Submit } from "@/components/client";
import { Attachments } from "@/components/docs";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/perms";
import { fdate, fdt, getSetting, today } from "@/lib/core";
import { cancelDlv, createDlv, createOm, prepareDlv, updateOm, validateExit } from "./actions";

export const dynamic = "force-dynamic";
const B = "/livraison";

export default async function LivraisonPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const r = u.role;
  const driverOnly = can(r, "om.driver") && !can(r, "om.manage");
  const tab = driverOnly ? "om" : ["dlv", "bl", "om"].includes(sp.tab ?? "") ? sp.tab! : "dlv";
  const back = `${B}?tab=${tab}`;
  const [us, models, dls, oms] = await Promise.all([db.select().from(users), db.select().from(motoModels).where(eq(motoModels.active, true)), db.select().from(deliveries).orderBy(desc(deliveries.id)), db.select().from(missions).orderBy(desc(missions.id))]);
  const uname = (i: number | null) => us.find((x) => x.id === i)?.fullName ?? "—";
  const vinTracking = (await getSetting("vin_tracking")) === "1";
  const pf = (await db.execute(sql`select model, sum(qty)::int q from stock_movements where store='PF' and state='DISPONIBLE' group by model`)).rows as { model: string; q: number }[];
  const avail = (m: string) => Number(pf.find((x) => x.model === m)?.q ?? 0) - dls.filter((d) => d.model === m && d.reserved && !d.blNo && d.status !== "Annulée").reduce((s, d) => s + d.qty, 0);
  const lateOm = oms.filter((m) => ["Planifiée", "En cours"].includes(m.status) && new Date(m.departure).getTime() < Date.now() - 24 * 3600000).length;
  const myOms = driverOnly ? oms.filter((m) => m.driverUserId === u.id) : oms;

  return (
    <div>
      <PageHeader title="Livraison et transport" subtitle="Demande → préparation → BL (sortie de stock unique) → ordre de mission → preuve de remise" />
      <Flash sp={sp} />
      {!driverOnly && (
        <StatGrid>
          <Stat label="À préparer" value={dls.filter((d) => ["À préparer", "Réservée"].includes(d.status)).length} tone="amber" />
          <Stat label="Préparées (BL à générer)" value={dls.filter((d) => d.status === "Préparée").length} tone="blue" />
          <Stat label="Sans ordre de mission" value={dls.filter((d) => d.blNo && !d.missionId).length} href={`${B}?tab=om`} tone="red" />
          <Stat label="Expédiées" value={dls.filter((d) => d.status === "Expédiée").length} tone="blue" />
          <Stat label="Livrées" value={dls.filter((d) => d.status === "Livrée").length} tone="green" />
          <Stat label="Missions en retard / incidents" value={lateOm + oms.filter((m) => m.status === "Incident").length} tone="red" />
        </StatGrid>
      )}
      {!driverOnly && <Tabs base={B} active={tab} tabs={[{ key: "dlv", label: "Demandes & préparation" }, { key: "bl", label: "Bons de livraison" }, { key: "om", label: "Ordres de mission" }]} />}

      {tab === "dlv" && (
        <>
          {can(r, "dlv.create") && (
            <Card title="+ Nouvelle demande de livraison">
              <p className="mb-3 text-xs text-slate-500">Aucune base de vente externe n&apos;est connectée : les informations commerciales (client, référence Sage) sont saisies manuellement.</p>
              <form action={createDlv} className="space-y-3"><Back to={back} />
                <Grid cols={4}>
                  <Field label="Client" required><input name="client" required className={inputCls} /></Field>
                  <Field label="Référence commerciale Sage" required><input name="sageRef" required className={inputCls} /></Field>
                  <Field label="Modèle" required><select name="model" className={inputCls}>{models.map((m) => <option key={m.id} value={m.code}>{m.code} (libre : {avail(m.code)})</option>)}</select></Field>
                  <Field label="Quantité" required><input name="qty" required className={inputCls} /></Field>
                  <Field label="Adresse de livraison" required className="md:col-span-2"><input name="address" required className={inputCls} /></Field>
                  <Field label="Date souhaitée"><input type="date" name="wantedDate" defaultValue={today()} className={inputCls} /></Field>
                  <label className="mt-6 flex items-center gap-2 text-sm"><input type="checkbox" name="reserve" defaultChecked /> Réserver le stock</label>
                </Grid>
                <Submit>Créer la demande</Submit>
              </form>
            </Card>
          )}
          <Card title="Demandes de livraison">
            <SearchBar base={B} tab="dlv" q={sp.q} />
            <div className="space-y-3">
              {dls.filter((d) => !d.blNo && d.status !== "Annulée" && match(sp.q, d.no, d.client, d.sageRef, d.model)).map((d) => (
                <div key={d.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div><b>{d.no}</b> · Sage <b>{d.sageRef}</b> · {d.client} · {d.model} × {d.qty} · souhaitée {fdate(d.wantedDate)} <Badge s={d.status} /></div>
                    <span className="text-xs text-slate-500">Libre PF : {avail(d.model) + (d.reserved ? d.qty : 0)}</span>
                  </div>
                  {can(r, "dlv.validate") && (
                    <div className="mt-2 grid gap-2 lg:grid-cols-3">
                      <form action={prepareDlv} className="flex flex-wrap gap-1 lg:col-span-2"><Back to={back} /><input type="hidden" name="id" value={d.id} />
                        <input name="preparedQty" defaultValue={d.preparedQty ?? d.qty} title="Quantité préparée" className={`${inputCls} w-20`} />
                        <input name="vins" defaultValue={d.vins ?? ""} placeholder={vinTracking ? "VIN livrés (séparés par virgule)" : "VIN (optionnel)"} className={`${inputCls} w-64`} />
                        <input name="transportInfo" defaultValue={d.transportInfo ?? ""} placeholder="Infos transport" className={`${inputCls} w-40`} />
                        <Submit small variant="secondary">{d.status === "Préparée" ? "Modifier préparation" : "Préparer"}</Submit>
                      </form>
                      <div className="flex flex-wrap gap-1">
                        {d.status === "Préparée" && <form action={validateExit}><Back to={`${B}?tab=bl`} /><input type="hidden" name="id" value={d.id} /><Submit small variant="success" confirm={`Valider la sortie de ${d.preparedQty} ${d.model} pour ${d.client} et générer le BL ? Opération unique et irréversible.`}>Valider la sortie et générer le BL</Submit></form>}
                        <form action={cancelDlv} className="flex gap-1"><Back to={back} /><input type="hidden" name="id" value={d.id} /><input name="reason" placeholder="Motif" className={`${inputCls} w-24`} /><Submit small variant="danger">Annuler</Submit></form>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {tab === "bl" && (
        <Card title="Bons de livraison" actions={<a href="/api/export?type=deliveries" className="rounded-lg border px-3 py-1.5 text-sm">⬇ Export CSV</a>}>
          <SearchBar base={B} tab="bl" q={sp.q} />
          <Table cols={["BL", "Date", "DLV", "Réf. Sage", "Client", "Modèle", "Qté", "VIN", "Statut", "OM", ""]} rows={dls.filter((d) => d.blNo && match(sp.q, d.blNo, d.no, d.client, d.sageRef, d.vins)).map((d) => [<b key="n">{d.blNo}</b>, fdt(d.blAt), d.no, d.sageRef, d.client, d.model, d.preparedQty, <span key="v" className="text-xs">{d.vins}</span>, <Badge key="s" s={d.status} />, oms.find((m) => m.id === d.missionId)?.no ?? <span key="o" className="text-xs text-red-600">aucun</span>, <Link key="p" className="text-red-700 underline" href={`/print/bl/${d.id}`}>🖨 BL</Link>])} />
        </Card>
      )}

      {tab === "om" && (
        <>
          {can(r, "om.manage") && (
            <Card title="Créer un ordre de mission">
              {(() => {
                const ready = dls.filter((d) => d.blNo && !d.missionId);
                if (!ready.length) return <p className="text-sm text-slate-500">Aucune référence commerciale Sage prête à expédier sans ordre de mission.</p>;
                return (
                  <form action={createOm} className="space-y-3"><Back to={back} />
                    <div className="rounded-lg border p-2">{ready.map((d) => <label key={d.id} className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" name="dlv" value={d.id} /><b>Sage {d.sageRef}</b> – {d.client} – {d.address} – {d.model} × {d.preparedQty}</label>)}</div>
                    <Grid cols={4}>
                      <Field label="Départ (date et heure)" required><input type="datetime-local" name="departure" required className={inputCls} /></Field>
                      <Field label="Chauffeur (compte)"><select name="driverUserId" className={inputCls}><option value="">—</option>{us.filter((x) => x.role === "CHAUFFEUR").map((x) => <option key={x.id} value={x.id}>{x.fullName}</option>)}</select></Field>
                      <Field label="ou nom du chauffeur"><input name="driver" className={inputCls} /></Field>
                      <Field label="Immatriculation" required><input name="plate" required className={inputCls} /></Field>
                    </Grid>
                    <Extra><Grid cols={4}><Field label="Téléphone"><input name="driverPhone" className={inputCls} /></Field><Field label="Véhicule"><input name="vehicle" className={inputCls} /></Field><Field label="Transporteur"><input name="carrier" className={inputCls} /></Field><Field label="Instructions"><input name="instructions" className={inputCls} /></Field></Grid></Extra>
                    <Submit confirm="Valider l'ordre de mission ? (aucune nouvelle sortie de stock)">Valider et imprimer l&apos;OM</Submit>
                  </form>
                );
              })()}
            </Card>
          )}
          <Card title={driverOnly ? "Mes missions" : "Missions"}>
            <div className="space-y-3">
              {myOms.map((m) => {
                const ds = dls.filter((d) => m.deliveryIds.includes(d.id));
                return (
                  <div key={m.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div><b>{m.no}</b> <Badge s={m.status} /> · départ {fdt(m.departure)} · {m.driver} · {m.plate}</div>
                      <Link className="text-sm text-red-700 underline" href={`/print/om/${m.id}`}>🖨 Imprimer OM</Link>
                    </div>
                    <ul className="mt-1 text-sm text-slate-600">{ds.map((d) => <li key={d.id}>Sage <b>{d.sageRef}</b> – {d.client}, {d.address} – {d.model} × {d.preparedQty}</li>)}</ul>
                    {m.proof && <p className="mt-1 text-xs text-emerald-700">Preuve de remise : {m.proof}</p>}
                    {m.incident && <p className="mt-1 text-xs text-red-700">Incident : {m.incident}</p>}
                    {!["Annulé", "Livré"].includes(m.status) && (can(r, "om.manage") || m.driverUserId === u.id) && (
                      <form action={updateOm} className="mt-2 flex flex-wrap gap-1"><Back to={back} /><input type="hidden" name="id" value={m.id} />
                        <input name="proof" placeholder="Preuve de remise (signataire, n° pièce…)" className={`${inputCls} w-64`} />
                        <input name="incident" placeholder="Description incident" className={`${inputCls} w-48`} />
                        {can(r, "om.manage") && <input name="reason" placeholder="Motif annulation" className={`${inputCls} w-36`} />}
                        <Submit small variant="secondary" name="status" value="En cours">En cours</Submit>
                        <Submit small variant="success" name="status" value="Livré" confirm="Confirmer la livraison ?">Livré</Submit>
                        <Submit small variant="danger" name="status" value="Incident">Incident</Submit>
                        {can(r, "om.manage") && <Submit small variant="danger" name="status" value="Annulé" confirm="Annuler la mission ? Elle sera verrouillée.">Annuler</Submit>}
                      </form>
                    )}
                  </div>
                );
              })}
              {myOms.length === 0 && <p className="text-sm text-slate-500">Aucune mission.</p>}
            </div>
          </Card>
          {sp.om && <Attachments docType="OM" docId={Number(sp.om)} docNo={oms.find((m) => m.id === Number(sp.om))?.no ?? ""} back={`${back}&om=${sp.om}`} />}
        </>
      )}
    </div>
  );
}
