"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { z } from "zod";

import { authErrorMessage } from "./auth-error-message";

type FieldErrors = Record<string, string | undefined>;

/**
 * Validates with Zod in the browser, calls Better Auth and navigates on success.
 * Better Auth validates again on the server.
 */
export function useAuthForm<Schema extends z.ZodType<Record<string, string>>>(options: {
  schema: Schema;
  submit: (data: z.output<Schema>) => Promise<{ error: { code?: string; status?: number } | null }>;
  fallbackError: string;
  redirectTo: () => string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(undefined);

    const parsed = options.schema.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    setPending(true);
    try {
      const { error: authError } = await options.submit(parsed.data);
      if (authError) {
        setError(authErrorMessage(authError, options.fallbackError));
        setPending(false);
        return;
      }
    } catch {
      setError(options.fallbackError);
      setPending(false);
      return;
    }
    // Keeps the button disabled until the next page takes over.
    router.replace(options.redirectTo());
    router.refresh();
  }

  return { onSubmit, pending, error, fieldErrors };
}
