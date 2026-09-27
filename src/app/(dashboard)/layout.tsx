import { redirect } from "next/navigation";
import Image from "next/image";
import { LogOut } from "lucide-react";
import { auth, signOut } from "@/auth";
import { SidebarNav } from "@/components/sidebar-nav";
import { DivisionSwitch } from "@/components/division-switch";
import { DIVISIONS, currentDivision } from "@/lib/division";
import { ThemeToggle } from "@/components/theme-toggle";
import { PleinEcran } from "@/components/plein-ecran";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const division = await currentDivision();

  return (
    <div className="flex min-h-screen">
      <aside
        data-masquer-plein-ecran
        className="hidden w-60 shrink-0 flex-col border-r bg-background md:flex"
      >
        <div className="flex h-20 items-center px-3">
          {/* Deux fichiers plutot qu'un filtre CSS : le texte du logo est NOIR,
              donc invisible sur la barre en mode sombre. La variante claire
              n'eclaircit que les gris et le noir — les bleus de la marque
              restent exacts.

              Version COMPACTE ici (sans la baseline « Solutions
              informatiques ») : a 36 px de haut dans une barre de 240 px, la
              baseline du logo complet n'est plus qu'une bouillie de pixels.
              Le logo entier reste sur la page de connexion, ou il a la place
              d'etre lu. */}
          <Image
            src="/logo-god-info-compact.png"
            alt="God-Info — Solutions informatiques"
            width={760}
            height={251}
            priority
            className="h-14 w-auto dark:hidden"
          />
          <Image
            src="/logo-god-info-compact-sombre.png"
            alt=""
            aria-hidden
            width={760}
            height={251}
            priority
            className="hidden h-14 w-auto dark:block"
          />
        </div>
        <Separator />
        <DivisionSwitch current={division} divisions={DIVISIONS} />
        <Separator />
        <div className="flex-1 overflow-y-auto">
          <SidebarNav division={division} />
        </div>
        <Separator />
        <div className="p-3">
          <p className="truncate text-sm font-medium">{session.user.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {session.user.roleName}
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-20 items-center justify-end gap-2 border-b px-4">
          <PleinEcran />
          <ThemeToggle />
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <Button variant="ghost" size="icon" aria-label="Se déconnecter">
              <LogOut className="h-5 w-5" />
            </Button>
          </form>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
