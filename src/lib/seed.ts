import { sql } from "drizzle-orm";
import { db } from "@/db";
import { motoModels, suppliers, users, stockMovements } from "@/db/schema";
import { hashPassword } from "./auth";

export const DEMO_ACCOUNTS: { username: string; password: string; fullName: string; role: string; service: string }[] = [
  { username: "admin", password: "Admin@2026", fullName: "Administrateur Système", role: "ADMIN", service: "Informatique" },
  { username: "gerant", password: "Gerant@2026", fullName: "Gérant ZIMOTA", role: "GERANT", service: "Direction" },
  { username: "demandeur", password: "Demande@2026", fullName: "Sami Demandeur", role: "DEMANDEUR", service: "Usine" },
  { username: "achats", password: "Achats@2026", fullName: "Leila Achats Locaux", role: "ACHATS_LOCAUX", service: "Achats" },
  { username: "import", password: "Import@2026", fullName: "Karim Import", role: "ACHATS_IMPORT", service: "Achats" },
  { username: "directeur", password: "Directeur@2026", fullName: "Mounir Directeur Appro", role: "DIR_APPRO", service: "Approvisionnement" },
  { username: "daf", password: "Daf@2026", fullName: "Nadia DAF", role: "DAF", service: "Finance" },
  { username: "magasinier", password: "Magasin@2026", fullName: "Hedi Magasinier", role: "MAGASINIER", service: "Magasin" },
  { username: "production", password: "Prod@2026", fullName: "Walid Production", role: "PRODUCTION", service: "Production" },
  { username: "qualite", password: "Qualite@2026", fullName: "Amel Qualité", role: "QUALITE", service: "Qualité" },
  { username: "pf", password: "Pf@2026", fullName: "Rami Produits Finis", role: "GESTIONNAIRE_PF", service: "Produits finis" },
  { username: "livraison", password: "Livraison@2026", fullName: "Yassine Livraison", role: "LIVRAISON", service: "Logistique" },
  { username: "chauffeur", password: "Chauffeur@2026", fullName: "Fathi Chauffeur", role: "CHAUFFEUR", service: "Logistique" },
  { username: "sav", password: "Sav@2026", fullName: "Sonia SAV", role: "SAV", service: "SAV" },
  { username: "immo", password: "Immo@2026", fullName: "Omar Immobilisations", role: "IMMO", service: "Finance" },
];

export const MODELS = ["SINUS", "SN26", "TARGET", "JOY", "RS", "EAGLE", "SWING", "V005", "TH", "SU", "RI", "NS", "PARTNER", "TI", "EVO", "FY", "TP", "SRK", "ATOM", "PIZ"];

let done = false;

export async function ensureSeed() {
  if (done) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(424242)`);
    const c = await tx.select({ n: sql<number>`count(*)::int` }).from(users);
    if (Number(c[0].n) > 0) return;
    for (const a of DEMO_ACCOUNTS) {
      await tx.insert(users).values({ username: a.username, passwordHash: hashPassword(a.password), fullName: a.fullName, role: a.role, service: a.service });
    }
    await tx.insert(motoModels).values(MODELS.map((code) => ({ code }))).onConflictDoNothing();
    await tx.insert(suppliers).values([
      { name: "Bureau Plus SARL", kind: "LOCAL", country: "Tunisie", contact: "71 000 000" },
      { name: "Quincaillerie Moderne", kind: "LOCAL", country: "Tunisie", contact: "72 000 000" },
      { name: "InfoTech Tunisie", kind: "LOCAL", country: "Tunisie", contact: "70 000 000" },
      { name: "Chongqing Moto Parts Co.", kind: "ETRANGER", country: "Chine", contact: "sales@cq-moto.cn" },
      { name: "Jiangmen Motorcycle Ltd.", kind: "ETRANGER", country: "Chine", contact: "export@jm-moto.cn" },
    ]);
    const init: [string, string, number][] = [["COMP", "SINUS", 120], ["COMP", "JOY", 80], ["COMP", "RS", 60], ["COMP", "EAGLE", 15], ["PF", "SINUS", 25], ["PF", "JOY", 12]];
    for (const [store, model, qty] of init) {
      await tx.insert(stockMovements).values({ store, model, qty, state: "DISPONIBLE", sourceType: "Stock initial", sourceNo: "INIT", idemKey: `INIT:${store}:${model}` }).onConflictDoNothing();
    }
  });
  done = true;
}
