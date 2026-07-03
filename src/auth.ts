import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import { z } from "zod";
import { authConfig } from "@/auth.config";
import { prisma } from "@/infrastructure/db/prisma";
import { audit } from "@/infrastructure/db/audit";
import { decrypt } from "@/infrastructure/crypto/aes";

class InvalidCredentialsError extends CredentialsSignin {
  code = "identifiants_invalides";
}
class MfaRequiredError extends CredentialsSignin {
  code = "mfa_requise";
}
class MfaInvalidError extends CredentialsSignin {
  code = "mfa_invalide";
}

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
  totp: z.string().optional(),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: {},
        password: {},
        totp: {},
      },
      async authorize(raw) {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) throw new InvalidCredentialsError();
        const { email, password, totp } = parsed.data;

        const user = await prisma.user.findUnique({
          where: { email },
          include: { role: true },
        });

        if (!user || user.deletedAt) {
          // bcrypt factice : temps de réponse constant, pas d'énumération d'emails
          await bcrypt.compare(password, "$2b$12$invalidsaltinvalidsaltinvalidsaltinvalidsalt");
          throw new InvalidCredentialsError();
        }

        const passwordOk = await bcrypt.compare(password, user.passwordHash);
        if (!passwordOk) {
          await audit({
            tenantId: user.tenantId,
            userId: user.id,
            action: "auth.login_failed",
          });
          throw new InvalidCredentialsError();
        }

        if (user.mfaEnabled && user.mfaSecretEnc) {
          if (!totp) throw new MfaRequiredError();
          const secret = decrypt(user.mfaSecretEnc);
          if (!authenticator.check(totp, secret)) {
            await audit({
              tenantId: user.tenantId,
              userId: user.id,
              action: "auth.mfa_failed",
            });
            throw new MfaInvalidError();
          }
        }

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });
        await audit({
          tenantId: user.tenantId,
          userId: user.id,
          action: "auth.login",
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          tenantId: user.tenantId,
          roleId: user.roleId,
          roleName: user.role.name,
          permissions: (user.role.permissions as string[]) ?? [],
        };
      },
    }),
  ],
});
