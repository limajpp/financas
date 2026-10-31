# 01 — Scaffold: Next.js 16, Tailwind, shadcn/ui, testes e CI

Issue: #1 · Design: [Escolhas técnicas](../v1-design.md#escolhas-técnicas-decisão-do-claude-o-joão-valida)

## Objetivo

Ter o projeto rodando com testes e CI, para que todas as tasks seguintes sigam o ciclo spec → TDD → review com o CI barrando o que quebrar.

## Comportamento

- `create-next-app` com Next.js 16, App Router, TypeScript strict, Tailwind, ESLint, pasta `src/`, alias `@/*`, npm.
- shadcn/ui inicializado (`components.json`, `src/lib/utils.ts`) com o componente `button`, para validar a integração.
- Estrutura inicial: `src/app`, `src/components`, `src/lib`, `src/domain` (regras puras).
- Home placeholder em pt-BR: título "Finanças" e uma frase curta. `<html lang="pt-BR">` e metadata em pt-BR.
- **Vitest**: ambiente `node` para `src/domain/**`, `jsdom` para componentes; um teste real em `src/domain/money.ts` (`formatBRL(cents)` → `"R$ 47,90"`), que já será usado no app.
- **Playwright**: projetos `chromium` (desktop) e `webkit` com o perfil de iPhone (mais perto do Safari do iOS); smoke test da home.
- **Prettier** + `eslint-config-prettier`.
- Scripts: `dev`, `build`, `start`, `lint` (ESLint + `tsc --noEmit`), `format`, `test`, `test:watch`, `test:e2e` e `prepare` (ativa `core.hooksPath .githooks` no `npm install`).
- `.nvmrc` com Node 24 e `engines` no `package.json`; `.env.example` comentado (vazio por enquanto).
- **CI** `.github/workflows/ci.yml`: em PR para `develop`/`main` e em push nessas branches. Job `check` (install com cache → lint → test → build), job `e2e` (instala os navegadores do Playwright → `test:e2e`; sobe o relatório como artefato se falhar). Cancela execuções antigas do mesmo branch (`concurrency`).
- Workflow `commits.yml` (só em PR, inclusive quando o título é editado): roda `.githooks/commit-msg` no **título do PR** (que vira o commit do squash) e em cada commit do PR.

## Critérios de aceite

- [ ] CA1 — `npm run lint`, `npm test`, `npm run build` e `npm run test:e2e` passam localmente.
- [ ] CA2 — `formatBRL` tem testes: 4790 → "R$ 47,90"; 0 → "R$ 0,00"; 123456 → "R$ 1.234,56"; −500 → "-R$ 5,00".
- [ ] CA3 — O smoke test encontra "Finanças" na home em chromium e webkit (iPhone).
- [ ] CA4 — O workflow de CI roda e passa no PR desta task.
- [ ] CA5 — Um erro de tipo ou um teste quebrado faz o CI falhar (conferido localmente com uma quebra temporária).
- [ ] CA6 — README atualizado com os scripts reais.
- [ ] CA7 — Um PR com título fora do padrão (ex.: "adiciona scaffold") faz o job `commits` falhar (conferido rodando o script com esse título).

## Casos de borda

- O `Intl` do Node usa espaço não separável (U+00A0) em "R$ 47,90": o teste compara com o caractere certo, ou normaliza antes de comparar.

## Decisões

- **npm** em vez de pnpm: já vem com o Node, e um gerenciador a menos no CI e na Vercel.
- **WebKit no e2e**: o app vai rodar no Safari do iPhone, e o Chromium sozinho esconderia bugs do iOS.
- **`next lint` não existe mais no Next 16**: o lint chama o ESLint direto, com o flat config.
- **Proteção da `develop` e da `main`** (exigir CI verde para fazer merge): fica para depois do primeiro CI verde, porque a regra precisa do nome dos checks. Eu configuro com `gh api` no fim desta task.

## Fora do escopo

- Banco, auth e deploy (tasks 2–4). CD vem na task 4.
- Identidade visual (task 26).
