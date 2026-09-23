"use client";

import { useState, useTransition } from "react";
import { seDesabonner, seReabonner } from "@/app/desabonnement/actions";

// Formulaire de désabonnement public. Volontairement sans dépendance à
// l'interface de l'ERP : cette page est vue par des clients, pas par Keven.

export function DesabonnementForm({
  token,
  email,
  dejaDesabonne,
}: {
  token: string;
  email: string;
  dejaDesabonne: boolean;
}) {
  const [desabonne, setDesabonne] = useState(dejaDesabonne);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const bouton =
    "mt-4 inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors disabled:opacity-60";

  if (desabonne) {
    return (
      <div>
        <p className="mt-3 text-sm">
          <strong>{email}</strong> ne recevra plus nos infolettres.
        </p>
        {message && <p className="mt-2 text-sm text-emerald-600">{message}</p>}
        <p className="mt-3 text-sm text-muted-foreground">
          C&apos;était une erreur ? Vous pouvez revenir en un clic.
        </p>
        <button
          type="button"
          disabled={pending}
          className={`${bouton} border border-input hover:bg-muted`}
          onClick={() =>
            start(async () => {
              const r = await seReabonner(token);
              if (r.ok) {
                setDesabonne(false);
                setMessage(null);
              }
            })
          }
        >
          {pending ? "Un instant…" : "Me réabonner"}
        </button>
      </div>
    );
  }

  return (
    <div>
      <p className="mt-3 text-sm">
        Voulez-vous vous désabonner de nos infolettres avec l&apos;adresse{" "}
        <strong>{email}</strong> ?
      </p>
      <button
        type="button"
        disabled={pending}
        className={`${bouton} bg-primary text-primary-foreground hover:opacity-90`}
        onClick={() =>
          start(async () => {
            const r = await seDesabonner(token);
            if (r.ok) {
              setDesabonne(true);
              setMessage(
                r.dejaFait ? null : "Votre désabonnement a été enregistré.",
              );
            }
          })
        }
      >
        {pending ? "Un instant…" : "Confirmer mon désabonnement"}
      </button>
    </div>
  );
}
