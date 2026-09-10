"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Plus, UserPlus } from "lucide-react";
import { createClient } from "@/app/(dashboard)/clients/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <UserPlus className="h-4 w-4" />
      )}
      Créer le client
    </Button>
  );
}

// Bouton « Nouveau client » + fenêtre de saisie. Le client créé est uniquement
// côté ERP (aucun code ITCloud) : la synchronisation ITCloud ne le touche pas.
export function NewClientButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Nouveau client
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="w-full max-w-md rounded-lg border bg-background p-5 shadow-lg">
            <div className="mb-1 flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              <h3 className="text-lg font-semibold">Nouveau client</h3>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              Client créé <strong>uniquement dans l&apos;ERP</strong> — pas de
              lien ITCloud, la synchronisation ne le touchera pas.
            </p>

            <form action={createClient} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="nc-company">Nom de l&apos;entreprise *</Label>
                <Input id="nc-company" name="companyName" required autoFocus placeholder="ex. Boulangerie Tremblay inc." />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="nc-contact">Personne-ressource</Label>
                  <Input id="nc-contact" name="contactName" placeholder="ex. Marie Tremblay" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nc-phone">Téléphone</Label>
                  <Input id="nc-phone" name="phone" placeholder="ex. 418 555-1234" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="nc-email">Courriel</Label>
                <Input id="nc-email" name="email" type="email" placeholder="ex. info@entreprise.ca" />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="nc-payment">Mode de paiement</Label>
                  <select
                    id="nc-payment"
                    name="paymentMethod"
                    defaultValue=""
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  >
                    <option value="">—</option>
                    <option value="PREAUTORISE">Préautorisé</option>
                    <option value="CHEQUE">Chèque</option>
                    <option value="VIREMENT">Virement</option>
                    <option value="CARTE">Carte de crédit</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nc-billing">Type de facturation</Label>
                  <select
                    id="nc-billing"
                    name="billingType"
                    defaultValue=""
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  >
                    <option value="">—</option>
                    <option value="MENSUEL">Mensuel</option>
                    <option value="ANNUEL">Annuel</option>
                    <option value="MIXTE">Mixte</option>
                  </select>
                </div>
              </div>

              <div className="mt-5 flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Annuler
                </Button>
                <SubmitButton />
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
