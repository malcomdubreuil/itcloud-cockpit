"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Bot,
  Calendar,
  FileText,
  LayoutDashboard,
  Package,
  Receipt,
  RefreshCw,
  Search,
  Settings,
  Shield,
  Users,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Sidebar (doc §10) — l'ordre suit le document d'architecture.
const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/produits", label: "Produits", icon: Package },
  { href: "/services", label: "Services", icon: Wrench },
  { href: "/facturation", label: "Facturation", icon: Receipt },
  { href: "/rapports", label: "Rapports", icon: FileText },
  { href: "/calendrier", label: "Calendrier", icon: Calendar },
  { href: "/alertes", label: "Alertes", icon: Bell },
  { href: "/recherche", label: "Recherche", icon: Search },
  { href: "/synchronisation", label: "Synchronisation", icon: RefreshCw },
  { href: "/ia", label: "Assistant IA", icon: Bot },
  { href: "/administration", label: "Administration", icon: Shield },
  { href: "/parametres", label: "Paramètres", icon: Settings },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 p-2">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
