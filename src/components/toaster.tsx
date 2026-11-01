"use client";

import { Toaster as Sonner } from "sonner";

/**
 * The discreet confirmations ("Despesa de R$ 47,90 salva · Desfazer"). At the top: at the bottom
 * they would cover the register screen's Save button.
 */
export function Toaster() {
  return (
    <Sonner
      theme="system"
      position="top-center"
      mobileOffset={{ top: "calc(1rem + env(safe-area-inset-top))" }}
      toastOptions={{ className: "font-sans" }}
    />
  );
}
