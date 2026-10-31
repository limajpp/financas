# 07 — Cartões: cadastro e domínio do ciclo da fatura

Issue: #7 · Design: [Regras de domínio](../v1-design.md#regras-de-domínio-que-eu-decidi-o-joão-confere) · [Modelo de dados](../v1-design.md#modelo-de-dados-v1-preparado-para-a-fase-2)

## Objetivo

Decidir, para cada compra no crédito, **em qual fatura ela cai** (identificada pelo vencimento). A regra mais sensível do app vive num módulo puro, muito testado. As próximas tasks só chamam esse módulo: lançamentos (8), parcelas (12), faturas (18) e onboarding (22). Também entra o cadastro de cartões.

## A regra (`src/domain/invoice-cycle.ts`)

Um cartão tem um **ciclo**: `closingDay` (dia do fechamento) e `dueDay` (dia do vencimento), os dois de 1 a 31. As datas são dias de calendário (`YYYY-MM-DD`, task 6).

1. **Dia que não existe no mês** (29, 30 ou 31) vale como o **último dia** daquele mês. Fechamento dia 31 em fevereiro fecha em 28/02, ou 29/02 em ano bissexto.
2. **Fechamento da compra:** é o primeiro fechamento **depois** da data da compra. Uma compra **antes** do fechamento do mês cai na fatura que fecha nesse mês. Uma compra **no dia do fechamento ou depois** cai na fatura que fecha no mês seguinte.
3. **Vencimento:** fica no mesmo mês do fechamento se `dueDay > closingDay`, e no mês seguinte se `dueDay ≤ closingDay`. A comparação usa os números configurados, não as datas já ajustadas, então o mês do vencimento não muda nos meses curtos. O dia do vencimento também passa pela regra 1.
4. **A fatura é identificada pelo vencimento** (`invoiceDueDate`). É esse valor que os lançamentos vão guardar na task 8.

Exemplos, com fechamento dia 3 e vencimento dia 10:

| Compra              | Fecha em   | Vence em   |
| ------------------- | ---------- | ---------- |
| 02/10/2026          | 03/10/2026 | 10/10/2026 |
| 03/10/2026 (no dia) | 03/11/2026 | 10/11/2026 |
| 28/12/2026          | 03/01/2027 | 10/01/2027 |

Exemplos com o vencimento no mês seguinte, com fechamento dia 25 e vencimento dia 5:

| Compra              | Fecha em   | Vence em   |
| ------------------- | ---------- | ---------- |
| 24/10/2026          | 25/10/2026 | 05/11/2026 |
| 25/10/2026 (no dia) | 25/11/2026 | 05/12/2026 |
| 26/12/2026          | 25/01/2027 | 05/02/2027 |

**Funções:**

- `invoiceFor(cycle, purchaseDate)` devolve `{ closingDate, dueDate }`.
- `shiftInvoice(cycle, invoice, n)` devolve a fatura `n` ciclos depois, para as parcelas: a parcela _i_ cai na fatura da compra + (i−1). Ela entra agora porque usa a mesma regra, e é testada aqui.
- **Histórico do ciclo:** `cycleOn(cycles, date)` escolhe, entre as versões do ciclo, a que vale numa data. É a versão mais recente com `validFrom ≤ date`.

## Histórico do ciclo (mudar o fechamento só vale para o futuro)

- **Tabela `CardCycle`:** `cardId`, `closingDay`, `dueDay` e `validFrom` (dia de calendário).
  - O cartão nasce com uma versão, com `validFrom` igual à data mínima (`1900-01-01`), que vale para qualquer compra antiga, inclusive as do onboarding.
  - Mudar o fechamento ou o vencimento grava uma versão nova com `validFrom` = hoje em São Paulo. Se já existe uma versão com essa data, ela é substituída.
- **O que muda e o que não muda:** a fatura de uma compra é calculada com o ciclo que vale **na data da compra**. Uma compra de antes da mudança, mesmo se registrada ou editada depois, continua com a regra antiga. A task 8 também grava o `invoiceDueDate` no lançamento, então o histórico existe para os recálculos: editar a data de uma compra, gerar parcelas e o onboarding.

## Modelo

- **`Card`:**
  - `id`, `spaceId` (`onDelete: Cascade`);
  - `accountId`, a conta que paga a fatura (`onDelete: NoAction`: conta não se apaga pelo app, e apagar o espaço inteiro em cascata continua funcionando, como no `parentId` das categorias);
  - `name`;
  - `limitCents?` (opcional, maior que zero);
  - `archivedAt?`, `createdAt` e `updatedAt`.
- **`CardCycle`:**
  - `id`, `cardId` (`onDelete: Cascade`), `closingDay`, `dueDay` e `validFrom` (`@db.Date`);
  - `@@unique([cardId, validFrom])`;
  - `CHECK` no banco para os dias ficarem entre 1 e 31.
- Migration `cards`.

## Regras do cadastro (`src/domain/cards.ts`, com testes)

- **Nome:** de 1 a 40 caracteres e único entre os cartões do espaço (inclusive os arquivados), sem diferença de maiúsculas e acentos.
- **Conta de pagamento:**
  - tem que ser uma conta do mesmo espaço;
  - num cartão novo, ela não pode estar arquivada;
  - na edição, o cartão pode manter a conta atual mesmo que ela tenha sido arquivada depois.
- **Dias:** inteiros de 1 a 31. Fechamento e vencimento no mesmo dia são aceitos: o vencimento cai no mês seguinte.
- **Limite:** opcional, maior que zero e até o limite geral de valores (R$ 20 milhões).
- **Arquivar e desarquivar**, sem apagar, como nas contas.

## Servidor e tela

- **`src/server/cards.ts`:** `listCards`, `selectableCards`, `createCard`, `updateCard` e `setCardArchived`.
  - Tudo filtra por `spaceId`, e um `accountId` de outro espaço responde como "conta não encontrada".
  - Cada cartão volta com o ciclo atual, e também com a **fatura aberta hoje** (`invoiceFor(ciclo de hoje, hoje)`).
- **Server Actions** com Zod. Como nas contas, a sessão é lida antes da validação.
- **Tela:** os cartões ficam na mesma tela `/contas`, numa seção "Cartões de crédito" abaixo das contas. Cada linha mostra:
  - o nome e "Paga com {conta}";
  - "Fecha dia 3 · vence dia 10" e "Fatura aberta vence em 10/11/2026";
  - o limite, se houver.
- **Diálogo de criar e editar** (folha de baixo no celular):
  - nome, conta de pagamento (`<select>` nativo), dia do fechamento, dia do vencimento (`<select>` de 1 a 31) e limite (`MoneyInput`, opcional);
  - **prévia ao vivo** com a função do domínio: "Uma compra hoje cai na fatura que fecha em 03/11 e vence em 10/11/2026.";
  - para os dias 29 a 31, a dica "Nos meses mais curtos, vale o último dia do mês.";
  - na edição, se o fechamento ou o vencimento mudarem, o aviso "A mudança vale para compras a partir de hoje. As anteriores continuam nas faturas de antes.";
  - sem nenhuma conta cadastrada, o diálogo pede para cadastrar uma conta primeiro.
- `/configuracoes` ganha o link "Cartões", que leva à seção em `/contas`.

## Critérios de aceite

- [ ] CA1 — Unitário, com tabelas de casos:
  - compra antes, no dia e depois do fechamento;
  - virada de mês e de ano;
  - fevereiro, bissexto (2028) e não (2026), com fechamento e vencimento em 29, 30 e 31;
  - `dueDay < closingDay` (vence no mês seguinte) e `dueDay == closingDay`;
  - o último dia do mês como data da compra.
- [ ] CA2 — Unitário: propriedades conferidas em todas as combinações de `closingDay` e `dueDay` de 1 a 31, para cada dia de 2026 a 2028:
  - o fechamento é depois da compra e no máximo um mês depois;
  - o vencimento não é antes do fechamento (pode coincidir no caso raro de fevereiro descrito nos casos de borda) e cai no mês certo pela regra 3;
  - de um dia para o seguinte, a compra fica na mesma fatura ou passa para a próxima, sem pular nenhuma;
  - compras em dias seguidos nunca voltam para uma fatura anterior.
- [ ] CA3 — Unitário: `shiftInvoice` com n = 0, 1, 11 e 12, atravessando fevereiro e a virada de ano. Deslocar n e depois m dá o mesmo que deslocar n + m.
- [ ] CA4 — Trocar o `closingDay` não muda a fatura de compras de antes da troca:
  - unitário com `cycleOn`;
  - integração: editar o cartão grava uma versão nova, e a fatura de uma compra de ontem continua a mesma.
- [ ] CA5 — Integração:
  - a conta de outro espaço é recusada, e uma conta arquivada também, num cartão novo;
  - nome repetido é recusado;
  - um usuário não lista, edita nem arquiva o cartão de outro espaço.
- [ ] CA6 — E2E (Chromium e iPhone/WebKit): cadastrar uma conta e um cartão, ver "Fecha dia X · vence dia Y" e a fatura aberta, editar o fechamento e ver o aviso, e arquivar.
- [ ] CA7 — Lint, format, test, build, `test:e2e:docker` e CI verdes. Tela conferida no desktop e no viewport de iPhone.

## Casos de borda

- **Fechamento dia 31, compra em 30/04:** abril tem 30 dias, então a fatura fecha em 30/04. Como a compra é no dia do fechamento, ela vai para a fatura que fecha em 31/05.
- **Fechamento dia 30, compra em 28/02/2026:** fevereiro de 2026 tem 28 dias, então a fatura fecha em 28/02. Pela mesma regra, a compra vai para a fatura que fecha em 30/03.
- **Fechamento dia 28, vencimento dia 30, em fevereiro de 2026:** fecha em 28/02 e vence em 28/02, no mesmo dia, porque o vencimento é ajustado para o último dia do mês. É raro; a regra continua previsível e está coberta por teste.
- **Mudança de ciclo no meio do mês:** uma compra de antes da mudança pode cair numa fatura posterior à de uma compra feita depois. Por exemplo, o fechamento passa do dia 5 para o dia 20 no dia 10: a compra do dia 8 vai para a fatura que fecha em 5 do mês seguinte, e a do dia 12, para a que fecha em 20 deste mês. É o efeito esperado de "só vale para o futuro". A troca manual de fatura (task 8) corrige casos pontuais.

## Decisões

- **A fatura é identificada pelo vencimento,** como no design (`invoiceDueDate`). O fechamento é derivado e aparece na tela.
- **O mês do vencimento vem dos números configurados,** não das datas ajustadas. Assim, um cartão "fecha 25, vence 5" sempre vence no mês seguinte, inclusive em fevereiro.
- **Histórico em tabela (`CardCycle`) com `validFrom`,** em vez de só copiar o ciclo para cada lançamento: as parcelas futuras e o onboarding precisam calcular faturas de compras antigas e futuras com o ciclo certo. Uma mudança no mesmo dia substitui a versão do dia, em vez de empilhar versões.
- **A mudança vale a partir de hoje,** sem pedir uma data ao usuário. É o caso comum, quando o banco avisa e você atualiza o app. Escolher outra data pode entrar depois, se fizer falta.
- **Cartões na tela `/contas`:** cada cartão está ligado a uma conta, e ver os dois juntos ajuda. A tela de faturas (task 18) é outra coisa: análise por vencimento.
- **`<select>` nativo para os dias:** no iPhone, ele abre a roleta do sistema, mais rápida que digitar.

## Fora do escopo

- Tela de faturas (task 18).
- Pagamento de fatura (task 11).
- Troca manual da fatura de um lançamento (task 8).
- Gerar as parcelas (task 12); aqui só entra o `shiftInvoice` que elas vão usar.
- Limite disponível (precisa dos lançamentos).
