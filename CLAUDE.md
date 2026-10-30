# CLAUDE.md

App de finanças pessoais: web (análise) + PWA no iPhone (registro rápido). O Claude escreve o código; o João revisa e faz o merge.

**Fonte da verdade:** `docs/specs/v1-design.md`. O processo está em `docs/specs/README.md`.

## Stack

- Next.js 16 (App Router) + TypeScript strict. Mutations em Server Actions; `/api/sync` (Route Handler) para a fila offline.
- Postgres: Docker Compose local (dev/testes), Neon em produção. **Prisma 7, sempre instalado com `@7`** (`prisma@7`, `@prisma/client@7`, adapters `@7`): a tag `latest` aponta para o Prisma 8 RC.
- Better Auth (e-mail/senha). Tailwind + shadcn/ui. Recharts (seguir a skill `dataviz`).
- Serwist (service worker), Dexie (fila offline), `web-push` + Vercel Cron.
- Zod, Vitest, Playwright. CI no GitHub Actions. Deploy na Vercel.

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
- Commits pequenos, mensagem em pt-BR no imperativo (`adiciona módulo do ciclo da fatura`).

## Fluxo de cada task

1. Issue da milestone v1 → spec em `docs/specs/tasks/NN-slug.md` → **aprovação do João no chat antes de codar**.
2. Branch `task/NN-slug`. TDD: testes dos critérios de aceite primeiro.
3. `npm run lint && npm test && npm run build` verdes. UI: conferir no navegador.
4. Subagente revisor (Opus, effort high) com a spec + `git diff main...HEAD`. Corrigir o que proceder; registrar o que foi descartado e por quê.
5. PR com `Closes #N`, critérios marcados e resumo da revisão. **Não fazer merge**: o João faz.
