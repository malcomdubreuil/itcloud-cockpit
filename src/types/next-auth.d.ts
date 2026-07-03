import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    tenantId: string;
    roleId: string;
    roleName: string;
    permissions: string[];
  }

  interface Session {
    user: {
      id: string;
      tenantId: string;
      roleId: string;
      roleName: string;
      permissions: string[];
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    tenantId: string;
    roleId: string;
    roleName: string;
    permissions: string[];
  }
}
