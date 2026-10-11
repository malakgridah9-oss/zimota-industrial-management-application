import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return new Response("Non autorisé", { status: 401 });
  const { id } = await ctx.params;
  const f = (await db.select().from(attachments).where(eq(attachments.id, Number(id))).limit(1))[0];
  if (!f) return new Response("Introuvable", { status: 404 });
  return new Response(Buffer.from(f.data, "base64"), {
    headers: { "Content-Type": f.mime, "Content-Disposition": `inline; filename="${encodeURIComponent(f.filename)}"` },
  });
}
