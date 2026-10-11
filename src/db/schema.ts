import {
  pgTable, serial, text, integer, boolean, timestamp, jsonb, doublePrecision, uniqueIndex, date,
} from "drizzle-orm/pg-core";

const ts = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  role: text("role").notNull(),
  service: text("service"),
  active: boolean("active").default(true).notNull(),
  createdAt: ts(),
});

export const sessions = pgTable("sessions", {
  token: text("token").primaryKey(),
  userId: integer("user_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const counters = pgTable("counters", {
  id: text("id").primaryKey(), // PREFIX-YEAR
  value: integer("value").notNull().default(0),
});

export const motoModels = pgTable("moto_models", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  active: boolean("active").default(true).notNull(),
  lowStock: integer("low_stock").default(20).notNull(),
  dailyTarget: integer("daily_target").default(10).notNull(),
});

export const suppliers = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // LOCAL / ETRANGER
  country: text("country"),
  contact: text("contact"),
});

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  userName: text("user_name"),
  docType: text("doc_type").notNull(),
  docNo: text("doc_no"),
  action: text("action").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  reason: text("reason"),
  createdAt: ts(),
});

export const attachments = pgTable("attachments", {
  id: serial("id").primaryKey(),
  docType: text("doc_type").notNull(),
  docId: integer("doc_id").notNull(),
  filename: text("filename").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  data: text("data").notNull(),
  userId: integer("user_id"),
  createdAt: ts(),
});

/* ---------- Achats locaux ---------- */
export const purchaseRequests = pgTable("purchase_requests", {
  id: serial("id").primaryKey(),
  no: text("no").notNull().unique(),
  requesterId: integer("requester_id").notNull(),
  service: text("service"),
  needType: text("need_type").notNull(),
  pointOfSale: text("point_of_sale"),
  motif: text("motif").notNull(),
  justification: text("justification"),
  urgency: text("urgency").notNull().default("Normale"),
  status: text("status").notNull().default("Brouillon"),
  comment: text("comment"),
  createdAt: ts(),
});

export const purchaseRequestLines = pgTable("purchase_request_lines", {
  id: serial("id").primaryKey(),
  daId: integer("da_id").notNull(),
  designation: text("designation").notNull(),
  qty: doublePrecision("qty").notNull(),
  unit: text("unit").notNull().default("U"),
  urgency: text("urgency"),
  justification: text("justification"),
  isAsset: boolean("is_asset").default(false).notNull(),
  orderedQty: doublePrecision("ordered_qty").default(0).notNull(),
});

export const purchaseOrders = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  no: text("no").notNull().unique(),
  supplierId: integer("supplier_id"),
  status: text("status").notNull().default("Brouillon"),
  stamp: doublePrecision("stamp").default(1).notNull(),
  conditions: text("conditions"),
  deliveryDate: date("delivery_date"),
  observations: text("observations"),
  totalHt: doublePrecision("total_ht").default(0).notNull(),
  totalTva: doublePrecision("total_tva").default(0).notNull(),
  totalTtc: doublePrecision("total_ttc").default(0).notNull(),
  createdBy: integer("created_by").notNull(),
  validatedBy: integer("validated_by"),
  validatedAt: timestamp("validated_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  rejectReason: text("reject_reason"),
  createdAt: ts(),
});

export const purchaseOrderLines = pgTable("purchase_order_lines", {
  id: serial("id").primaryKey(),
  poId: integer("po_id").notNull(),
  daLineId: integer("da_line_id").notNull(),
  designation: text("designation").notNull(),
  qty: doublePrecision("qty").notNull(),
  unit: text("unit").notNull().default("U"),
  unitPrice: doublePrecision("unit_price").default(0).notNull(),
  discount: doublePrecision("discount").default(0).notNull(),
  tva: doublePrecision("tva").default(19).notNull(),
  receivedQty: doublePrecision("received_qty").default(0).notNull(),
  isAsset: boolean("is_asset").default(false).notNull(),
});

export const supplierReceipts = pgTable("supplier_receipts", {
  id: serial("id").primaryKey(),
  no: text("no").notNull().unique(),
  poId: integer("po_id").notNull(),
  blNumber: text("bl_number").notNull(),
  receiptDate: date("receipt_date").notNull(),
  status: text("status").notNull().default("En attente de réception"),
  lines: jsonb("lines").$type<{ poLineId: number; qty: number; state: string; comment?: string }[]>().notNull(),
  comment: text("comment"),
  createdBy: integer("created_by").notNull(),
  confirmedBy: integer("confirmed_by"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: ts(),
});

export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  no: text("no").notNull().unique(),
  invoiceNumber: text("invoice_number").notNull(),
  invoiceDate: date("invoice_date").notNull(),
  supplierId: integer("supplier_id").notNull(),
  poIds: jsonb("po_ids").$type<number[]>().notNull(),
  receiptIds: jsonb("receipt_ids").$type<number[]>().notNull(),
  ht: doublePrecision("ht").notNull(),
  tva: doublePrecision("tva").notNull(),
  stamp: doublePrecision("stamp").notNull(),
  ttc: doublePrecision("ttc").notNull(),
  status: text("status").notNull().default("Enregistrée"),
  comment: text("comment"),
  createdBy: integer("created_by").notNull(),
  createdAt: ts(),
});

export const assets = pgTable("assets", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  designation: text("designation").notNull(),
  brand: text("brand"),
  model: text("model"),
  serial: text("serial"),
  acquisitionDate: date("acquisition_date"),
  supplierId: integer("supplier_id"),
  refs: text("refs"),
  service: text("service"),
  location: text("location"),
  holder: text("holder"),
  condition: text("condition").default("Neuf"),
  assignStatus: text("assign_status").notNull().default("Non affecté"),
  createdAt: ts(),
});

export const assetMoves = pgTable("asset_moves", {
  id: serial("id").primaryKey(),
  assetId: integer("asset_id").notNull(),
  kind: text("kind").notNull(),
  oldHolder: text("old_holder"),
  newHolder: text("new_holder"),
  oldLocation: text("old_location"),
  newLocation: text("new_location"),
  reason: text("reason"),
  userId: integer("user_id"),
  createdAt: ts(),
});

/* ---------- Import ---------- */
export const importFiles = pgTable("import_files", {
  id: serial("id").primaryKey(),
  no: text("no").notNull().unique(),
  supplierId: integer("supplier_id").notNull(),
  piNumber: text("pi_number").notNull(),
  piDate: date("pi_date").notNull(),
  models: jsonb("models").$type<string[]>().notNull(),
  extra: jsonb("extra").$type<Record<string, string>>().notNull(),
  fees: jsonb("fees").$type<{ label: string; amount: number }[]>().notNull(),
  status: text("status").notNull().default("Brouillon"),
  createdBy: integer("created_by").notNull(),
  createdAt: ts(),
});

export const packingLists = pgTable("packing_lists", {
  id: serial("id").primaryKey(),
  no: text("no").notNull().unique(),
  importId: integer("import_id").notNull(),
  status: text("status").notNull().default("Brouillon"),
  validatedBy: integer("validated_by"),
  createdAt: ts(),
});

export const packingLines = pgTable("packing_lines", {
  id: serial("id").primaryKey(),
  listId: integer("list_id").notNull(),
  model: text("model").notNull(),
  plannedQty: integer("planned_qty").notNull(),
  cancelledQty: integer("cancelled_qty").default(0).notNull(),
  receivedQty: integer("received_qty").default(0).notNull(),
  acceptedQty: integer("accepted_qty").default(0).notNull(),
  damagedQty: integer("damaged_qty").default(0).notNull(),
}, (t) => [uniqueIndex("packing_list_model_uq").on(t.listId, t.model)]);

export const receptions = pgTable("receptions", {
  id: serial("id").primaryKey(),
  no: text("no").notNull().unique(),
  listId: integer("list_id").notNull(),
  location: text("location"),
  lines: jsonb("lines").$type<{ model: string; received: number; accepted: number; damaged: number; obs?: string }[]>().notNull(),
  userId: integer("user_id").notNull(),
  createdAt: ts(),
});

export const claims = pgTable("claims", {
  id: serial("id").primaryKey(),
  no: text("no").notNull().unique(),
  claimNo: text("claim_no"),
  kind: text("kind").notNull().default("ECART"),
  receptionId: integer("reception_id"),
  importId: integer("import_id"),
  poId: integer("po_id"),
  model: text("model"),
  qty: integer("qty").default(0).notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("Ouverte"),
  followUpDate: date("follow_up_date"),
  supplierResponse: text("supplier_response"),
  proposedAction: text("proposed_action"),
  decision: text("decision"),
  decidedBy: integer("decided_by"),
  createdBy: integer("created_by").notNull(),
  createdAt: ts(),
});

/* ---------- Stock ---------- */
export const stockMovements = pgTable("stock_movements", {
  id: serial("id").primaryKey(),
  store: text("store").notNull(), // COMP | PROD | PF
  state: text("state").notNull().default("DISPONIBLE"), // DISPONIBLE | BLOQUE | QUARANTAINE
  model: text("model").notNull(),
  qty: integer("qty").notNull(),
  location: text("location"),
  vin: text("vin"),
  sourceType: text("source_type").notNull(),
  sourceNo: text("source_no").notNull(),
  idemKey: text("idem_key").notNull().unique(),
  userId: integer("user_id"),
  createdAt: ts(),
});

export const adjustments = pgTable("adjustments", {
  id: serial("id").primaryKey(),
  no: text("no").notNull().unique(),
  store: text("store").notNull(),
  state: text("state").notNull().default("DISPONIBLE"),
  model: text("model").notNull(),
  qty: integer("qty").notNull(),
  sourceDoc: text("source_doc").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("À valider"),
  requestedBy: integer("requested_by").notNull(),
  decidedBy: integer("decided_by"),
  decisionComment: text("decision_comment"),
  createdAt: ts(),
});

export const componentRequests = pgTable("component_requests", {
  id: serial("id").primaryKey(),
  no: text("no").notNull().unique(),
  model: text("model").notNull(),
  qty: integer("qty").notNull(),
  neededDate: date("needed_date").notNull(),
  priority: text("priority").notNull().default("Normale"),
  obs: text("obs"),
  preparedQty: integer("prepared_qty").default(0).notNull(),
  status: text("status").notNull().default("À préparer"),
  requestedBy: integer("requested_by").notNull(),
  createdAt: ts(),
});

export const exitSlips = pgTable("exit_slips", {
  id: serial("id").primaryKey(),
  no: text("no").notNull().unique(),
  demId: integer("dem_id").notNull(),
  model: text("model").notNull(),
  qty: integer("qty").notNull(),
  status: text("status").notNull().default("Émis"),
  preparedBy: integer("prepared_by").notNull(),
  rpNo: text("rp_no"),
  receivedBy: integer("received_by"),
  acceptedQty: integer("accepted_qty"),
  refusedQty: integer("refused_qty"),
  reason: text("reason"),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  usedQty: integer("used_qty").default(0).notNull(),
  createdAt: ts(),
});

/* ---------- Production / Qualité ---------- */
export const productions = pgTable("productions", {
  id: serial("id").primaryKey(),
  no: text("no").notNull().unique(),
  bsId: integer("bs_id"),
  model: text("model").notNull(),
  prodDate: date("prod_date").notNull(),
  qty: integer("qty").notNull(),
  team: text("team"),
  headcount: integer("headcount"),
  componentsUsed: integer("components_used"),
  obs: text("obs"),
  transferredQty: integer("transferred_qty").default(0).notNull(),
  status: text("status").notNull().default("Validé"),
  createdBy: integer("created_by").notNull(),
  createdAt: ts(),
});

export const transfers = pgTable("transfers", {
  id: serial("id").primaryKey(),
  no: text("no").notNull().unique(),
  prjId: integer("prj_id").notNull(),
  model: text("model").notNull(),
  qty: integer("qty").notNull(),
  status: text("status").notNull().default("En attente"),
  acceptedQty: integer("accepted_qty"),
  reason: text("reason"),
  issuedBy: integer("issued_by").notNull(),
  receivedBy: integer("received_by"),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  createdAt: ts(),
});

export const inspections = pgTable("inspections", {
  id: serial("id").primaryKey(),
  no: text("no").notNull().unique(),
  trfId: integer("trf_id").notNull().unique(),
  model: text("model").notNull(),
  receivedQty: integer("received_qty").notNull(),
  inspectedQty: integer("inspected_qty").default(0).notNull(),
  conformQty: integer("conform_qty").default(0).notNull(),
  nonConformQty: integer("non_conform_qty").default(0).notNull(),
  pfProposedQty: integer("pf_proposed_qty").default(0).notNull(),
  status: text("status").notNull().default("À inspecter"),
  createdAt: ts(),
});

export const inspectionSessions = pgTable("inspection_sessions", {
  id: serial("id").primaryKey(),
  no: text("no").notNull().unique(),
  fiId: integer("fi_id").notNull(),
  inspected: integer("inspected").notNull(),
  conform: integer("conform").notNull(),
  nonConform: integer("non_conform").notNull(),
  defects: text("defects"),
  userId: integer("user_id").notNull(),
  createdAt: ts(),
});

export const nonConformities = pgTable("non_conformities", {
  id: serial("id").primaryKey(),
  no: text("no").notNull().unique(),
  fiId: integer("fi_id").notNull(),
  sesId: integer("ses_id"),
  model: text("model").notNull(),
  qty: integer("qty").notNull(),
  defect: text("defect").notNull(),
  severity: text("severity").notNull(),
  expectedDecision: text("expected_decision"),
  responsible: text("responsible"),
  status: text("status").notNull().default("Ouverte"),
  decision: text("decision"),
  createdAt: ts(),
});

export const pfTransfers = pgTable("pf_transfers", {
  id: serial("id").primaryKey(),
  no: text("no").notNull().unique(),
  fiId: integer("fi_id").notNull(),
  model: text("model").notNull(),
  qty: integer("qty").notNull(),
  vins: text("vins"),
  status: text("status").notNull().default("En attente"),
  acceptedQty: integer("accepted_qty"),
  epfNo: text("epf_no"),
  proposedBy: integer("proposed_by").notNull(),
  receivedBy: integer("received_by"),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  createdAt: ts(),
});

/* ---------- Livraison ---------- */
export const deliveries = pgTable("deliveries", {
  id: serial("id").primaryKey(),
  no: text("no").notNull().unique(),
  client: text("client").notNull(),
  address: text("address").notNull(),
  sageRef: text("sage_ref").notNull(),
  model: text("model").notNull(),
  qty: integer("qty").notNull(),
  wantedDate: date("wanted_date"),
  status: text("status").notNull().default("À préparer"),
  reserved: boolean("reserved").default(false).notNull(),
  preparedQty: integer("prepared_qty"),
  vins: text("vins"),
  transportInfo: text("transport_info"),
  blNo: text("bl_no").unique(),
  blAt: timestamp("bl_at", { withTimezone: true }),
  missionId: integer("mission_id"),
  createdBy: integer("created_by").notNull(),
  createdAt: ts(),
});

export const missions = pgTable("missions", {
  id: serial("id").primaryKey(),
  no: text("no").notNull().unique(),
  deliveryIds: jsonb("delivery_ids").$type<number[]>().notNull(),
  departure: text("departure").notNull(),
  driver: text("driver").notNull(),
  driverPhone: text("driver_phone"),
  vehicle: text("vehicle"),
  plate: text("plate").notNull(),
  carrier: text("carrier"),
  instructions: text("instructions"),
  driverUserId: integer("driver_user_id"),
  status: text("status").notNull().default("Planifiée"),
  proof: text("proof"),
  incident: text("incident"),
  createdBy: integer("created_by").notNull(),
  createdAt: ts(),
});

export const customerReturns = pgTable("customer_returns", {
  id: serial("id").primaryKey(),
  no: text("no").notNull().unique(),
  client: text("client").notNull(),
  blNo: text("bl_no"),
  model: text("model").notNull(),
  qty: integer("qty").notNull(),
  vin: text("vin"),
  returnDate: date("return_date").notNull(),
  reason: text("reason").notNull(),
  condition: text("condition").notNull(),
  savNo: text("sav_no"),
  status: text("status").notNull().default("À examiner"),
  decision: text("decision"),
  decisionComment: text("decision_comment"),
  decidedBy: integer("decided_by"),
  createdBy: integer("created_by").notNull(),
  createdAt: ts(),
});

export const savCases = pgTable("sav_cases", {
  id: serial("id").primaryKey(),
  no: text("no").notNull().unique(),
  client: text("client").notNull(),
  phone: text("phone"),
  address: text("address"),
  model: text("model").notNull(),
  vin: text("vin").notNull(),
  blNo: text("bl_no"),
  saleDate: date("sale_date"),
  km: integer("km").notNull(),
  priority: text("priority").notNull().default("Normale"),
  description: text("description").notNull(),
  status: text("status").notNull().default("Nouveau"),
  data: jsonb("data").$type<Record<string, Record<string, string>>>().notNull(),
  productionDefect: boolean("production_defect").default(false).notNull(),
  closeReason: text("close_reason"),
  createdBy: integer("created_by").notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: ts(),
});

export const exceptionRequests = pgTable("exception_requests", {
  id: serial("id").primaryKey(),
  no: text("no").notNull().unique(),
  kind: text("kind").notNull(),
  docRef: text("doc_ref"),
  description: text("description").notNull(),
  justification: text("justification").notNull(),
  status: text("status").notNull().default("À valider"),
  requestedBy: integer("requested_by").notNull(),
  decidedBy: integer("decided_by"),
  decisionComment: text("decision_comment"),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: ts(),
});
