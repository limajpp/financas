import { z } from "zod";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "E-mail inválido." }));

export const signUpSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: "Informe seu nome." })
    .max(80, { error: "O nome pode ter no máximo 80 caracteres." }),
  email,
  password: z
    .string()
    .min(8, { error: "A senha precisa ter pelo menos 8 caracteres." })
    .max(128, { error: "A senha pode ter no máximo 128 caracteres." }),
});

export const signInSchema = z.object({
  email,
  password: z.string().min(1, { error: "Informe a senha." }),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
