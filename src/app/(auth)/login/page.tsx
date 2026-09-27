"use client";

import { useActionState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <Image
            src="/logo-god-info-compact.png"
            alt="God-Info — Solutions informatiques"
            width={760}
            height={251}
            priority
            className="mb-3 h-16 w-auto dark:hidden"
          />
          <Image
            src="/logo-god-info-compact-sombre.png"
            alt=""
            aria-hidden
            width={760}
            height={251}
            priority
            className="mb-3 hidden h-16 w-auto dark:block"
          />
          <CardTitle className="text-xl">Cockpit</CardTitle>
          <CardDescription>Connecte-toi à ton espace de gestion</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Courriel</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="toi@entreprise.ca"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Mot de passe</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            {state.mfaRequired && (
              <div className="space-y-2">
                <Label htmlFor="totp">Code d&apos;authentification (MFA)</Label>
                <Input
                  id="totp"
                  name="totp"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="123456"
                  autoComplete="one-time-code"
                />
              </div>
            )}
            {state.error && (
              <p className="text-sm text-destructive" role="alert">
                {state.error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Connexion…" : "Se connecter"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
