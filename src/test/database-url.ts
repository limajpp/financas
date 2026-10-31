// Guards every destructive test helper: it only ever touches a database named *_test.
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL não está definida. Copie o .env.example para .env e suba o banco com `npm run db:up`.",
    );
  }
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith("_test")) {
    throw new Error(
      `TEST_DATABASE_URL aponta para o banco "${name}". O nome precisa terminar em _test, porque os testes apagam tudo nele.`,
    );
  }
  return url;
}
