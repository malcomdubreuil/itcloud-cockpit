"use client";

import { useState, useTransition } from "react";
import { Download, Loader2, Plus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ajouterContact, importerDepuisClients } from "@/app/(dashboard)/diffusion/actions";
import { cn } from "@/lib/utils";

// Outils de la liste : importer les courriels déjà inscrits sur les fiches
// clients, et ajouter un contact à la main (un client peut en avoir plusieurs).

const champ =
  "h-8 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none";

export type ClientOption = { id: string; name: string };

export function DiffusionOutils({ clients }: { clients: ClientOption[] }) {
  const [ouvert, setOuvert] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [clientId, setClientId] = useState("");
  const [pending, start] = useTransition();

  const importer = () =>
    start(async () => {
      try {
        const r = await importerDepuisClients();
        toast.success(
          `${r.crees} contact${r.crees > 1 ? "s" : ""} importé${r.crees > 1 ? "s" : ""} · ${r.ignores} déjà présent${r.ignores > 1 ? "s" : ""} · ${r.invalides} adresse${r.invalides > 1 ? "s" : ""} inutilisable${r.invalides > 1 ? "s" : ""}`,
          { duration: 10000 },
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Échec de l'import");
      }
    });

  const ajouter = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("email", email);
      fd.set("name", name);
      fd.set("role", role);
      fd.set("clientId", clientId);
      try {
        await ajouterContact(fd);
        toast.success(`${email} ajouté à la liste.`);
        setEmail("");
        setName("");
        setRole("");
        setOuvert(false);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Échec de l'ajout");
      }
    });

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={pending} onClick={importer}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Importer les courriels des fiches clients
        </Button>
        <Button size="sm" onClick={() => setOuvert((v) => !v)}>
          <Plus className="h-3.5 w-3.5" /> Ajouter un contact
        </Button>
      </div>

      {ouvert && (
        <div className="w-full space-y-2 rounded-md border bg-muted/40 p-3">
          <p className="text-sm font-medium">Nouveau contact</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={cn(champ, "min-w-0 flex-1 basis-56")}
              placeholder="courriel@entreprise.ca"
              value={email}
              disabled={pending}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Courriel"
            />
            <input
              className={cn(champ, "min-w-0 flex-1 basis-40")}
              placeholder="Nom (optionnel)"
              value={name}
              disabled={pending}
              onChange={(e) => setName(e.target.value)}
              aria-label="Nom"
            />
            <input
              className={cn(champ, "w-40")}
              placeholder="Rôle — ex. Comptabilité"
              value={role}
              disabled={pending}
              onChange={(e) => setRole(e.target.value)}
              aria-label="Rôle"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className={cn(champ, "min-w-0 flex-1 basis-56")}
              value={clientId}
              disabled={pending}
              onChange={(e) => setClientId(e.target.value)}
              aria-label="Client rattaché"
            >
              <option value="">— aucun client (abonné libre) —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <Button size="sm" onClick={ajouter} disabled={pending}>
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <UserPlus className="h-3.5 w-3.5" /> Ajouter
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOuvert(false)} disabled={pending}>
              Annuler
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Rattacher un client permet de cibler ce contact par ses produits
            (hébergement, antivirus, Microsoft 365…).
          </p>
        </div>
      )}
    </div>
  );
}
