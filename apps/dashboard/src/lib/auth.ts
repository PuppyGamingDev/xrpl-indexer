import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "./auth.config";
import { verifyOperator } from "./operators";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { username: {}, password: {} },
      authorize: async (creds) => {
        const op = await verifyOperator(String(creds?.username ?? ""), String(creds?.password ?? ""));
        return op ? { id: String(op.id), name: op.username } : null;
      },
    }),
  ],
});
