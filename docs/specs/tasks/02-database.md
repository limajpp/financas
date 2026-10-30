# 02 — Banco: Postgres local, Prisma 7 e schema inicial

Issue: #2 · Design: [Modelo de dados](../v1-design.md#modelo-de-dados-v1-preparado-para-a-fase-2) · [Escolhas técnicas](../v1-design.md#escolhas-técnicas-decisão-do-claude-o-joão-valida)

## Objetivo

Ter um Postgres local (dev e testes) com Prisma 7 e o schema base `User`, `Space` e `SpaceMember`, mais a infraestrutura de testes de integração que as próximas tasks vão usar.

## Comportamento

- **`docker-compose.yml`** com um serviço `postgres` (imagem `postgres:18-alpine`), volume nomeado e healthcheck. Porta do host **5433** (a 5432 costuma estar ocupada por outros projetos). Um script em `docker/postgres/init.sql` cria dois bancos no mesmo container: `financas` (dev) e `financas_test` (testes).
- **Prisma 7** (`prisma@7`, `@prisma/client@7`, `@prisma/adapter-pg@7`, `pg`):
  - `prisma.config.ts` na raiz (schema, pasta de migrations, `DATABASE_URL` via `dotenv`).
  - `prisma/schema.prisma` com o generator `prisma-client` gerando em `src/generated/prisma` (no `.gitignore`).
  - `postinstall: prisma generate`, para o client existir no CI e na Vercel.
- **`src/lib/db.ts`**: singleton do `PrismaClient` com `PrismaPg`, guardado em `globalThis` em dev (o hot reload não abre conexões novas a cada edição). Só importável no servidor (`server-only`).
- **Modelos:**
  - `User`: `id`, `name`, `email` (único), `emailVerified`, `image?`, `createdAt`, `updatedAt`. São os campos do usuário do Better Auth, para a task 3 só acrescentar as tabelas de sessão.
  - `Space`: `id`, `type` (`PERSONAL` | `SHARED`), `name`, `createdAt`, `updatedAt`.
  - `SpaceMember`: `id`, `spaceId`, `userId`, `role` (`OWNER` | `MEMBER`), `createdAt`; `@@unique([spaceId, userId])`; apagar o `User` ou o `Space` apaga os vínculos (`onDelete: Cascade`).
  - IDs `String` com `@default(uuid(7))`.
- **Primeira migration** `init` em `prisma/migrations/`.
- **Testes de integração:** projeto `integration` no Vitest para `src/**/*.int.test.ts` (ambiente `node`, arquivos em série). Um `globalSetup` roda `prisma migrate deploy` no banco de `TEST_DATABASE_URL` (aplica as migrations pendentes), e um `setupFile` aponta `DATABASE_URL` para ele em cada worker. O helper `src/test/db.ts` exporta `resetDatabase()`, que faz `TRUNCATE ... CASCADE` em todas as tabelas do schema (menos `_prisma_migrations`), para cada teste começar do zero.
- **Scripts:** `db:up` (`docker compose up -d --wait`), `db:migrate` (`prisma migrate dev`), `db:studio`. `npm test` passa a rodar também os testes de integração, então precisa do banco de pé.
- **`.env.example`** com `DATABASE_URL` e `TEST_DATABASE_URL` apontando para a porta 5433.
- **CI:** o job `check` ganha um serviço `postgres:18-alpine` com `financas_test`, e as variáveis de ambiente apontam para ele. O job `e2e` não precisa do banco ainda.
- README: como subir o banco e rodar as migrations.

## Critérios de aceite

- [ ] CA1 — `docker compose up -d && npx prisma migrate dev` num volume limpo cria o schema do zero (conferido com `docker compose down -v` antes).
- [ ] CA2 — Teste de integração cria um usuário, um espaço `PERSONAL` e o `SpaceMember` `OWNER`, e lê de volta com as relações.
- [ ] CA3 — Teste de integração: criar um segundo `SpaceMember` com o mesmo `spaceId+userId` falha com erro de restrição única (`P2002`).
- [ ] CA4 — Teste de integração: apagar o usuário apaga os seus `SpaceMember`.
- [ ] CA5 — `resetDatabase()` deixa as tabelas vazias (os testes não dependem da ordem).
- [ ] CA6 — O CI roda os testes de integração contra o Postgres de serviço e passa no PR.
- [ ] CA7 — `npm run lint`, `format:check`, `test`, `build` e `test:e2e:docker` verdes localmente.

## Casos de borda

- `TEST_DATABASE_URL` ausente: o setup falha com mensagem clara em pt-BR, em vez de cair no banco de dev.
- O setup e o `resetDatabase()` recusam rodar se o nome do banco não terminar em `_test` (proteção contra apagar o banco de dev por engano).

## Decisões

- **Um container, dois bancos** (em vez de dois serviços): menos memória e uma porta só; o isolamento por banco basta.
- **Sem senha no Postgres local e no CI** (`POSTGRES_HOST_AUTH_METHOD: trust`, porta presa ao `127.0.0.1`): uma senha fixa no repo, mesmo de mentira, dispara o GitGuardian, e ela não protegeria nada num banco só local.
- **Porta 5433**: evita conflito com outro Postgres na 5432 desta máquina. Dá para trocar no `.env`.
- **`@prisma/adapter-pg`** agora; na task 4 decidimos se a produção usa ele com a Neon ou o `@prisma/adapter-neon`.
- **`uuid(7)`**: ordenável por tempo e gerado pelo Prisma, sem depender de extensão do Postgres.
- **`migrate deploy` em vez de `migrate reset`** no setup dos testes: o Prisma 7 bloqueia o `reset` quando é chamado por um agente de IA, e não precisamos dele, porque o `resetDatabase()` já limpa os dados. Se uma migration for editada antes do merge, rode `npx prisma migrate reset` no banco de testes à mão.
- **Testes de integração dentro do `npm test`**: um comando só, igual no CI e local. Custo: precisa do `npm run db:up` antes.
- **Aviso para a task 3**: o Better Auth tem uma tabela chamada `account` (contas de login), que colide com o nosso `Account` (conta bancária, task 6). Na task 3 o modelo do Better Auth vai ser renomeado (`AuthAccount`).

## Fora do escopo

- Tabelas de sessão/verificação do Better Auth e a criação automática do espaço pessoal no cadastro (task 3).
- Neon, produção e migrations no deploy (task 4).
- Regra "um único espaço pessoal por usuário" (task 3, junto com o cadastro).
