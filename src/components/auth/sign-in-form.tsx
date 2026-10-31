"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { safeNextPath } from "@/lib/safe-next-path";
import { signInSchema } from "@/lib/validation/auth";

import { FormField } from "./form-field";
import { useAuthForm } from "./use-auth-form";

export function SignInForm() {
  const { onSubmit, pending, error, fieldErrors } = useAuthForm({
    schema: signInSchema,
    submit: (data) => authClient.signIn.email(data),
    fallbackError: "Não foi possível entrar. Tente de novo.",
    // Read at submit time, so the form doesn't need the search params to render (static shell).
    redirectTo: () => safeNextPath(new URLSearchParams(window.location.search).get("next")),
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <FormField
        name="email"
        label="E-mail"
        type="email"
        autoComplete="email"
        inputMode="email"
        error={fieldErrors.email}
        required
      />
      <FormField
        name="password"
        label="Senha"
        type="password"
        autoComplete="current-password"
        error={fieldErrors.password}
        required
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Entrando…" : "Entrar"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Não tem conta?{" "}
        <Link href="/cadastro" className="text-foreground underline underline-offset-4">
          Criar conta
        </Link>
      </p>
    </form>
  );
}
