import { z } from "zod";

// Validation des variables d'environnement au démarrage (doc §8).
// Toute variable manquante ou invalide fait échouer le boot immédiatement.

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  DATABASE_URL: z
    .string()
    .startsWith("mysql://", "DATABASE_URL doit être une URL mysql://"),

  AUTH_SECRET: z.string().min(32, "AUTH_SECRET : 32 caractères minimum"),

  // JSON { "1": "<clé hex 64 caractères>" } — versions de clés AES-256-GCM
  ENCRYPTION_KEYS: z
    .string()
    .transform((raw, ctx) => {
      try {
        return JSON.parse(raw) as Record<string, string>;
      } catch {
        ctx.addIssue({ code: "custom", message: "ENCRYPTION_KEYS : JSON invalide" });
        return z.NEVER;
      }
    })
    .pipe(
      z.record(
        z.string().regex(/^\d+$/),
        z.string().regex(/^[0-9a-f]{64}$/i, "clé AES : 64 caractères hex (256 bits)"),
      ),
    ),

  // Version de clé utilisée pour les NOUVEAUX chiffrements
  ENCRYPTION_KEY_VERSION: z.coerce.number().int().positive().default(1),

  // Secret des endpoints /api/cron/* (Bearer)
  CRON_SECRET: z.string().min(32, "CRON_SECRET : 32 caractères minimum"),

  APP_URL: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "❌ Variables d'environnement invalides :",
    parsed.error.flatten().fieldErrors,
  );
  throw new Error("Configuration invalide — voir .env.example");
}

export const env = parsed.data;
