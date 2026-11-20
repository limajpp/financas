"use client";

import { Share } from "lucide-react";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { INSTALL_HINT_KEY, shouldShowInstallHint } from "@/lib/install-hint";

const CHANGED = "install-hint-changed";

function readDismissedAt() {
  try {
    const value = Number(localStorage.getItem(INSTALL_HINT_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function visible() {
  return shouldShowInstallHint({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone:
      (navigator as Navigator & { standalone?: boolean }).standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches,
    dismissedAt: readDismissedAt(),
    now: Date.now(),
  });
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED, onChange);
  return () => window.removeEventListener(CHANGED, onChange);
}

/** On Safari for iPhone, outside the installed app: how to add it to the home screen. */
export function InstallHint() {
  const show = useSyncExternalStore(subscribe, visible, () => false);
  if (!show) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(INSTALL_HINT_KEY, String(Date.now()));
    } catch {
      // Private mode without storage: the card comes back next time.
    }
    window.dispatchEvent(new Event(CHANGED));
  };

  return (
    <section
      aria-labelledby="install-hint-title"
      className="mt-6 rounded-lg border bg-muted/40 p-4"
    >
      <h2 id="install-hint-title" className="font-medium">
        Instale o app
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Toque em Compartilhar{" "}
        <Share role="img" aria-label="(ícone de compartilhar)" className="inline size-4" /> e depois
        em Adicionar à Tela de Início. Ele abre em tela cheia, direto do ícone.
      </p>
      <Button variant="outline" size="sm" className="mt-3" onClick={dismiss}>
        Agora não
      </Button>
    </section>
  );
}
