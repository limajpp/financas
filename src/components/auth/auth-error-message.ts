type AuthClientError = { code?: string; status?: number };

/** Turns a Better Auth client error into a message in Portuguese. */
export function authErrorMessage(error: AuthClientError, fallback: string): string {
  if (error.status === 429) return "Muitas tentativas. Espere um minuto e tente de novo.";
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "E-mail ou senha incorretos.";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "Já existe uma conta com este e-mail.";
    case "SIGNUP_CLOSED":
      return "Cadastro fechado.";
    case "PASSWORD_TOO_SHORT":
      return "A senha precisa ter pelo menos 8 caracteres.";
    case "PASSWORD_TOO_LONG":
      return "A senha pode ter no máximo 128 caracteres.";
    default:
      return fallback;
  }
}
