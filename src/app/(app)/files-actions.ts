"use server";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { requirePerm } from "@/lib/auth";
import { act, audit, getSettings, id, str } from "@/lib/core";

export async function uploadFile(fd: FormData) {
  await act(fd, async () => {
    const u = await requirePerm();
    const docType = str(fd, "docType", "Type");
    const docId = id(fd, "docId");
    const docNo = str(fd, "docNo");
    const f = fd.get("file");
    if (!(f instanceof File) || f.size === 0) throw new Error("Veuillez sélectionner un fichier.");
    const s = await getSettings();
    const maxMb = Number(s.max_file_mb) || 10;
    if (f.size > maxMb * 1024 * 1024) throw new Error(`Fichier trop volumineux (max ${maxMb} Mo).`);
    const ext = (f.name.split(".").pop() ?? "").toLowerCase();
    const allowed = s.allowed_ext.split(",").map((x) => x.trim().toLowerCase());
    if (!allowed.includes(ext)) throw new Error(`Format non autorisé. Formats acceptés : ${allowed.join(", ")}.`);
    const buf = Buffer.from(await f.arrayBuffer());
    await db.insert(attachments).values({ docType, docId, filename: f.name, mime: f.type || "application/octet-stream", size: f.size, data: buf.toString("base64"), userId: u.id });
    await audit(db, u, docType, docNo || null, "Pièce jointe ajoutée", { new: f.name });
    return `Pièce jointe « ${f.name} » ajoutée.`;
  });
}
