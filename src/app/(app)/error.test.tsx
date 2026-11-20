import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ScreenError from "./error";

describe("a tela de erro", () => {
  it("CA2: diz o que houve sem detalhe técnico, e tenta de novo ou volta ao início", () => {
    const retry = vi.fn();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ScreenError error={new Error("connection refused at db:5432")} retry={retry} />);
    expect(screen.getByRole("alert").textContent).toContain(
      "Algo deu errado ao carregar esta tela.",
    );
    expect(screen.queryByText(/5432/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "Ir para o início" }).getAttribute("href")).toBe("/");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
