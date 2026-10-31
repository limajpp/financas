# 06 — Contas: cadastro e saldo inicial com data

Issue: #6 · Design: [Modelo de dados](../v1-design.md#modelo-de-dados-v1-preparado-para-a-fase-2) · [Decisões do João](../v1-design.md#decisões-do-joão)

## Objetivo

Cadastrar as contas bancárias com um saldo inicial numa data, que é o ponto de partida do saldo calculado (task 8). Toda conta aceita qualquer forma de pagamento. Esta task também cria as duas peças de dinheiro e data que as próximas vão reusar: ler um valor digitado em R$ e tratar datas como dia de calendário.

## Comportamento

### Modelo

- `Account`:
  - `id`, `spaceId` (`onDelete: Cascade`);
  - `name` e `color`, com a mesma paleta das categorias;
  - `initialBalanceCents Int`, que pode ser negativo (cheque especial);
  - `initialBalanceDate`, um dia de calendário (`@db.Date`), não um instante;
  - `archivedAt?`, `createdAt` e `updatedAt`;
  - índice em `spaceId`.
- **Sem campo de dono:** a conta pertence ao espaço pessoal, e o dono do espaço é o dono da conta. Na fase 2 ela continua no espaço de quem a cadastrou (design).
- Migration `accounts`.

### Dinheiro (`src/domain/money.ts`, com testes)

- `parseBRL(texto)` devolve centavos (`number` inteiro) ou `null` se o texto não for um valor válido:
  - aceita `1.234,56`, `1234,56`, `1234`, `0,5` (50 centavos), `R$ 1.234,56`, espaços nas pontas e o sinal de menos (`-` ou `−`) no início;
  - o ponto só vale como separador de milhar, em grupos de 3 dígitos: `1.234` = R$ 1.234,00, enquanto `12.5` e `1.23,45` são inválidos;
  - aceita no máximo 2 casas depois da vírgula;
  - o limite é R$ 20.000.000,00 em módulo, que cabe com folga no `Int` do Postgres; acima disso, `null`.
- `formatBRLInput(centavos)` devolve o valor como fica no campo, sem "R$": 123456 → `1.234,56`.
- O `formatBRL` atual continua como está, para exibição.

### Datas (`src/domain/dates.ts`, com testes)

- As datas de calendário circulam como texto `YYYY-MM-DD` no domínio e na UI.
- `todayInSaoPaulo(agora?)` devolve o dia de hoje no fuso `America/Sao_Paulo`. Às 23h30 de Brasília de 31/10 ainda é dia 31, mesmo já sendo 1º/11 em UTC.
- `calendarDateToDb("2026-10-31")` e `dbToCalendarDate(date)` convertem na fronteira com o Prisma, sempre na meia-noite UTC, para o dia nunca escorregar por causa do fuso.
- `formatCalendarDate("2026-10-31")` devolve `31/10/2026`.

### Regras (`src/domain/accounts.ts`, com testes)

- **Nome:** de 1 a 40 caracteres e único entre as contas do espaço, contando as arquivadas, sem diferença de maiúsculas e acentos. A normalização é a mesma das categorias, movida para um módulo comum.
- **Data do saldo inicial:** não pode estar no futuro em relação a hoje em São Paulo. O padrão no formulário é hoje.
- **Arquivar:** a conta some das escolhas (`selectableAccounts`), mas continua existindo, porque os lançamentos da task 8 vão apontar para ela. Dá para desarquivar. Não existe apagar.
- **Ordem:** alfabética em pt-BR.

### Servidor

- `src/server/accounts.ts`:
  - `listAccounts(spaceId, { includeArchived })`;
  - `selectableAccounts(spaceId)`;
  - `createAccount(spaceId, input)`;
  - `updateAccount(spaceId, id, input)`, que muda nome, cor, saldo inicial e data;
  - `setAccountArchived(spaceId, id, archived)`.
- Toda leitura e escrita filtra por `spaceId`. Um `id` de outro espaço responde como "não encontrada".
- **Server Actions** com Zod: o valor chega como texto e passa pelo `parseBRL` dentro do schema. A data chega como `YYYY-MM-DD`.

### Tela `/contas` (mobile-first)

- Lista das contas, cada uma com a bolinha de cor, o nome e "Saldo inicial R$ 1.234,56 em 31/10/2026". Um saldo negativo aparece em vermelho, com o sinal de menos.
- Botão "Nova conta" e interruptor "Mostrar arquivadas".
- **Diálogo de criar e editar,** no mesmo formato de folha de baixo das categorias:
  - campos nome, cor, saldo inicial e data;
  - o saldo inicial usa um **campo de valor em R$**, com teclado numérico no iPhone (`inputMode="decimal"`), e é formatado ao sair do campo (`1234,5` → `1.234,50`);
  - como o teclado decimal do iPhone não tem a tecla de menos, há uma opção **"Saldo negativo (cheque especial)"**;
  - a data usa o seletor nativo (`<input type="date">`), com o máximo em hoje.
- A folha de baixo vira um componente comum (`ResponsiveDialogContent`), usado pelas categorias e pelas contas.
- **Acesso:** a tela fica na aba "Contas" da barra inferior e da sidebar, que hoje é um placeholder. `/configuracoes` também ganha o link "Contas". Na task 8, a mesma tela passa a mostrar o saldo calculado.

## Critérios de aceite

- [ ] CA1 — E2E (Chromium e iPhone/WebKit): criar uma conta com saldo `1.234,56` e ver "R$ 1.234,56". Depois, editar o nome e o saldo, arquivar (some da lista) e ver de novo com "Mostrar arquivadas".
- [ ] CA2 — Saldo inicial negativo é permitido:
  - integração: −R$ 350,00 é gravado como −35000;
  - e2e: a opção "Saldo negativo" mostra "-R$ 350,00".
- [ ] CA3 — Unitário: `parseBRL("1.234,56")` = 123456, além dos casos válidos e inválidos listados acima e do limite.
- [ ] CA4 — Unitário: `todayInSaoPaulo` na virada do dia (23h30 em Brasília = 02h30 UTC do dia seguinte) e a ida e volta `calendarDateToDb` → `dbToCalendarDate` sem perder um dia.
- [ ] CA5 — Integração: nome repetido (maiúsculas e acentos) é recusado, e data no futuro é recusada.
- [ ] CA6 — Integração: um usuário não lista, edita nem arquiva conta de outro espaço.
- [ ] CA7 — Lint, format, test, build, `test:e2e:docker` e CI verdes. Tela conferida no desktop e no viewport de iPhone.

## Casos de borda

- Campo de valor vazio → "Informe o saldo inicial." (zero precisa ser digitado: `0`).
- Colar "R$ 1.234,56" no campo → funciona.
- `-0` ou `0` com a opção "negativo" marcada → grava 0.
- Data inválida digitada à mão (no desktop) → "Data inválida.".

## Decisões

- **Gestão em `/contas`, não dentro de Configurações** (a issue fala em "nas configurações"): a aba Contas já existe e vai mostrar os saldos na task 8. Ter as contas num lugar só evita duas telas quase iguais. Configurações só leva até lá.
- **Opção "Saldo negativo" em vez de digitar o sinal:** o teclado decimal do iPhone não tem a tecla de menos, e o teclado completo é pior para digitar valores. O `parseBRL` aceita o sinal mesmo assim, para quem cola ou digita no desktop.
- **Data como `@db.Date` e texto `YYYY-MM-DD`:** é um dia de calendário, como pede o CLAUDE.md. Guardar como instante faria o dia mudar dependendo do fuso de quem lê.
- **Data futura recusada:** o saldo inicial é uma foto do banco num dia que já aconteceu. Uma data futura deixaria o cálculo da task 8 sem sentido.
- **O saldo inicial é o do fim do dia informado:** os lançamentos que contam no saldo calculado (task 8) são os de depois dessa data. O formulário diz isso ("O saldo que o banco mostrava no fim desse dia").
- **Sem apagar:** igual às categorias, os lançamentos vão apontar para a conta.
- **Peças comuns extraídas:** `ActionResult`/`zodFailure` (`src/lib/action-result.ts`), `normalizeName` (`src/domain/names.ts`), `ColorPicker` e `ResponsiveDialogContent`/`ResponsiveDialogFooter`.
- **Paleta comum:** `CATEGORY_COLORS` vira `PALETTE_COLORS` num módulo compartilhado, usado por categorias e contas.

## Fora do escopo

- Saldo atual calculado (task 8).
- Conferir saldo com o banco (task 21).
- Cartões (task 7).
- Onboarding com o saldo de hoje (task 22).
