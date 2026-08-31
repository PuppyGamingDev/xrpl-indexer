import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

// Edge-safe instance — no DB, only the `authorized` callback runs here.
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/admin/:path*"],
};
