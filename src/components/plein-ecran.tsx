"use client";

import { useCallback, useEffect, useState } from "react";
import { Maximize, Minimize } from "lucide-react";
import { Button } from "@/components/ui/button";

// Plein écran, depuis n'importe quelle page de l'ERP.
//
// C'est l'API Fullscreen du navigateur — le même résultat que F11, mais
// déclenché par un bouton. Deux différences avec F11 qui valent d'être
// sues : le navigateur EXIGE un geste de l'utilisateur (on ne peut pas le
// déclencher au chargement), et l'état peut changer sans passer par ce bouton
// (touche Échap, F11, ou une autre page). D'où l'écoute de
// `fullscreenchange` : l'icône suit l'état réel plutôt qu'un état supposé.

type ElementPrefixe = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};
type DocumentPrefixe = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

function estPleinEcran(): boolean {
  const d = document as DocumentPrefixe;
  return !!(d.fullscreenElement ?? d.webkitFullscreenElement);
}

export function PleinEcran() {
  const [actif, setActif] = useState(false);
  // Tant que le composant n'est pas monté, on ne sait rien de l'état réel :
  // afficher une icône au hasard donnerait un clignotement à l'hydratation.
  const [monte, setMonte] = useState(false);

  useEffect(() => {
    setMonte(true);
    setActif(estPleinEcran());
    const suivre = () => setActif(estPleinEcran());
    document.addEventListener("fullscreenchange", suivre);
    document.addEventListener("webkitfullscreenchange", suivre);
    return () => {
      document.removeEventListener("fullscreenchange", suivre);
      document.removeEventListener("webkitfullscreenchange", suivre);
    };
  }, []);

  const basculer = useCallback(async () => {
    const d = document as DocumentPrefixe;
    try {
      if (estPleinEcran()) {
        await (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
      } else {
        const el = document.documentElement as ElementPrefixe;
        await (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
      }
    } catch {
      // Refus possible : navigateur en mode restreint, ou politique de
      // permissions dans une iframe. Rien à faire de plus — l'écouteur
      // remettra l'icône dans le bon état de toute façon.
    }
  }, []);

  if (!monte) {
    // Réserve la place pour éviter que la barre ne saute au montage.
    return <div className="size-9" aria-hidden />;
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={actif ? "Quitter le plein écran" : "Passer en plein écran"}
      title={
        actif
          ? "Quitter le plein écran (Échap)"
          : "Plein écran — comme F11, sur la page courante"
      }
      aria-pressed={actif}
      onClick={basculer}
    >
      {actif ? (
        <Minimize className="h-5 w-5" />
      ) : (
        <Maximize className="h-5 w-5" />
      )}
    </Button>
  );
}
