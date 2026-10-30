# Finanças

> App de finanças pessoais para registrar cada gasto **no momento em que ele acontece** e entender o mês com poucos números claros.
> Web para análise, PWA no iPhone para registrar em segundos, até offline.

![status](https://img.shields.io/badge/status-em%20desenvolvimento-orange) ![licença](https://img.shields.io/badge/licen%C3%A7a-MIT-blue)

---

## O problema

O extrato do banco mostra isto:

```
PIX ENVIADO   PAG*JOSE SILVA 12.345.678/0001-90     -R$ 47,90
```

No fim do dia, ninguém lembra o que foi. O problema não é falta de dado, é **perda de contexto** entre o gasto e o registro. Os apps de finanças conhecidos (Mobills, Organizze, YNAB, Monarch, Copilot) resolvem bem a análise, mas registrar ainda dá trabalho, e o que dá trabalho não é feito.

Este projeto ataca as duas pontas:

1. **Registro em segundos no celular**, com a memória fresca. Só o valor é obrigatório; o resto vem preenchido.
2. **Memória por estabelecimento:** descreveu um CNPJ/CPF uma vez, o app sugere descrição e categoria nas próximas.
3. **Uma visão do mês que responde perguntas:** como fechei, com o que mais gastei, quanto já está comprometido e onde dá para economizar.

> Todos os nomes, documentos e valores deste repositório são fictícios.

## Funcionalidades da v1

**Registro**

- Tela única: teclado numérico aberto, categorias mais usadas em um toque, conta e forma de pagamento lembradas do último uso.
- Despesa, receita, transferência entre contas e pagamento de fatura (os dois últimos não contam como gasto).
- Compras parceladas (cada parcela conta no seu mês e cai na sua fatura) e assinaturas recorrentes.
- Autocomplete por estabelecimento, com apelidos: o nome que você deu, o nome que aparece no extrato e o CPF/CNPJ.
- Funciona **offline**: o lançamento entra numa fila local e sincroniza quando a conexão volta.
- Lembrete diário por push às 21h: "registrou tudo hoje?".

**Contas e cartões**

- Qualquer conta aceita qualquer forma de pagamento (Pix, débito, crédito, boleto, TED, dinheiro).
- Saldo por conta (saldo inicial + lançamentos) e **conferência de saldo** com o banco, que mostra a diferença e ajuda a achar o que ficou sem registro.
- Cartões com dia de fechamento e vencimento; cada compra cai na fatura certa automaticamente.

**Visões**

- **Dashboard:** sobra do mês, taxa de poupança, projeção do mês e comprometido futuro; 2–3 insights em linguagem simples; categorias vs média; evolução de 6 meses.
- **Faturas** por cartão e vencimento, com as parcelas futuras.
- **Assinaturas:** total por mês e por ano, alerta de mudança de valor.
- **Estabelecimentos:** onde mais gasto, por valor e por frequência.
- **Lançamentos:** lista por dia no celular, tabela com filtros e categorização em massa na web.

**Insights por regras (sem IA na v1)**

- Categoria acima da média dos últimos 3 meses.
- Gastos pequenos recorrentes ("23 cafés este mês, R$ 210").
- Assinaturas anualizadas e mudança de valor.
- Fixos × variáveis.

## Roadmap

| Fase        | Escopo                                                                                                                 | Status                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **v1**      | Fundação, cadastros, registro rápido, PWA offline + lembrete, visões, dashboard                                        | 🚧 em andamento ([milestone](../../milestone/1)) |
| **Fase 2**  | Espaço compartilhado do casal: "um paga e divide" (estilo Splitwise), saldo entre os dois, métricas individual × casal | planejada                                        |
| **Fase 3+** | Limites por categoria sugeridos pela média, metas, reserva de emergência, importação OFX/Open Finance, insights com IA | ideias                                           |

O backlog completo está nas [issues](../../issues) (label `futuro` = depois da v1).

## Stack e por quê

| Camada    | Escolha                                             | Por quê                                                                                                                  |
| --------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Framework | **Next.js 16** (App Router) + TypeScript            | Um app só para web e PWA; Server Actions evitam manter API e front separados; deploy grátis na Vercel                    |
| Banco     | **Postgres** (Neon em produção, Docker local)       | Relacional combina com dinheiro (somas, agrupamentos, integridade); Neon tem plano free e integra com a Vercel           |
| ORM       | **Prisma 7** + driver adapter da Neon               | Schema tipado e migrations versionadas                                                                                   |
| Auth      | **Better Auth** (e-mail/senha)                      | Sessões no próprio banco; o plugin de organizations serve de base para o espaço compartilhado da fase 2                  |
| UI        | **Tailwind + shadcn/ui**, gráficos com **Recharts** | Componentes acessíveis que ficam no repo, sem lock-in                                                                    |
| PWA       | **Serwist** + **Dexie** (IndexedDB)                 | Service worker para abrir instantâneo; fila offline com `clientId` para o sync ser idempotente                           |
| Lembrete  | **Web Push** (VAPID) + **Vercel Cron**              | Funciona no iPhone (iOS 16.4+) com o app instalado na tela inicial                                                       |
| Qualidade | **Zod**, **Vitest**, **Playwright**                 | Regras de dinheiro testadas como funções puras; fluxos críticos testados ponta a ponta                                   |
| CI/CD     | **GitHub Actions** → Vercel                         | Todo PR roda lint, testes, build e e2e e ganha um preview; a `main` só vai para produção (com migrations) se o CI passar |

Por que **PWA** e não app nativo: um único código, sem App Store, instalação pela tela inicial, e o iOS já suporta push e offline para PWAs.

## Arquitetura

```
 iPhone (PWA)                     Desktop (web)
  ├─ tela de registro               ├─ dashboard, faturas, assinaturas…
  ├─ fila offline (Dexie) ──┐       │
  └─ service worker         │       │
                            ▼       ▼
                 Next.js 16 na Vercel
                  ├─ Server Actions (CRUD)
                  ├─ /api/sync  (fila offline, idempotente por clientId)
                  ├─ /api/cron/reminder (push diário, 21h BRT)
                  └─ src/domain/  ← regras puras e testadas:
                       ciclo da fatura · parcelas · saldo · métricas · insights
                            │
                            ▼
                 Postgres (Neon) via Prisma 7
```

### Modelo de dados (resumo)

- `User`, `Space` (`PERSONAL` | `SHARED`) e `SpaceMember`: todo dado pertence a um espaço. Na v1 só existe o pessoal, mas a fase 2 não exige migração dolorosa.
- `Account` (saldo inicial com data) e `Card` (fechamento, vencimento, limite opcional, ligado a uma conta).
- `Category`: dois níveis, `isFixed` para separar fixos de variáveis.
- `Counterparty`: a memória por estabelecimento, com apelidos (nome no extrato, CPF/CNPJ), descrição e categoria padrão.
- `Transaction`: `EXPENSE` | `INCOME` | `TRANSFER` | `CARD_PAYMENT`; valor em centavos; método (`PIX`, `DEBIT`, `CREDIT`, `CASH`, `BOLETO`, `TED`); fatura, parcela e assinatura de origem; `clientId` para o sync offline.
- `RecurringRule` (assinaturas) e `PushSubscription`.

### Regras de domínio principais

- Dinheiro sempre em **centavos inteiros**; datas no fuso `America/Sao_Paulo`.
- Compra no crédito conta no **mês da compra** nos indicadores; a tela de faturas mostra quando ela é paga.
- Compra **no dia do fechamento ou depois** vai para a fatura seguinte. A fatura pode ser trocada à mão.
- Parcela _i_ conta no mês da compra + (i−1). Centavos que sobram da divisão vão para a 1ª parcela.
- Transferência e pagamento de fatura **não** são gasto.

Os detalhes completos estão em [`docs/specs/v1-design.md`](docs/specs/v1-design.md).

## Como rodar localmente

Pré-requisitos: Node 24+ (`nvm use`) e Docker.

```bash
git clone git@github.com:limajpp/financas.git
cd financas
npm install                   # também ativa o hook de commit (.githooks) e gera o Prisma Client
cp .env.example .env          # valores do Postgres local
npm run db:up                 # Postgres no Docker (porta 5433), com os bancos financas e financas_test
npm run db:migrate            # aplica as migrations no banco de dev
npx playwright install        # navegadores dos testes e2e
npm run dev                   # http://localhost:3000
```

O Postgres roda num container só, com dois bancos: `financas` (dev) e `financas_test` (testes de integração). A porta do host é a 5433; para usar outra, defina `POSTGRES_PORT` e ajuste as URLs no `.env`. Para começar do zero: `docker compose down -v && npm run db:up && npm run db:migrate`.

| Comando                   | O que faz                                                                         |
| ------------------------- | --------------------------------------------------------------------------------- |
| `npm run dev`             | servidor de desenvolvimento                                                       |
| `npm run build`           | build de produção                                                                 |
| `npm run lint`            | ESLint (zero avisos) + checagem de tipos (`tsc`)                                  |
| `npm run format`          | formata com Prettier (`format:check` só confere)                                  |
| `npm test`                | testes Vitest: unitários e de integração (precisa do `db:up`; `test:watch`)       |
| `npm run db:up`           | sobe o Postgres local e espera ele ficar saudável                                 |
| `npm run db:migrate`      | cria/aplica migrations no banco de dev (`prisma migrate dev`)                     |
| `npm run db:studio`       | abre o Prisma Studio                                                              |
| `npm run test:e2e`        | testes de ponta a ponta (Playwright: Chromium desktop + WebKit com perfil iPhone) |
| `npm run test:e2e:docker` | os mesmos e2e dentro da imagem oficial do Playwright                              |

O WebKit do Playwright só tem suporte oficial em Ubuntu/Debian. Em outras distros (Fedora, Arch…), use `npm run test:e2e:docker`, ou `npx playwright test --project=chromium` para rodar só o Chromium. O script monta o repo com `:z` (SELinux): na primeira vez o Docker re-rotula os arquivos, o que demora um pouco. A versão da imagem acompanha a do `@playwright/test`, que fica fixada (sem `^`); atualize as duas juntas.

Os testes de integração (`*.int.test.ts`) rodam contra o banco de `TEST_DATABASE_URL`, que precisa terminar em `_test`: antes de cada teste, `resetDatabase()` apaga todas as linhas. As migrations pendentes são aplicadas nele no começo de cada execução.

O projeto usa **npm 12** (`packageManager` no `package.json`); o CI instala a mesma versão.

### CI

Todo PR para a `develop` ou a `main` roda no GitHub Actions ([`ci.yml`](.github/workflows/ci.yml)):

- **Lint, test and build:** lint, tipos, formatação, testes (unitários e de integração, contra um Postgres de serviço) e build.
- **E2E:** Playwright em Chromium e WebKit (iPhone) contra o build de produção.
- **Commit messages and PR title** ([`commits.yml`](.github/workflows/commits.yml)): valida o título do PR (que vira o commit do squash) e cada commit com o mesmo hook usado localmente. Roda de novo quando o título é editado.

## Como este projeto é desenvolvido

O desenvolvimento é **orientado a spec** e feito task por task, em parceria com o [Claude Code](https://claude.com/claude-code):

1. Cada item do backlog é uma **issue** com critérios de aceite.
2. Antes do código, uma **spec da task** é escrita em [`docs/specs/tasks/`](docs/specs/tasks) e aprovada.
3. Os critérios de aceite viram **testes primeiro** (TDD), depois a implementação.
4. Lint, testes e build precisam passar; telas são conferidas no navegador.
5. Um **agente revisor** independente lê a spec e o diff procurando bugs, desvios e testes fracos.
6. Um **PR para a `develop`** fecha a issue; o merge é feito por um humano. A `main` só recebe releases vindas da `develop`.

Commits seguem `<gitmoji> <type>(<scope>)?: <description>`, em inglês (ex.: `✨ feat(cards): add invoice cycle module`), validados por um hook `commit-msg` versionado em `.githooks/`.

O processo completo está em [`docs/specs/README.md`](docs/specs/README.md).

## Status

🚧 Em desenvolvimento: v1, etapa 1 (fundação). Acompanhe pela [milestone v1](../../milestone/1).

## Licença

[MIT](LICENSE) © 2026 João Pedro Lima
