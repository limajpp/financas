"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { signUpSchema } from "@/lib/validation/auth";

import { FormField } from "./form-field";
import { useAuthForm } from "./use-auth-form";

export function SignUpForm() {
  const { onSubmit, pending, error, fieldErrors } = useAuthForm({
    schema: signUpSchema,
    submit: (data) => authClient.signUp.email(data),
    fallbackError: "Não foi possível criar a conta. Tente de novo.",
    redirectTo: () => "/",
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <FormField name="name" label="Nome" autoComplete="name" error={fieldErrors.name} required />
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
        autoComplete="new-password"
        error={fieldErrors.password}
        required
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Criando…" : "Criar conta"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Já tem conta?{" "}
        <Link href="/entrar" className="text-foreground underline underline-offset-4">
          Entrar
        </Link>
      </p>
    </form>
  );
}
