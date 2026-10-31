import { describe, expect, it } from "vitest";

import { authErrorMessage } from "./auth-error-message";

describe("authErrorMessage", () => {
  it.each([
    [{ code: "INVALID_EMAIL_OR_PASSWORD", status: 401 }, "E-mail ou senha incorretos."],
    [
      { code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", status: 422 },
      "Já existe uma conta com este e-mail.",
    ],
    [{ code: "USER_ALREADY_EXISTS", status: 422 }, "Já existe uma conta com este e-mail."],
    [{ status: 429 }, "Muitas tentativas. Espere um minuto e tente de novo."],
    [{ code: "PASSWORD_TOO_SHORT", status: 400 }, "A senha precisa ter pelo menos 8 caracteres."],
  ])("traduz %o", (error, message) => {
    expect(authErrorMessage(error, "fallback")).toBe(message);
  });

  it("usa o texto de reserva para erros desconhecidos", () => {
    expect(authErrorMessage({ code: "ALGO", status: 500 }, "Tente de novo.")).toBe(
      "Tente de novo.",
    );
  });
});
