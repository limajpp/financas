# 03 — Auth: Better Auth, espaço pessoal no cadastro e layout base

Issue: #3 · Design: [Escolhas técnicas](../v1-design.md#escolhas-técnicas-decisão-do-claude-o-joão-valida) · [Telas](../v1-design.md#telas)

## Objetivo

Só o dono vê os seus dados. Depois do cadastro, o usuário já entra no app com o espaço pessoal pronto, e todas as telas seguintes partem de `getCurrentSpace()`.

## Comportamento

### Auth

- **Better Auth 1.7** com e-mail e senha, sessões no banco (adapter Prisma, `transaction: true`) e o plugin `nextCookies()`, para a Server Action de sair limpar o cookie.
- **Rate limit** do Better Auth guardado no Postgres (tabela `RateLimit`; na Vercel a memória não é compartilhada entre instâncias): 5 tentativas por minuto, por IP, em `/sign-in/email` e `/sign-up/email`. Liga em produção; `AUTH_RATE_LIMIT=off` desliga (e2e) e `=on` força fora de produção (teste de integração).
- Tabelas novas no schema: `Session`, `AuthAccount`, `Verification` e `RateLimit`. O modelo `account` do Better Auth é mapeado para `AuthAccount`, porque `Account` vai ser a conta bancária (task 6). Migration `auth`.
- Os IDs continuam vindo do Prisma (`uuid(7)`): o Better Auth não gera IDs.
- Senha com 8 a 128 caracteres. E-mail sem diferença de maiúsculas e minúsculas, porque o Better Auth guarda em minúsculas.
- Rota `src/app/api/auth/[...all]/route.ts` (`toNextJsHandler`).
- Variáveis `BETTER_AUTH_SECRET` e `BETTER_AUTH_URL` no `.env.example`.

### Espaço pessoal

- **Restrição no banco:** `Space` ganha `personalOwnerId String? @unique`, ligado ao `User` com `onDelete: Cascade`. Um `CHECK` garante que `type = 'PERSONAL'` se e só se `personalOwnerId` está preenchido. Resultado: no máximo um espaço pessoal por usuário, e ele some junto com o usuário.
- **`ensurePersonalSpace(userId)`**, em `src/server/spaces.ts`, é idempotente. Cria o `Space` PERSONAL ("Pessoal") e o `SpaceMember` OWNER numa transação. Se já existir, devolve o que existe; uma corrida resolve pela restrição única.
- **No cadastro:** um hook `databaseHooks.user.create.after` chama `ensurePersonalSpace`.
- **`getCurrentSpace()`** também chama `ensurePersonalSpace` (veja Decisões). Depois, o usuário nunca fica sem espaço.

### Sessão no servidor (DAL)

- `src/server/session.ts`:
  - `getCurrentUser()` lê a sessão (`auth.api.getSession` com `headers()`) e redireciona para `/entrar` se não houver sessão. É memoizada por request com `cache` do React.
  - `getCurrentSpace()` devolve `{ id, type, role }` do espaço pessoal do usuário logado.
- Essa é a checagem de verdade. O `proxy.ts` faz só uma checagem otimista: se não há cookie de sessão (`getSessionCookie`), redireciona para `/entrar?next=<rota>`. Ele roda em todas as rotas, menos `/entrar`, `/cadastro`, `/api/auth/*` e os arquivos estáticos.
- Com o Cache Components ligado, tudo o que lê a sessão fica dentro de um `<Suspense>`. O shell do layout (navegação) é estático.

### Telas (pt-BR, mobile-first)

- **`/cadastro`:** nome, e-mail e senha. Erros em pt-BR, no campo e no geral, ex.: "Já existe uma conta com este e-mail". Depois de cadastrar, a sessão já está aberta e o usuário vai para `/`.
- **`/entrar`:** e-mail e senha. Erro genérico "E-mail ou senha incorretos". Depois de entrar, vai para `next`, se for um caminho interno, ou para `/`.
- Quem já está logado e abre `/entrar` ou `/cadastro` vai para `/`.
- Formulários client que validam com Zod (schemas em `src/lib/validation/auth.ts`) e chamam o client do Better Auth (`authClient.signUp/signIn.email` → `/api/auth/*`, onde roda o rate limit). O Better Auth revalida no servidor. Os erros dele são traduzidos para pt-BR. O botão fica desabilitado enquanto envia. O `next` é lido da URL na hora do envio.
- **Sair:** Server Action que encerra a sessão e leva para `/entrar`. Fica na sidebar (desktop) e em `/configuracoes` (mobile).

### Layout base (`src/app/(app)/layout.tsx`)

- **Mobile (< `md`, 768px):** barra inferior fixa com Início, Lançamentos, **+** (destaque, vai para `/registrar`), Contas e Ajustes. Respeita a `safe-area-inset-bottom` do iPhone.
- **Desktop (≥ `md`):** sidebar à esquerda com Dashboard, Lançamentos, Faturas, Assinaturas, Estabelecimentos, Contas e Configurações, mais o nome do usuário e o botão Sair.
- Item ativo destacado (`aria-current="page"`).
- **Páginas placeholder** (título + "Em breve"): `/`, `/registrar`, `/lancamentos`, `/faturas`, `/assinaturas`, `/estabelecimentos`, `/contas` e `/configuracoes`. A home mostra "Olá, {nome}" lido da sessão, para provar o fluxo de ponta a ponta.

### Testes e CI

- O job `e2e` do CI ganha o mesmo serviço Postgres, roda `prisma migrate deploy` antes do build e recebe `BETTER_AUTH_SECRET` (valor fixo de teste, só do CI). Os e2e usam e-mails únicos por execução (`e2e+<uuid>@example.com`).

## Critérios de aceite

- [ ] CA1 — Integração: cadastrar pelo `auth.api.signUpEmail` cria o usuário, o espaço PERSONAL com `personalOwnerId` e o membro OWNER.
- [ ] CA2 — Integração: `ensurePersonalSpace` chamado duas vezes (inclusive em paralelo) deixa um espaço só; o banco recusa um segundo espaço PERSONAL para o mesmo usuário e um PERSONAL sem dono.
- [ ] CA3 — Integração: apagar o usuário apaga o espaço pessoal e os vínculos.
- [ ] CA4b — Integração: pelo handler HTTP, a 6ª tentativa de login no mesmo minuto e do mesmo IP recebe 429, com o contador no Postgres; outro IP continua passando.
- [ ] CA4 — Unitário: schemas Zod de cadastro e login (e-mail inválido, senha curta ou longa, nome vazio) com mensagens em pt-BR; `safeNextPath` só aceita caminhos internos (recusa `//evil.com`, `https://…` e `/\evil`).
- [ ] CA5 — E2E: abrir `/lancamentos` sem sessão leva para `/entrar?next=%2Flancamentos`, e depois de entrar volta para `/lancamentos`.
- [ ] CA6 — E2E: cadastro → home com "Olá, {nome}" → sair → entrar de novo → home. Senha errada mostra "E-mail ou senha incorretos". E-mail repetido no cadastro mostra o erro em pt-BR.
- [ ] CA7 — E2E: no Chromium desktop a sidebar está visível e a barra inferior não; no iPhone (WebKit) é o contrário.
- [ ] CA8 — Lint, format, test, build, `test:e2e:docker` e CI verdes; fluxo conferido no navegador (desktop e viewport de iPhone).

## Casos de borda

- `next` malicioso (`//evil.com`, `https://evil.com`, `/\evil.com`) → vai para `/`.
- Cookie de sessão presente mas expirado ou inválido: o proxy deixa passar, `getCurrentUser()` redireciona para `/entrar`.
- Falha do hook depois do cadastro (ex.: banco caiu): o usuário existe sem espaço; o próximo `getCurrentSpace()` cria o espaço.
- Duplo clique no "Criar conta": o botão desabilita, e o Better Auth recusa o e-mail repetido.

## Decisões

- **Espaço criado logo depois do commit do cadastro, não na mesma transação** (a issue pedia a mesma transação). No Better Auth 1.7, o cadastro roda numa transação, mas os hooks `after` só disparam depois do commit (`queueAfterTransactionHook`). Os hooks `before` rodam antes de o usuário existir. Fazer o cadastro na mão, fora do Better Auth, para ter uma transação só, sairia mais frágil. Para o usuário dá no mesmo: a restrição no banco + `ensurePersonalSpace` idempotente + o reparo no `getCurrentSpace()` garantem que ninguém entra no app sem espaço.
- **`personalOwnerId` único + `CHECK`** em vez de regra só no código: o banco impede o segundo espaço pessoal mesmo numa corrida.
- **Client do Better Auth no login e no cadastro, em vez de Server Actions** (mudança aprovada pelo João durante a task). O rate limit do Better Auth só roda no handler HTTP (`/api/auth/*`), e chamadas `auth.api.*` de uma Server Action passam direto por ele, o que deixaria o login aberto a tentativa e erro de senha. Sair continua numa Server Action.
- **Rate limit no Postgres**: na Vercel cada instância tem a sua memória, então um contador em memória quase não limitaria. O IP vem do `x-forwarded-for`; na task 4, conferir que a Vercel sobrescreve esse header (senão o cliente forja o IP).
- **URLs em pt-BR** (`/entrar`, `/cadastro`, `/lancamentos`…): o usuário vê na barra do navegador e no PWA. Os identificadores no código continuam em inglês.
- **Proxy só otimista** (cookie), como a doc do Next 16 recomenda: ele roda em toda navegação e prefetch, então não consulta o banco. A segurança real fica no `getCurrentUser()`.
- **Mobile: Início, Lançamentos, +, Contas, Ajustes.** Faturas, Assinaturas e Estabelecimentos são telas de análise (web), e no celular ficam acessíveis por Ajustes até a task 25 redesenhar a home.
- **Visual simples** (shadcn padrão): a identidade visual é da task 26.

## Fora do escopo

- Recuperação de senha, verificação de e-mail e login social.
- Convite para espaço compartilhado e troca de espaço ativo (fase 2).
- Deploy e variáveis na Vercel (task 4).
- Conteúdo real das telas (tasks seguintes).
