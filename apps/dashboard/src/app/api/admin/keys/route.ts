import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await api("/admin/keys", { admin: true, revalidate: 0 }));
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json()) as { label?: string; scopes?: string[]; rateLimit?: number };
  if (!body.label || !Array.isArray(body.scopes)) {
    return NextResponse.json({ error: "label and scopes[] required" }, { status: 400 });
  }
  const result = await api("/admin/keys", {
    admin: true,
    method: "POST",
    body: { label: body.label, scopes: body.scopes, rateLimit: body.rateLimit ?? 120 },
  });
  return NextResponse.json(result);
}
