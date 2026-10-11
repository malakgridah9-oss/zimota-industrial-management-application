import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { Card, PageHeader, Stat, StatGrid, Table, Badge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getTasks } from "@/lib/tasks";
import { ROLES } from "@/lib/perms";
import { fdt } from "@/lib/core";

export const dynamic = "force-dynamic";

async function one(q: ReturnType<typeof sql>) {
  const r = await db.execute(q);
  return Number((r.rows[0] as { n: number } | undefined)?.n ?? 0);
}

export default async function Dashboard() {
  const u = await requireUser();
  const tasks = await getTasks(u);
  const [daOpen, poOpen, impOpen, rec30, compAvail, compBlocked, prodToday, target, toInspect, pfAvail, claimsOpen, savOpen] = await Promise.all([
    one(sql`select count(*)::int n from purchase_requests where status not in ('Brouillon','Clôturée','Rejetée','Annulée','Entièrement commandée')`),
    one(sql`select count(*)::int n from purchase_orders where status not in ('Clôturé','Annulé','Rejeté','Entièrement reçu')`),
    one(sql`select count(*)::int n from import_files where status not in ('Clôturé')`),
    one(sql`select count(*)::int n from receptions where created_at > now() - interval '30 days'`),
    one(sql`select coalesce(sum(qty),0)::int n from stock_movements where store='COMP' and state='DISPONIBLE'`),
    one(sql`select coalesce(sum(qty),0)::int n from stock_movements where store='COMP' and state='BLOQUE'`),
    one(sql`select coalesce(sum(qty),0)::int n from productions where prod_date = current_date`),
    one(sql`select coalesce(sum(daily_target),0)::int n from moto_models where active`),
    one(sql`select coalesce(sum(received_qty - inspected_qty),0)::int n from inspections`),
    one(sql`select coalesce(sum(qty),0)::int n from stock_movements where store='PF' and state='DISPONIBLE'`),
    one(sql`select count(*)::int n from claims where status <> 'Clôturée'`),
    one(sql`select count(*)::int n from sav_cases where status <> 'Clôturé'`),
  ]);
  const week = (await db.execute(sql`select to_char(d,'DD/MM') as day, coalesce((select sum(qty) from productions p where p.prod_date=d::date),0)::int as q from generate_series(current_date - 6, current_date, '1 day') d order by d`)).rows as { day: string; q: number }[];
  const maxW = Math.max(1, ...week.map((w) => Number(w.q)));
  const lows = (await db.execute(sql`select m.code, m.low_stock, coalesce(sum(s.qty) filter (where s.store='COMP' and s.state='DISPONIBLE'),0)::int as comp, coalesce(sum(s.qty) filter (where s.store='PF' and s.state='DISPONIBLE'),0)::int as pf from moto_models m left join stock_movements s on s.model=m.code where m.active group by m.code, m.low_stock order by m.code`)).rows as { code: string; low_stock: number; comp: number; pf: number }[];
  const recent = (await db.execute(sql`select user_name, doc_type, doc_no, action, created_at from audit_log where doc_type<>'SESSION' order by id desc limit 8`)).rows as { user_name: string; doc_type: string; doc_no: string | null; action: string; created_at: string }[];
  const pct = target ? Math.round((prodToday / target) * 100) : 0;

  return (
    <div>
      <PageHeader title={`Bonjour, ${u.fullName}`} subtitle={`${ROLES[u.role]} · Vue de synthèse de votre périmètre`} />
      <StatGrid>
        <Stat label="Achats locaux en cours" value={daOpen + poOpen} hint={`${daOpen} DA · ${poOpen} BC`} href="/achats" tone="blue" />
        <Stat label="Dossiers d'import ouverts" value={impOpen} href="/import" tone="blue" />
        <Stat label="Réceptions (30 j)" value={rec30} href="/reception" tone="slate" />
        <Stat label="Stock composants dispo." value={compAvail} hint={`${compBlocked} bloqués`} href="/stock" tone="green" />
        <Stat label="Production du jour" value={`${prodToday} / ${target}`} hint={`${pct}% de l'objectif`} href="/production" tone={pct >= 100 ? "green" : "amber"} />
        <Stat label="En attente d'inspection" value={toInspect} href="/inspection" tone="amber" />
        <Stat label="PF prêts à livrer" value={pfAvail} href="/pf" tone="green" />
        <Stat label="Réclamations en cours" value={claimsOpen} href="/reclamations" tone="red" />
        <Stat label="Dossiers SAV ouverts" value={savOpen} href="/sav" tone="amber" />
        <Stat label="Mes tâches en attente" value={tasks.reduce((s, t) => s + t.count, 0)} tone="red" />
      </StatGrid>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Mes tâches et alertes">
          {tasks.length === 0 ? <p className="text-sm text-slate-500">Aucune tâche en attente. 👍</p> : (
            <ul className="divide-y divide-slate-100">
              {tasks.map((t) => (
                <li key={t.label}>
                  <Link href={t.href} className="flex items-center justify-between py-2 text-sm hover:text-red-700">
                    <span>{t.tone === "red" ? "🔴" : "🟠"} {t.label}</span>
                    <span className="rounded-full bg-slate-100 px-2 font-bold">{t.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Production des 7 derniers jours">
          <div className="flex h-44 items-end gap-2">
            {week.map((w) => (
              <div key={w.day} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-xs font-semibold">{w.q}</span>
                <div className="w-full rounded-t bg-gradient-to-t from-red-800 to-red-500" style={{ height: `${(Number(w.q) / maxW) * 130 + 2}px` }} />
                <span className="text-[10px] text-slate-500">{w.day}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="État des stocks par modèle">
          <Table
            cols={["Modèle", "Composants dispo.", "PF dispo.", "Alerte"]}
            rows={lows.filter((l) => l.comp || l.pf || true).slice(0, 20).map((l) => [
              <b key="c">{l.code}</b>, l.comp, l.pf,
              l.comp === 0 ? <Badge key="b" s="Rupture" /> : l.comp < l.low_stock ? <Badge key="b" s="Stock faible (attente)" /> : <Badge key="b" s="Disponible" />,
            ])}
          />
        </Card>
        <Card title="Dernières opérations tracées">
          <Table
            cols={["Date", "Utilisateur", "Document", "Action"]}
            rows={recent.map((r) => [fdt(r.created_at), r.user_name, `${r.doc_type} ${r.doc_no ?? ""}`, r.action])}
          />
        </Card>
      </div>
    </div>
  );
}
