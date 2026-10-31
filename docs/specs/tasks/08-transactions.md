# 08 — Lançamentos: Transaction, Counterparty e módulo de saldo

Issue: #8 · Design: [Modelo de dados](../v1-design.md#modelo-de-dados-v1-preparado-para-a-fase-2) · [Regras de domínio](../v1-design.md#regras-de-domínio-que-eu-decidi-o-joão-confere)

## Objetivo

Criar o modelo central do app: despesas e receitas, ligadas a uma conta ou a um cartão, com estabelecimento e categoria. Junto vem o saldo de cada conta, calculado por um módulo puro. Esta task não tem tela de registro (é a task 9). A única mudança visível é o **saldo atual** na tela de contas. O resto fica pronto para as tasks 9 a 14 e é verificado por testes.

## Comportamento

### Modelo

- `Transaction`:
  - `id`, `spaceId` (`onDelete: Cascade`), `createdById` (o usuário logado);
  - `type`: `EXPENSE` | `INCOME` | `TRANSFER` | `CARD_PAYMENT`. Esta task cria e edita só despesa e receita. Transferência e pagamento de fatura entram na task 11, mas o modelo e o módulo de saldo já os tratam;
  - `amountCents Int`, sempre positivo. O sinal vem do tipo;
  - `date`: dia de calendário (`@db.Date`), a data da compra ou da competência;
  - `method`: `PIX` | `DEBIT` | `CREDIT` | `CASH` | `BOLETO` | `TED`;
  - `accountId?`, `cardId?`, `toAccountId?` (transferência), `invoiceDueDate?` (`@db.Date`) e `invoiceOverridden Boolean`;
  - `categoryId?`, `counterpartyId?` e `description?`;
  - `clientId` (UUID gerado no aparelho), único por espaço: `@@unique([spaceId, clientId])`;
  - `createdAt` e `updatedAt`.
- **Onde o dinheiro está, por tipo:**

  | Tipo                    | Conta (`accountId`) | Cartão (`cardId`) | Fatura (`invoiceDueDate`) | Destino (`toAccountId`) |
  | ----------------------- | ------------------- | ----------------- | ------------------------- | ----------------------- |
  | Despesa no crédito      | —                   | obrigatório       | obrigatória               | —                       |
  | Despesa por outro meio  | obrigatória         | —                 | —                         | —                       |
  | Receita                 | obrigatória         | —                 | —                         | —                       |
  | Transferência (task 11) | origem              | —                 | —                         | obrigatório e diferente |
  | Pagamento (task 11)     | a que paga          | o cartão          | a fatura paga             | —                       |

  A migration grava essas combinações como `CHECK`, junto com `amountCents > 0`. As chaves estrangeiras usam `NoAction` (contas, cartões e categorias só são arquivados, nunca apagados).

- `Counterparty`, a memória por estabelecimento:
  - `id`, `spaceId` (`onDelete: Cascade`);
  - `name` (o que você digitou) e `nameKey` (o nome normalizado, sem acentos nem maiúsculas), com `@@unique([spaceId, nameKey])`;
  - `aliases String[]`, `document?` (CPF/CNPJ), `defaultDescription?` e `defaultCategoryId?`.
  - Esta task só cria os campos. Quem preenche e usa os apelidos, o documento e os padrões é a task 10.
- Migration `transactions`.

### Regras (`src/domain/transactions.ts`, com testes)

- **Valor:** de R$ 0,01 a R$ 20.000.000,00 (o mesmo teto das contas). Chega já em centavos.
- **Data:** de 01/01/2000 até hoje em São Paulo. Data no futuro é recusada.
- **Forma de pagamento:**
  - despesa aceita as seis;
  - receita aceita Pix, TED, dinheiro e boleto. Crédito e débito não fazem sentido numa entrada.
- **Conta e cartão:** precisam ser do espaço e estar ativos. Na edição, o lançamento pode manter a conta, o cartão ou a categoria que ele já tinha, mesmo que tenham sido arquivados depois (como o cartão com a conta, na task 7).
- **Categoria:** opcional. Sem categoria, o lançamento fica em "Sem categoria", e a categorização em massa da task 14 resolve depois. Se informada, precisa ser do espaço, estar ativa (com o pai ativo) e ser do mesmo tipo do lançamento: categoria de despesa numa despesa. Pode ser uma categoria-mãe ou uma sub.
- **Fatura de uma compra no crédito:**
  - sem escolha manual, `invoiceDueDate` = vencimento de `invoiceFor(cycleOn(ciclos, data), data)`, e `invoiceOverridden = false`;
  - com escolha manual, a fatura informada precisa ser uma das 3 anteriores ou das 3 seguintes à calculada (`shiftInvoice` com o ciclo da data da compra). Fora disso, "Essa fatura não é deste cartão.". Grava `invoiceOverridden = true`;
  - editar a data ou o cartão recalcula a fatura, a menos que a edição traga a escolha manual de novo.
- **Mudança no ciclo do cartão:** quando `updateCard` cria ou substitui uma versão do ciclo, as compras desse cartão com data a partir do `validFrom` da versão, e sem escolha manual, têm a fatura recalculada na mesma transação do banco. Assim, a correção no dia do cadastro (task 7) também corrige as compras já registradas.

### Saldo (`src/domain/balance.ts`, com testes)

`accountBalance(conta, lançamentos, até)` devolve centavos:

- parte do `initialBalanceCents`;
- conta só os lançamentos com data **depois** de `initialBalanceDate` (o saldo inicial é o do fim daquele dia) e até a data `até`, inclusive;
- receita na conta: **+**;
- despesa na conta, por qualquer meio que não seja crédito: **−**;
- despesa no crédito: **não mexe** no saldo. Quem mexe é o pagamento da fatura;
- pagamento de fatura: **−** na conta que paga;
- transferência: **−** na origem e **+** no destino.

O **saldo atual** é `accountBalance(conta, lançamentos, hoje em São Paulo)`.

### Servidor

- `src/server/transactions.ts`:
  - `createTransaction(spaceId, userId, input)` é **idempotente pelo `clientId`**. Se o espaço já tem um lançamento com aquele `clientId`, devolve esse lançamento sem alterar nada (`created: false`). Duas chamadas ao mesmo tempo resultam em um lançamento só: o `@@unique` barra a segunda, que então devolve o existente;
  - `updateTransaction(spaceId, id, input)` muda tudo menos `clientId` e `createdById`. Despesa pode virar receita e vice-versa, desde que a categoria e a forma de pagamento sigam as regras;
  - `deleteTransaction(spaceId, id)`: exclusão de verdade (é dado do usuário, não um cadastro que outros apontam);
  - `accountBalances(spaceId)` devolve o saldo atual de cada conta do espaço.
- **Estabelecimento pelo nome:** a entrada traz `counterparty` como texto (o que você digitou). O servidor procura pelo `nameKey` no espaço e cria se não existir. É pelo nome, não pelo id, porque um lançamento feito offline (task 16) pode trazer um estabelecimento que o servidor ainda não conhece. Duas criações simultâneas do mesmo nome resultam num estabelecimento só.
- Toda leitura e escrita filtra por `spaceId`. Um `id` de outro espaço (lançamento, conta, cartão ou categoria) responde como "não encontrado".
- **Server Actions** (`src/app/(app)/lancamentos/actions.ts`): criar, editar e excluir, com Zod (`src/lib/validation/transactions.ts`). Leem a sessão antes de validar a entrada e chamam `refresh()`. A tela que as usa vem na task 9.

### Entrada (Zod)

- `clientId` (UUID, só na criação), `type` (`EXPENSE` | `INCOME`), `amountCents` (inteiro), `date` (`YYYY-MM-DD`) e `method`;
- `accountId` ou `cardId`, conforme a forma de pagamento, e `invoiceDueDate` opcional (só no crédito);
- `categoryId` opcional;
- `counterparty` opcional, até 60 caracteres;
- `description` opcional, até 120 caracteres.
- Textos vazios ou só com espaços viram "sem valor".

### Tela `/contas`

- Cada conta mostra o **saldo atual** em destaque, à direita, em vermelho quando negativo. Embaixo do nome, em cinza, continua "Saldo inicial R$ 1.234,56 em 31/10/2026".
- Enquanto não houver lançamentos (até a task 9), o saldo atual é igual ao inicial.

## Critérios de aceite

- [x] CA1 — Unitário (saldo): uma despesa no crédito **não** reduz o saldo da conta, e o pagamento da fatura reduz. Também cobre receita, despesa no Pix e no débito, e transferência (− na origem, + no destino).
- [x] CA2 — Unitário (saldo): um lançamento com data anterior ao saldo inicial, ou no mesmo dia, não entra no saldo; um do dia seguinte entra. Um lançamento depois de `até` não entra.
- [x] CA3 — Integração: criar duas vezes com o mesmo `clientId`, em sequência e em paralelo, gera um lançamento só (e um estabelecimento só), e a segunda chamada devolve o primeiro. O mesmo `clientId` em outro espaço cria normalmente.
- [x] CA4 — Integração: um usuário não lê, edita nem exclui lançamento de outro espaço, e não consegue usar conta, cartão ou categoria de outro espaço num lançamento seu.
- [x] CA5 — Integração: uma compra no crédito grava o `invoiceDueDate` do ciclo da data da compra. Com a fatura trocada à mão, grava a escolhida, e uma fatura fora da janela é recusada. Mudar o ciclo do cartão recalcula as compras afetadas e não mexe nas trocadas à mão nem nas anteriores à mudança.
- [x] CA6 — Unitário e integração: categoria de outro tipo, categoria ou conta arquivada (num lançamento novo), receita no crédito e data futura são recusadas, cada uma com mensagem própria.
- [x] CA7 — Integração: `accountBalances` bate com o módulo de saldo para uma conta com receitas, despesas e compras no crédito. Apagar o usuário apaga lançamentos e estabelecimentos.
- [x] CA8 — E2E (Chromium e iPhone/WebKit): uma conta nova mostra o saldo atual igual ao inicial.
- [x] CA9 — Lint, format, test, build, `test:e2e:docker` e CI verdes. Tela conferida no desktop e no viewport de iPhone.

## Casos de borda

- Mesmo `clientId` com dados diferentes: devolve o lançamento que já existe, sem alterar. Corrigir um lançamento é com a edição.
- "Padaria do Bairro" e "padaria do bairro": mesmo estabelecimento, e o nome guardado continua o da primeira vez.
- Editar uma compra no crédito para Pix: limpa o cartão e a fatura e passa a exigir a conta.
- Excluir um lançamento que já foi excluído: "não encontrado".
- Compra no último dia antes do fechamento, editada para o dia do fechamento: vai para a fatura seguinte.
- Compra de antes do primeiro ciclo cadastrado: usa a versão inicial (`CYCLE_EPOCH`, task 7).

## Decisões

- **Compra no crédito não tem conta, só cartão.** A conta que paga vem do cartão. Assim o saldo não depende de lembrar de pular o crédito: a despesa nem aponta para a conta. Se o cartão trocar de conta pagadora, as compras não ficam desatualizadas.
- **Categoria opcional.** "Só o valor é obrigatório" (design). A tela da task 9 já vai sugerir uma, e o que ficar sem categoria aparece como tal.
- **Data futura recusada.** O registro é do que já aconteceu. Parcelas futuras (task 12) e assinaturas (task 13) são geradas pelo app, não digitadas. O módulo de saldo recebe a data `até`, então um lançamento futuro gerado por elas não entra no saldo de hoje.
- **`clientId` único por espaço**, não no banco inteiro. Um `clientId` repetido por outro usuário não revela nem bloqueia nada.
- **Estabelecimento comparado sem acentos e maiúsculas, com restrição no banco.** Nas categorias e contas basta checar no código. Aqui a criação é automática e vai acontecer também pelo sync offline, em paralelo.
- **Janela de 3 faturas para a troca manual.** Cobre compras lançadas com atraso pelo banco sem aceitar uma data qualquer, que deixaria a tela de faturas (task 18) sem sentido.
- **`invoiceOverridden` em vez de comparar com o cálculo.** Sem ele, não dá para saber, depois de uma mudança de ciclo, qual fatura foi escolha sua e qual foi calculada.
- **A correção do dia do cadastro continua "cartão criado hoje"** (task 7), e não "cartão sem lançamentos". Num cartão antigo sem lançamentos, a mudança de dias costuma ser aviso do banco, que só vale dali em diante. O recálculo acima resolve as compras já registradas.
- **Campos de parcela e assinatura ficam para as tasks 12 e 13** (`installmentGroupId`, `installmentNumber/Total` e `recurringRuleId`). A issue pede todos os campos do design, mas esses dependem de regras e da tabela `RecurringRule`, que ainda não existem. Cada um entra com sua migration.
- **Saldo calculado no código, não em SQL.** O servidor busca os lançamentos que mexem em contas, até hoje, e passa para o módulo. A regra fica num lugar só e testada. Para o volume de uma pessoa (milhares de lançamentos), é rápido. Se pesar, dá para agregar no banco depois, com o módulo como referência nos testes.
- **Excluir apaga de verdade.** Contas e categorias são arquivadas porque os lançamentos apontam para elas. Nada aponta para um lançamento.

### Revisão

- Corrigido: a escolha manual de fatura podia ficar impossível de salvar de novo. Isso acontecia quando uma correção do ciclo tirava a fatura escolhida da janela de 3, e editar só a descrição era recusado com "Essa fatura não é deste cartão.". Agora a escolha manual que volta igual, com o mesmo cartão e a mesma data, é mantida sem nova checagem.
- Corrigido: editar um lançamento excluído no meio do caminho, em outra aba ou aparelho, devolve "Lançamento não encontrado." em vez de um erro inesperado. Um id só com espaços conta como vazio.
- Teste novo: o recálculo das faturas depois de uma mudança de ciclo não mexe num pagamento de fatura. Antes, retirar o filtro "só compras no crédito" não quebrava nenhum teste.
- Mudança durante a implementação: `createdById` usa `onDelete: Cascade`. Com `NoAction`, apagar o usuário falhava, porque o Postgres checa essa chave antes de a cascata do espaço apagar os lançamentos. O revisor sugeriu voltar para `NoAction` pensando na fase 2, mas na prática isso quebra a exclusão. Na fase 2, um gasto compartilhado continua no espaço de quem pagou (design), então a cascata segue certa.
- Aceito:
  - **Leitura, validação e gravação fora de uma única transação do banco.** Se o ciclo de um cartão fosse editado no mesmo instante, a compra podia ficar com a fatura do ciclo antigo. Com um usuário por espaço, é improvável, e a edição corrige.
  - **Estabelecimento órfão.** Uma compra repetida pelo sync que perde a corrida, trazendo outro nome, deixa um estabelecimento sem lançamentos. A task 10 deve ignorar, no autocomplete, os estabelecimentos sem lançamentos.
  - **Server Actions sem teste próprio,** como as de contas e cartões. A regra está nos testes do servidor.
- Para a task 9: a tela de edição precisa reenviar a fatura escolhida à mão (`invoiceDueDate`). Sem ela, a edição volta para a fatura calculada.

## Fora do escopo

- Tela de registro (task 9) e lista de lançamentos (task 14).
- Autocomplete, apelidos e sugestões da memória (task 10).
- Criar e editar transferência e pagamento de fatura (task 11). O saldo já os trata.
- Parcelas (task 12) e assinaturas (task 13).
- Estorno no cartão (receita no crédito), que entra com a tela de faturas (task 18).
- Limite disponível do cartão (task 18).
- Conferir saldo com o banco (task 21).
