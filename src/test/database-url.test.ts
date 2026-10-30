import { afterEach, describe, expect, it, vi } from "vitest";

import { testDatabaseUrl } from "./database-url";

afterEach(() => vi.unstubAllEnvs());

describe("testDatabaseUrl", () => {
  it("devolve a URL quando o banco termina em _test", () => {
    vi.stubEnv("TEST_DATABASE_URL", "postgresql://u:p@localhost:5433/financas_test");
    expect(testDatabaseUrl()).toBe("postgresql://u:p@localhost:5433/financas_test");
  });

  it("falha com mensagem clara quando a variável não existe", () => {
    vi.stubEnv("TEST_DATABASE_URL", "");
    expect(() => testDatabaseUrl()).toThrow(/TEST_DATABASE_URL não está definida/);
  });

  it("recusa um banco que não termina em _test", () => {
    vi.stubEnv("TEST_DATABASE_URL", "postgresql://u:p@localhost:5433/financas");
    expect(() => testDatabaseUrl()).toThrow(/precisa terminar em _test/);
  });

  it("recusa _test só nos parâmetros da URL", () => {
    vi.stubEnv("TEST_DATABASE_URL", "postgresql://u:p@localhost:5433/financas?app=x_test");
    expect(() => testDatabaseUrl()).toThrow(/precisa terminar em _test/);
  });
});
