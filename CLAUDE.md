# CLAUDE.md

App de finanças pessoais: web (análise) + PWA no iPhone (registro rápido). O Claude escreve o código e faz o merge quando o revisor aprova e o CI fica verde; o João acompanha pelos PRs.

**Fonte da verdade:** `docs/specs/v1-design.md`. O processo está em `docs/specs/README.md`.

@AGENTS.md

O Next 16 traz a documentação da versão instalada em `node_modules/next/dist/docs/`. Consulte-a antes de usar uma API do Next (ex.: `cacheComponents` vem ligado por padrão).

## Stack

- Next.js 16 (App Router) + TypeScript strict. Mutations em Server Actions; `/api/sync` (Route Handler) para a fila offline.
- Postgres: Docker Compose local (dev/testes), Neon em produção. **Prisma 7, sempre instalado com `@7`** (`prisma@7`, `@prisma/client@7`, adapters `@7`): a tag `latest` aponta para o Prisma 8 RC.
- Better Auth (e-mail/senha). Tailwind + shadcn/ui. Recharts (seguir a skill `dataviz`).
- Serwist (service worker), Dexie (fila offline), `web-push` + Vercel Cron.
- Zod, Vitest, Playwright. CI/CD no GitHub Actions: `ci.yml` (lint, testes, build, e2e) em todo PR; `deploy.yml` (migrations + Vercel) depois do CI.

## Convenções

- **Dinheiro em centavos** (`Int`, `amountCents`). Nunca `float`. Formatação só na borda (UI), com `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`.
- **Datas:** fuso `America/Sao_Paulo`. Datas de competência (`date`, `invoiceDueDate`) são dias de calendário, não instantes.
- **pt-BR** em toda a UI, mensagens de erro e docs. Código (identificadores) em inglês.
- **Regras de domínio em funções puras** (sem Prisma, sem I/O), com testes Vitest. A UI e as actions só chamam essas funções.
- Todo dado pertence a um `spaceId`. Toda query filtra pelo espaço do usuário logado.
- Validação de entrada com Zod nas actions e no `/api/sync`.

## Regras do repositório

- **Nenhum dado financeiro real no repo**: nem em seeds, fixtures, testes, screenshots ou issues. Use nomes e valores inventados.
- Nada de segredos: `.env*` está no `.gitignore`; documente variáveis em `.env.example`.
- **Commits em inglês, com gitmoji + prefixo convencional**: `<gitmoji> <type>(<scope>)?: <description>`, ex.: `✨ feat(cards): add invoice cycle module`. Tipos: `feat fix docs style refactor perf test build ci chore revert`. O hook `.githooks/commit-msg` barra o que fugir disso (ativado com `git config core.hooksPath .githooks`, que o `npm install` faz via `prepare`). Títulos de PR seguem o mesmo formato, porque viram o commit do squash.
- Commits pequenos. Docs e UI continuam em pt-BR; só as mensagens de commit e os títulos de PR são em inglês.

## Branches

- `main`: só recebe releases vindas da `develop` (PR `develop → main`, quando o João decidir). Push na `main` = deploy de produção.
- `develop`: branch padrão e de integração. Toda task sai dela e volta para ela por PR (squash merge).
- `task/NN-slug`: uma por issue, criada a partir da `develop` atualizada. É apagada depois do merge (o repo apaga a branch remota sozinho; a local eu apago com `git branch -d`).

## Fluxo de cada task

1. Issue da milestone v1 → spec em `docs/specs/tasks/NN-slug.md` → **aprovação do João no chat antes de codar**.
2. `git switch develop && git pull`, depois `git switch -c task/NN-slug`. TDD: testes dos critérios de aceite primeiro.
3. `npm run lint && npm run format:check && npm test && npm run build` e `npm run test:e2e:docker` verdes (o WebKit não roda direto no Fedora desta máquina). UI: conferir no navegador.
4. Subagente revisor (Opus, effort high) com a spec + `git diff develop...HEAD`. Corrigir o que proceder; registrar o que foi descartado e por quê.
5. PR **para a `develop`** com `Closes #N`, critérios marcados e resumo da revisão. **Se o revisor aprovou (sem bloqueios pendentes) e o CI está verde, eu faço o squash merge.** Depois do merge, apagar a branch local e atualizar a `develop`.
