# 04 — Deploy e CD: GitHub Actions → Vercel + Neon

Issue: #4 · Design: [Escolhas técnicas](../v1-design.md#escolhas-técnicas-decisão-do-claude-o-joão-valida)

## Objetivo

Todo PR ganha uma URL de preview funcionando (para testar no iPhone), e a `main` vai para produção só pelo GitHub Actions, com as migrations aplicadas antes do deploy.

## Comportamento

### Infra (uma vez)

- Projeto `financas` na Vercel ligado ao repo (`vercel link`), com o **deploy automático pela integração Git desligado** (`git.deploymentEnabled: false` no `vercel.json`). O único caminho até a Vercel é o GitHub Actions.
- **Neon pelo Vercel Marketplace** (plano free, região São Paulo), ligada **só ao ambiente Production** da Vercel. Preview e Development não recebem a URL do banco de produção: um preview sem banco explícito falha, em vez de escrever na produção.
- Funções na região `gru1` (São Paulo, junto do banco) e Node 24 no projeto, igual ao `.nvmrc`.
- **Proteção de deploy padrão** (`prod_deployment_urls_and_all_previews`): o domínio de produção fica público e os previews e URLs de deploy pedem login da Vercel. O padrão do projeto novo protegia também o domínio de produção, o que travaria o PWA no iPhone.
- **Variáveis na Vercel**, diferentes por ambiente:
  - `DATABASE_URL`: a URL com pooler, em runtime;
  - `DATABASE_URL_UNPOOLED`: a URL direta, usada pelas migrations (nome criado pela integração da Neon);
  - `BETTER_AUTH_SECRET`;
  - nenhum `BETTER_AUTH_URL`: a URL vem das variáveis de sistema da Vercel (`VERCEL_PROJECT_PRODUCTION_URL` em produção, `VERCEL_URL` no preview), numa função pura testada (`authUrls`).
- **Secrets no GitHub:** `VERCEL_TOKEN` e `NEON_API_KEY`. `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` e `NEON_PROJECT_ID` não são segredo e ficam como variables do repo.

### Código

- `prisma.config.ts`: as migrations usam `DATABASE_URL_UNPOOLED` quando existe (o pooler da Neon não serve para o `migrate`), e caem no `DATABASE_URL` no resto.
- `src/server/auth.ts`:
  - `baseURL` vem do `BETTER_AUTH_URL` ou, num preview, de `https://${VERCEL_URL}`;
  - **IP do rate limit**: o Better Auth lê o `x-forwarded-for`, que a Vercel sobrescreve com o IP real. Isso é conferido na produção (CA5); se não for verdade, configuro `advanced.ipAddress.ipAddressHeaders`.
- **Cadastro restrito:** `SIGNUP_ALLOWED_EMAILS` (lista separada por vírgula). Quando a variável está definida, só esses e-mails podem se cadastrar; os outros veem "Cadastro fechado.". Quando está vazia, o cadastro fica aberto (dev, testes, preview).
- `.env.example` documenta as variáveis novas.

### `deploy.yml`

Roda via `workflow_run` depois que o workflow `CI` termina com sucesso:

- **PR (preview):**
  - só para PRs do próprio repo; PR de fork não recebe secrets;
  - cria ou reaproveita a branch da Neon `preview/pr-<N>` (ações oficiais da Neon), do tipo **schema-only**, para o preview nunca receber dados da produção. Como uma branch schema-only não traz o histórico `_prisma_migrations`, ela é esvaziada uma vez, na criação, e recebe as migrations do zero;
  - roda `prisma migrate deploy` nela;
  - `vercel pull --environment=preview` → `vercel build` → `vercel deploy --prebuilt --env DATABASE_URL=<branch do PR>`;
  - comenta a URL no PR, num comentário único que é atualizado a cada push.
- **Push na `main` (produção):** só se o commit ainda for a ponta da `main` (um re-run de CI antigo não publica código velho) → `vercel build --prod` → `prisma migrate deploy` contra a branch principal da Neon → `vercel deploy --prebuilt --prod` → smoke test com `curl` no domínio de produção (`/` redireciona para `/entrar`, e `/entrar` responde 200). O build vem antes da migration: um build quebrado não deixa código antigo sobre o schema novo. Sem rollback automático: se o smoke test falhar, `vercel rollback`.
- **Segredos no log:** o repo e os logs do Actions são públicos. A senha do banco do preview é buscada na API da Neon e mascarada antes de qualquer saída; as URLs só passam entre os passos pelo `$GITHUB_ENV`, já mascaradas, e o `vercel deploy --env DATABASE_URL` lê o valor do ambiente. Nenhum segredo entra em `${{ }}` dentro de um script.
- **Concorrência:** o preview e a limpeza de um PR compartilham o grupo `preview-<branch>`, para um merge logo depois do CI não apagar a branch no meio do preview; se o PR já fechou quando o preview termina, o próprio preview apaga a branch.
- **Build:** recebe um `BETTER_AUTH_SECRET` descartável. O de verdade é uma variável sensível da Vercel, que o `vercel pull` não traz; a função lê o valor real em runtime.
- **PR fechado:** apaga a branch `preview/pr-<N>` da Neon (o plano free tem limite de branches).
- A versão da Vercel CLI fica fixada no workflow.

## Critérios de aceite

- [ ] CA1 — O **primeiro PR depois do merge desta task** recebe um comentário com a URL de preview, e nela dá para cadastrar e entrar (você confere no iPhone, logado na Vercel). O `workflow_run` só roda a partir do `deploy.yml` que está na branch padrão, então o PR desta task não consegue publicar o próprio preview.
- [ ] CA2 — Esse preview usa a branch `preview/pr-<N>` da Neon, só com schema; fechar o PR apaga a branch.
- [ ] CA3 — Depois do merge desta task e de uma release `develop → main`, a produção sobe com as migrations aplicadas e passa no smoke test; o cadastro com um e-mail da allowlist e o login funcionam. **Você cria a sua conta logo depois do primeiro deploy**: sem verificação de e-mail, quem souber um e-mail da lista (o seu aparece nos commits deste repo público) poderia se cadastrar com ele antes. A lista só recebe e-mails que vão se cadastrar em seguida.
- [ ] CA4 — Integração: com `SIGNUP_ALLOWED_EMAILS` definida, um e-mail fora da lista é recusado e um da lista passa (sem diferença de maiúsculas). Sem a variável, o cadastro fica aberto.
- [ ] CA5 — O rate limit em produção conta por IP real: um `x-forwarded-for` forjado não muda o balde (conferido com `curl` na produção, que é pública; os previews pedem login da Vercel). Se a Vercel não sobrescrever o header, configuro `advanced.ipAddress.ipAddressHeaders`.
- [ ] CA6 — Nenhum segredo commitado (GitGuardian verde); `.env.example` atualizado.
- [ ] CA7 — Um push direto na `main` sem CI verde não faz deploy (o `deploy.yml` só reage a CI com sucesso).

## Casos de borda

- PR de fork → nenhum job de preview roda.
- CI falhou → nada de deploy.
- Migration que falha → o deploy não acontece, e a produção continua na versão anterior.
- Push novo no mesmo PR → a branch da Neon é reaproveitada e só as migrations novas rodam.

## Decisões

- **`@prisma/adapter-pg` em produção também, em vez do `@prisma/adapter-neon`** (o design falava em adapter da Neon). Na Vercel com Fluid Compute as instâncias são reaproveitadas, então uma conexão TCP pelo pooler da Neon funciona bem. Com isso fica um adapter só, igual ao que os testes já usam. Se o cold start incomodar, trocamos depois.
- **Uma branch da Neon por PR**, em vez de uma branch de preview compartilhada: uma migration de um PR em aberto não quebra os previews dos outros. Branches schema-only são raiz, e o plano free da Neon tem 3 branches raiz contando a de produção: cabem dois previews ao mesmo tempo (ex.: o PR da task e o PR de release). A limpeza ao fechar o PR libera a vaga.
- **Migrations compatíveis com a versão anterior** (expand/contract): por alguns segundos, entre a migration e o deploy, o código antigo roda sobre o schema novo.
- **`workflow_run` em vez de juntar o deploy no `ci.yml`**: segue o plano de ter um `deploy.yml` separado. A trava contra fork evita rodar código de terceiros com os secrets.
- **Allowlist de cadastro:** o repo é público e o deploy também; sem a lista, qualquer pessoa poderia criar conta e gastar a cota da Neon.
- **Previews protegidos pelo login da Vercel**: você já está logado na Vercel no iPhone. A produção fica pública, com o cadastro fechado pela allowlist.

## O que preciso de você

1. Criar um token em vercel.com/account/tokens e um API key na Neon (depois que a integração existir). De preferência, um token da Vercel com expiração e uma API key da Neon com escopo de projeto, que não consegue apagar o projeto.
2. Confirmar a instalação da Neon pelo Marketplace, se a CLI pedir aceite de termos no navegador.
3. Me passar quais e-mails entram no `SIGNUP_ALLOWED_EMAILS` (eu configuro na Vercel; o valor não vai para o repo).

Eu rodo `vercel link`, `vercel integration add neon`, `vercel env add` e `gh secret set`. Você só cola os tokens, quando eu pedir, num comando `! ...` no próprio terminal, para eles não passarem pelo chat.

## Fora do escopo

- Domínio próprio.
- Cron e push (task 17); rotas `/api/cron` e `/api/sync` fora do proxy (tasks 16 e 17).
- Monitoramento e alertas.
