export const ROLES: Record<string, string> = {
  DEMANDEUR: "Demandeur interne",
  ACHATS_LOCAUX: "Responsable achats locaux",
  ACHATS_IMPORT: "Responsable achats/import",
  DIR_APPRO: "Directeur approvisionnement",
  DAF: "DAF / Comptabilité",
  MAGASINIER: "Magasinier composants",
  PRODUCTION: "Responsable production",
  QUALITE: "Responsable qualité / inspection",
  GESTIONNAIRE_PF: "Gestionnaire produits finis",
  LIVRAISON: "Responsable livraison / transport",
  CHAUFFEUR: "Chauffeur / transporteur",
  SAV: "Responsable retours / SAV",
  IMMO: "Gestionnaire des immobilisations",
  GERANT: "Gérant",
  ADMIN: "Administrateur",
};

export const PERMS: Record<string, string> = {
  "da.create": "Créer ses demandes d'achat",
  "da.process": "Examiner les DA (accepter / retourner / rejeter)",
  "bc.manage": "Créer et émettre les bons de commande",
  "bc.validate": "Valider les BC ≥ seuil",
  "rcf.admin": "Enregistrer la réception administrative (BL fournisseur)",
  "rcf.confirm": "Confirmer « Reçu conforme »",
  "inv.manage": "Enregistrer factures & rapprochement",
  "inv.daf": "Contrôle DAF & statuts financiers",
  "asset.manage": "Gérer les immobilisations",
  "imp.manage": "Gérer les dossiers d'import",
  "imp.validate": "Valider / clôturer les dossiers d'import",
  "rec.create": "Réceptionner les composants",
  "claim.create": "Signaler un écart",
  "claim.manage": "Traiter les réclamations",
  "claim.decide": "Décider sur les réclamations",
  "stock.view": "Consulter le stock composants",
  "adj.request": "Demander un ajustement",
  "adj.validate": "Valider un ajustement",
  "dem.create": "Créer une demande de composants",
  "bs.prepare": "Préparer un bon de sortie",
  "bs.receive": "Réceptionner un bon de sortie",
  "prj.create": "Déclarer la production",
  "trf.create": "Transférer vers inspection",
  "trf.receive": "Réceptionner un transfert (qualité)",
  "insp.do": "Inspecter / non-conformités",
  "pf.propose": "Proposer transfert vers PF",
  "pf.receive": "Réceptionner en stock PF",
  "pf.view": "Consulter le stock PF",
  "dlv.create": "Créer une demande de livraison",
  "dlv.validate": "Valider la sortie & générer le BL",
  "om.manage": "Gérer les ordres de mission",
  "om.driver": "Suivre ses missions (chauffeur)",
  "ret.create": "Enregistrer un retour client",
  "ret.decide": "Décider d'un retour client",
  "sav.manage": "Gérer les dossiers SAV",
  "reports.view": "Rapports & exports",
  "audit.view": "Journal d'audit",
  "exc.request": "Demander une autorisation exceptionnelle",
  "exc.decide": "Décider des autorisations exceptionnelles",
  "admin.manage": "Administration (comptes, paramètres, référentiels)",
  "view.all": "Consultation globale (lecture seule)",
};

export const ROLE_PERMS: Record<string, string[]> = {
  DEMANDEUR: ["da.create"],
  ACHATS_LOCAUX: ["da.create", "da.process", "bc.manage", "rcf.admin", "inv.manage", "claim.manage", "exc.request", "reports.view"],
  ACHATS_IMPORT: ["imp.manage", "claim.create", "claim.manage", "stock.view", "exc.request", "reports.view"],
  DIR_APPRO: ["bc.validate", "imp.validate", "claim.manage", "claim.decide", "stock.view", "adj.validate", "exc.decide", "reports.view", "audit.view"],
  DAF: ["inv.daf", "reports.view"],
  MAGASINIER: ["rcf.confirm", "rec.create", "claim.create", "stock.view", "adj.request", "bs.prepare", "exc.request"],
  PRODUCTION: ["dem.create", "bs.receive", "prj.create", "trf.create", "stock.view"],
  QUALITE: ["trf.receive", "insp.do", "pf.propose"],
  GESTIONNAIRE_PF: ["pf.receive", "pf.view", "dlv.create", "dlv.validate", "om.manage", "ret.create", "adj.request"],
  LIVRAISON: ["pf.view", "dlv.create", "dlv.validate", "om.manage"],
  CHAUFFEUR: ["om.driver"],
  SAV: ["sav.manage", "ret.create", "ret.decide"],
  IMMO: ["asset.manage"],
  GERANT: ["view.all", "reports.view", "audit.view", "adj.validate", "ret.decide", "exc.decide", "claim.decide", "stock.view", "pf.view"],
  ADMIN: ["admin.manage", "audit.view", "reports.view", "adj.validate"],
};

export function can(role: string, perm: string) {
  return (ROLE_PERMS[role] ?? []).includes(perm);
}

export type MenuItem = { href: string; label: string; icon: string; perms: string[] };

export const MENU: MenuItem[] = [
  { href: "/", label: "Tableau de bord", icon: "▦", perms: ["*"] },
  { href: "/achats", label: "Achats locaux", icon: "🛒", perms: ["da.create", "da.process", "bc.manage", "bc.validate", "rcf.admin", "rcf.confirm", "inv.manage", "inv.daf", "asset.manage"] },
  { href: "/import", label: "Achats importations", icon: "🚢", perms: ["imp.manage", "imp.validate"] },
  { href: "/reception", label: "Réception composants", icon: "📦", perms: ["rec.create", "imp.manage", "imp.validate"] },
  { href: "/stock", label: "Gestion des stocks", icon: "🏬", perms: ["stock.view", "adj.request", "adj.validate", "bs.prepare", "dem.create"] },
  { href: "/production", label: "Production", icon: "🏭", perms: ["dem.create", "bs.receive", "prj.create", "trf.create"] },
  { href: "/inspection", label: "Inspection et conformité", icon: "✔", perms: ["trf.receive", "insp.do", "pf.propose"] },
  { href: "/pf", label: "Stock produits finis", icon: "🏍", perms: ["pf.receive", "pf.view", "ret.create", "ret.decide"] },
  { href: "/livraison", label: "Livraison et transport", icon: "🚚", perms: ["dlv.create", "dlv.validate", "om.manage", "om.driver"] },
  { href: "/sav", label: "Gestion SAV", icon: "🔧", perms: ["sav.manage"] },
  { href: "/reclamations", label: "Réclamations", icon: "⚠", perms: ["claim.create", "claim.manage", "claim.decide"] },
  { href: "/rapports", label: "Rapports et statistiques", icon: "📊", perms: ["reports.view", "audit.view"] },
  { href: "/admin", label: "Administration", icon: "⚙", perms: ["admin.manage", "exc.request", "exc.decide"] },
];

export function canSeeMenu(role: string, item: MenuItem) {
  if (item.perms.includes("*")) return true;
  if (can(role, "view.all") && item.href !== "/admin") return true;
  return item.perms.some((p) => can(role, p));
}
