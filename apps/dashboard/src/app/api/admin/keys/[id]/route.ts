import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { auth } from "@/lib/auth";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  await api(`/admin/keys/${id}/revoke`, { admin: true, method: "POST" });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json()) as { scopes?: string[]; rateLimit?: number };
  await api(`/admin/keys/${id}`, { admin: true, method: "PATCH", body });
  return NextResponse.json({ ok: true });
}
