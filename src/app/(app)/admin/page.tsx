import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { exceptionRequests, motoModels, suppliers, users } from "@/db/schema";
import { Back, Badge, Card, Field, Flash, Grid, PageHeader, Table, Tabs, inputCls } from "@/components/ui";
import { Submit } from "@/components/client";
import { requireUser } from "@/lib/auth";
import { PERMS, ROLES, ROLE_PERMS, can } from "@/lib/perms";
import { fdt, getSettings } from "@/lib/core";
import { addSupplier, createUser, decideException, modelAction, requestException, saveSettings, userAction } from "./actions";

export const dynamic = "force-dynamic";
const B = "/admin";

const SETTING_LABELS: Record<string, string> = {
  bc_threshold: "Seuil de validation BC (DT HT)", low_stock_default: "Seuil de stock faible par défaut", max_prod_inspection_hours: "Délai max production → inspection (heures)", date_format: "Format de date", session_hours: "Durée de session (heures)", max_file_mb: "Taille max pièce jointe (Mo)", allowed_ext: "Formats de pièces jointes autorisés", vin_tracking: "Suivi unitaire VIN (1 = activé, 0 = désactivé)", company_name: "Raison sociale (documents)", company_address: "Adresse (documents)",
};

const SCENARIOS: [string, string][] = [
  ["Achat local standard", "DA (demandeur) → acceptation (achats) → BC → validation → émission → réception (achats) → « Reçu conforme » (magasinier) → facture → transmission DAF."],
  ["Achat local ≥ seuil", "BC ≥ seuil : bloqué « En attente de validation », impression bloquée ; validation par le Directeur ; historique conservé."],
  ["Import : 500 prévus, 480 reçus", "Réception 480 avec case « dernière livraison » → stock +acceptés ; fiche d'écart de 20 ; réclamation ; annulation du reliquat après validation Directeur."],
  ["Réception partielle d'un BS", "BS 50, production accepte 45 avec motif → stock composants −45, reliquat 5 remis à préparer."],
  ["Production et inspection partielle", "PRJ 30 ; TRF 20 ; seules les 20 réceptionnées apparaissent à inspecter ; 10 restent à transférer."],
  ["Inspection 20 : 18 C / 2 NC", "Contrôle arithmétique ; 18 proposables au PF ; NC de 2 bloquées."],
  ["Transfert partiel vers PF", "TFP 18, acceptation 15 → stock PF +15, 3 conformes en attente ; aucun double transfert."],
  ["Livraison", "BL généré une seule fois ; sortie unique ; OM reprend la référence Sage sans afficher le n° BL."],
  ["Retour client", "Aucun stock avant décision ; quarantaine → stock PF quarantaine ; réintégration → disponible (validée par un tiers)."],
  ["SAV manuel", "Dossier avec VIN manuel → réception → diagnostic → réparation → contrôle final → restitution → clôture."],
  ["Correction après validation", "Document verrouillé ; demande d'ajustement ADJ ; validation par une autre personne ; journal d'audit."],
  ["Permissions", "Connexion avec chaque profil : menus filtrés ; actions non autorisées refusées côté serveur."],
];

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const r = u.role;
  const isAdmin = can(r, "admin.manage");
  const tabs = [
    { key: "users", label: "Utilisateurs", show: isAdmin },
    { key: "matrix", label: "Rôles & permissions", show: isAdmin },
    { key: "models", label: "Modèles", show: isAdmin },
    { key: "suppliers", label: "Fournisseurs", show: isAdmin },
    { key: "params", label: "Paramètres", show: isAdmin },
    { key: "exc", label: "Autorisations exceptionnelles", show: isAdmin || can(r, "exc.request") || can(r, "exc.decide") },
    { key: "tests", label: "Tests & état système", show: isAdmin },
  ].filter((t) => t.show);
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : tabs[0]?.key ?? "exc";
  const back = `${B}?tab=${tab}`;
  const us = await db.select().from(users).orderBy(users.id);
  const uname = (i: number | null) => us.find((x) => x.id === i)?.fullName ?? "—";

  return (
    <div>
      <PageHeader title="Administration et paramètres" subtitle="Les droits d'administration ne donnent pas les validations métier ; aucun mouvement validé ne peut être supprimé." />
      <Flash sp={sp} />
      <Tabs base={B} tabs={tabs} active={tab} />

      {tab === "users" && (
        <>
          <Card title="+ Créer un compte">
            <form action={createUser} className="space-y-3"><Back to={back} />
              <Grid cols={4}>
                <Field label="Identifiant" required><input name="username" required className={inputCls} /></Field>
                <Field label="Nom complet" required><input name="fullName" required className={inputCls} /></Field>
                <Field label="Rôle" required><select name="role" className={inputCls}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="Mot de passe provisoire" required><input name="password" required className={inputCls} /></Field>
                <Field label="Service"><input name="service" className={inputCls} /></Field>
                <Field label="E-mail"><input name="email" type="email" className={inputCls} /></Field>
                <Field label="Téléphone"><input name="phone" className={inputCls} /></Field>
              </Grid>
              <Submit>Créer le compte</Submit>
            </form>
          </Card>
          <Card title={`Comptes (${us.length})`}>
            <Table cols={["Identifiant", "Nom", "Rôle", "Service", "Statut", "Changer rôle", "Réinitialiser", ""]} rows={us.map((x) => [<b key="u">{x.username}</b>, x.fullName, ROLES[x.role], x.service, <Badge key="s" s={x.active ? "Actif (validé)" : "Désactivé (annulé)"} />,
              <form key="r" action={userAction} className="flex gap-1"><Back to={back} /><input type="hidden" name="id" value={x.id} /><input type="hidden" name="step" value="role" /><select name="role" defaultValue={x.role} className={`${inputCls} w-44`}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><Submit small variant="secondary">OK</Submit></form>,
              <form key="p" action={userAction} className="flex gap-1"><Back to={back} /><input type="hidden" name="id" value={x.id} /><input type="hidden" name="step" value="reset" /><input name="password" placeholder="Nouveau mdp" className={`${inputCls} w-32`} /><Submit small variant="secondary">OK</Submit></form>,
              <form key="t" action={userAction}><Back to={back} /><input type="hidden" name="id" value={x.id} /><input type="hidden" name="step" value="toggle" /><Submit small variant={x.active ? "danger" : "success"} confirm={x.active ? `Désactiver ${x.username} ?` : undefined}>{x.active ? "Désactiver" : "Activer"}</Submit></form>])} />
          </Card>
        </>
      )}

      {tab === "matrix" && (
        <Card title="Matrice des rôles et permissions">
          <div className="overflow-x-auto">
            <table className="text-xs">
              <thead><tr><th className="sticky left-0 bg-white p-1 text-left">Permission</th>{Object.keys(ROLES).map((k) => <th key={k} className="p-1 align-bottom"><div className="w-6 whitespace-nowrap [writing-mode:vertical-rl]">{ROLES[k]}</div></th>)}</tr></thead>
              <tbody>{Object.entries(PERMS).map(([p, l]) => <tr key={p} className="border-t"><td className="sticky left-0 bg-white p-1">{l}</td>{Object.keys(ROLES).map((k) => <td key={k} className="p-1 text-center">{ROLE_PERMS[k]?.includes(p) ? <span className="text-emerald-600">●</span> : <span className="text-slate-200">·</span>}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500">Matrice à valider par la Direction. La séparation des tâches est appliquée côté serveur (pas d&apos;auto-validation des DA, BC, BS, ajustements, réceptions, exceptions).</p>
        </Card>
      )}

      {tab === "models" && (async () => {
        const models = await db.select().from(motoModels).orderBy(motoModels.code);
        return (
          <Card title="Référentiel des modèles">
            <form action={modelAction} className="mb-4 flex flex-wrap gap-2"><Back to={back} /><input type="hidden" name="step" value="add" /><input name="code" placeholder="Code modèle" className={`${inputCls} w-40`} /><input name="lowStock" placeholder="Seuil stock" className={`${inputCls} w-28`} /><input name="dailyTarget" placeholder="Objectif/jour" className={`${inputCls} w-28`} /><Submit small>+ Ajouter</Submit></form>
            <Table cols={["Modèle", "Statut", "Seuil stock faible / objectif journalier", ""]} rows={models.map((m) => [<b key="c">{m.code}</b>, <Badge key="s" s={m.active ? "Actif (validé)" : "Inactif (annulé)"} />,
              <form key="e" action={modelAction} className="flex gap-1"><Back to={back} /><input type="hidden" name="id" value={m.id} /><input type="hidden" name="step" value="edit" /><input name="lowStock" defaultValue={m.lowStock} className={`${inputCls} w-20`} /><input name="dailyTarget" defaultValue={m.dailyTarget} className={`${inputCls} w-20`} /><Submit small variant="secondary">OK</Submit></form>,
              <form key="t" action={modelAction}><Back to={back} /><input type="hidden" name="id" value={m.id} /><input type="hidden" name="step" value="toggle" /><Submit small variant="secondary">{m.active ? "Désactiver" : "Activer"}</Submit></form>])} />
          </Card>
        );
      })()}

      {tab === "suppliers" && (async () => {
        const sups = await db.select().from(suppliers).orderBy(suppliers.name);
        return (
          <Card title="Référentiel fournisseurs">
            <form action={addSupplier} className="mb-4 flex flex-wrap gap-2"><Back to={back} /><input name="name" placeholder="Nom *" className={`${inputCls} w-56`} /><select name="kind" className={`${inputCls} w-36`}><option value="LOCAL">Local</option><option value="ETRANGER">Étranger</option></select><input name="country" placeholder="Pays" className={`${inputCls} w-32`} /><input name="contact" placeholder="Contact" className={`${inputCls} w-48`} /><Submit small>+ Ajouter</Submit></form>
            <Table cols={["Nom", "Type", "Pays", "Contact"]} rows={sups.map((s) => [s.name, s.kind === "LOCAL" ? "Local" : "Étranger", s.country, s.contact])} />
          </Card>
        );
      })()}

      {tab === "params" && (async () => {
        const s = await getSettings();
        return (
          <Card title="Paramètres généraux">
            <form action={saveSettings} className="space-y-3"><Back to={back} />
              <Grid cols={2}>{Object.entries(SETTING_LABELS).map(([k, l]) => <Field key={k} label={l}><input name={k} defaultValue={s[k]} className={inputCls} /></Field>)}</Grid>
              <Submit confirm="Enregistrer les paramètres ?">Enregistrer</Submit>
            </form>
          </Card>
        );
      })()}

      {tab === "exc" && (async () => {
        const list = await db.select().from(exceptionRequests).orderBy(desc(exceptionRequests.id));
        return (
          <>
            {(can(r, "exc.request") || isAdmin) && (
              <Card title="+ Demander une autorisation exceptionnelle">
                <form action={requestException} className="space-y-3"><Back to={back} />
                  <Grid cols={4}>
                    <Field label="Type" required><select name="kind" className={inputCls}><option>Réception supérieure à la quantité commandée/prévue</option><option>Livraison au-delà du stock</option><option>Autre exception</option></select></Field>
                    <Field label="Référence document (BC-…, LST-…)" required><input name="docRef" required className={inputCls} /></Field>
                    <Field label="Description" required><input name="description" required className={inputCls} /></Field>
                    <Field label="Justification" required><input name="justification" required className={inputCls} /></Field>
                  </Grid>
                  <Submit>Soumettre</Submit>
                </form>
              </Card>
            )}
            <Card title="Autorisations exceptionnelles">
              <Table cols={["N°", "Date", "Type", "Référence", "Description / justification", "Demandeur", "Statut", "Décision"]} rows={list.map((e) => [<b key="n">{e.no}</b>, fdt(e.createdAt), e.kind, e.docRef, <span key="d" className="text-xs">{e.description} – {e.justification}</span>, uname(e.requestedBy), <Badge key="s" s={e.usedAt ? "Clôturé (utilisée)" : e.status} />,
                e.status === "À valider" && can(r, "exc.decide") && e.requestedBy !== u.id ? <form key="f" action={decideException} className="flex gap-1"><Back to={back} /><input type="hidden" name="id" value={e.id} /><input name="comment" placeholder="Commentaire" className={`${inputCls} w-32`} /><Submit small variant="success" name="decision" value="approve">Approuver</Submit><Submit small variant="danger" name="decision" value="reject">Refuser</Submit></form> : e.decidedBy ? `${uname(e.decidedBy)}${e.decisionComment ? " – " + e.decisionComment : ""}` : ""])} />
            </Card>
          </>
        );
      })()}

      {tab === "tests" && (async () => {
        const stats = (await db.execute(sql`select (select count(*) from users)::int users, (select count(*) from stock_movements)::int mvts, (select count(*) from audit_log)::int audit, (select count(*) from attachments)::int files, (select count(*) from stock_movements group by idem_key having count(*)>1 limit 1)::int dup`)).rows[0] as Record<string, number | null>;
        const neg = (await db.execute(sql`select store, state, model, sum(qty)::int q from stock_movements group by 1,2,3 having sum(qty) < 0`)).rows as { store: string; state: string; model: string; q: number }[];
        return (
          <>
            <Card title="État du système">
              <Table cols={["Contrôle", "Résultat"]} rows={[["Base de données", <Badge key="a" s="Connectée (validé)" />], ["Utilisateurs", stats.users], ["Mouvements de stock", stats.mvts], ["Entrées d'audit", stats.audit], ["Pièces jointes", stats.files], ["Doublons de mouvements", stats.dup ? <Badge key="d" s="Anomalie" /> : <Badge key="d" s="Aucun (validé)" />], ["Stocks négatifs", neg.length ? <span key="n" className="text-red-700">{neg.map((n) => `${n.store}/${n.state}/${n.model}: ${n.q}`).join(", ")}</span> : <Badge key="n" s="Aucun (validé)" />]]} />
            </Card>
            <Card title="Scénarios de test obligatoires avant mise en service">
              <Table cols={["#", "Scénario", "Procédure / résultat attendu"]} rows={SCENARIOS.map(([a, b], i) => [i + 1, <b key="a">{a}</b>, <span key="b" className="text-sm">{b}</span>])} />
            </Card>
          </>
        );
      })()}
    </div>
  );
}
