import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, auditLog } from "@/db/schema";
import { uploadFile } from "@/app/(app)/files-actions";
import { fdt } from "@/lib/core";
import { Back, Card, Table, inputCls } from "./ui";
import { Submit } from "./client";

export async function Attachments({ docType, docId, docNo, back, canUpload = true }: { docType: string; docId: number; docNo: string; back: string; canUpload?: boolean }) {
  const files = await db
    .select({ id: attachments.id, filename: attachments.filename, size: attachments.size, createdAt: attachments.createdAt })
    .from(attachments)
    .where(and(eq(attachments.docType, docType), eq(attachments.docId, docId)))
    .orderBy(desc(attachments.id));
  return (
    <Card title={`Pièces jointes (${files.length})`}>
      {files.length > 0 && (
        <ul className="mb-3 space-y-1 text-sm">
          {files.map((f) => (
            <li key={f.id}>
              📎 <a className="text-red-700 underline" href={`/api/files/${f.id}`} target="_blank">{f.filename}</a>{" "}
              <span className="text-xs text-slate-400">({Math.round(f.size / 1024)} Ko · {fdt(f.createdAt)})</span>
            </li>
          ))}
        </ul>
      )}
      {canUpload && (
        <form action={uploadFile} className="flex flex-wrap items-center gap-2">
          <Back to={back} />
          <input type="hidden" name="docType" value={docType} />
          <input type="hidden" name="docId" value={docId} />
          <input type="hidden" name="docNo" value={docNo} />
          <input type="file" name="file" required className={`${inputCls} max-w-xs`} />
          <Submit variant="secondary" small>Joindre</Submit>
        </form>
      )}
    </Card>
  );
}

export async function History({ docNo }: { docNo: string }) {
  const rows = await db.select().from(auditLog).where(eq(auditLog.docNo, docNo)).orderBy(desc(auditLog.id)).limit(100);
  return (
    <Card title="Historique">
      <Table
        cols={["Date/heure", "Utilisateur", "Action", "Ancien", "Nouveau", "Motif"]}
        rows={rows.map((r) => [fdt(r.createdAt), r.userName, r.action, <span key="o" className="text-xs text-slate-500">{r.oldValue}</span>, <span key="n" className="text-xs">{r.newValue}</span>, r.reason])}
        empty="Aucun historique."
      />
    </Card>
  );
}
