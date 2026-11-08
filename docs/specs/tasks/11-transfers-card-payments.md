# 11 — Transferência entre contas e pagamento de fatura

Issue: #11 · Design: [Regras de domínio](../v1-design.md#regras-de-domínio-que-eu-decidi-o-joão-confere) · [Decisões do João](../v1-design.md#decisões-do-joão)

## Objetivo

Registrar o dinheiro que muda de lugar sem ser gasto: passar de uma conta para outra e pagar a fatura do cartão. Os dois mexem no saldo das contas, mas não entram em nenhum indicador de gasto ou receita. O modelo e o módulo de saldo já tratam os dois tipos desde a task 8; esta task traz as regras de criação e as telas.

## Comportamento

### Transferência (`TRANSFER`)

- **Campos:**
  - conta de origem (`accountId`) e conta de destino (`toAccountId`), as duas do espaço e ativas;
  - valor (de R$ 0,01 a R$ 20.000.000,00);
  - data (de 2000 até hoje);
  - forma: Pix, TED ou dinheiro. Dinheiro cobre o saque e o depósito, quando existe uma conta "Carteira";
  - observação opcional.
- **Origem e destino iguais são recusados:** "Escolha contas diferentes." O banco já recusa por `CHECK` (task 8).
- Sem categoria e sem estabelecimento.
- **Saldo:** − na origem e + no destino (task 8).

### Pagamento de fatura (`CARD_PAYMENT`)

- **Campos:**
  - o cartão: pode estar arquivado, porque a última fatura de um cartão cancelado ainda se paga;
  - a fatura, identificada pelo vencimento (`invoiceDueDate`);
  - a conta que paga (`accountId`): ativa, com a conta do cartão como padrão;
  - valor, data e observação, com as mesmas regras da transferência;
  - forma: Pix, boleto, débito (o débito automático) ou TED.
- **A fatura precisa ser deste cartão.** Ela vale quando alguma compra do cartão cai nela, ou quando é uma das 12 faturas anteriores à aberta, a própria aberta ou a seguinte, pelo ciclo atual. Fora disso: "Essa fatura não é deste cartão."
- **Qualquer valor é aceito.** Pagar menos deixa a fatura com saldo em aberto; pagar mais deixa crédito. Juros e rotativo ficam fora do escopo.
- Sem categoria e sem estabelecimento.
- **Saldo:** − na conta que paga (task 8). A compra no crédito continua sem mexer no saldo.

### Resumo das faturas (`src/domain/invoices.ts`, com testes)

- `invoiceSummaries(compras, pagamentos, ciclos, hoje)` devolve, por vencimento:
  - o fechamento;
  - o total das compras no crédito daquela fatura;
  - o total pago;
  - o saldo em aberto (total − pago);
  - o status: **fechada** (o fechamento já chegou), **aberta** (a que recebe as compras de hoje) ou **futura** (fecha depois da aberta: parcelas, ou compras antigas depois de uma mudança de ciclo).
- `invoiceForDueDate(ciclo, vencimento)` devolve a fatura daquele vencimento: o fechamento sai do vencimento. Quando `dueDay ≤ closingDay`, o fechamento é no mês anterior ao do vencimento. É a função que a revisão da task 7 pediu para a task 12, adiantada aqui.
- A tela de faturas (task 18) vai usar o mesmo resumo.

### Fora dos indicadores (`src/domain/totals.ts`, com testes)

- `spendingByCategory(lançamentos)` soma as despesas por categoria, inclusive as compras no crédito, que contam no mês da compra (design). `incomeByCategory` faz o mesmo para as receitas.
- **Transferência e pagamento de fatura nunca entram nessas somas.**
- Os indicadores do dashboard (task 23) partem dessas funções. Hoje, as únicas somas que existem, a das categorias mais usadas (task 9) e a da memória (task 10), já filtram por despesa e receita.

### Telas

- **Registro (`/registrar`):** o seletor do topo ganha a terceira opção, **Transferência**. Escolhida, ela:
  - esconde "O que foi?" e as categorias;
  - troca a linha "conta · forma" por duas linhas, **De** e **Para**, cada uma abrindo a lista de contas ativas, mais a forma (Pix, TED, Dinheiro);
  - mantém o valor, a data e "Mais detalhes", só com a Observação;
  - salva como "Salvar transferência", e o aviso diz "Transferência de R$ 500,00 salva", com o "Desfazer".
- **Padrões da transferência:** a última origem e o último destino usados. Sem histórico, a primeira e a segunda conta ativas, em ordem alfabética. Com menos de duas contas ativas, a opção mostra "Cadastre outra conta para transferir." no lugar do formulário.
- **Contas (`/contas`):** cada cartão ganha o botão **"Pagar fatura"**. Ele abre um diálogo com:
  - **Fatura:** um seletor nativo com as faturas que têm saldo em aberto, mais a aberta. Cada opção mostra o vencimento e quanto falta, curto o bastante para o celular: "10/11 · R$ 1.234,56 a pagar", ou "10/12 (aberta) · R$ 300,00 a pagar". O padrão é a fechada mais antiga com saldo em aberto; sem nenhuma, a aberta;
  - **Valor:** já preenchido com o saldo em aberto da fatura escolhida, e atualizado quando você troca de fatura, se ainda não tiver mexido no valor;
  - **Conta que paga:** a conta do cartão como padrão;
  - **Forma:** a última usada num pagamento de fatura; sem histórico, Pix;
  - **Data:** hoje.
  - Salvar fecha o diálogo, atualiza o saldo e mostra "Pagamento de R$ 1.234,56 salvo", com o "Desfazer".
- O pagamento também é idempotente pelo `clientId`, como os outros lançamentos.

### Servidor

- `createTransfer` e `createCardPayment` (`src/server/transactions.ts`) seguem o `createTransaction`: idempotência pelo `clientId`, tudo restrito ao espaço e validação por funções puras (`validateTransfer` e `validateCardPayment`).
- `cardInvoices(spaceId, cardId)` devolve os resumos para o diálogo.
- **Server Actions com Zod:** criar a transferência e criar o pagamento. Excluir usa a action que já existe (`deleteTransactionAction`), que serve ao "Desfazer".
- **Editar** transferências e pagamentos continua recusado (`NOT_EDITABLE`, task 8). A edição de todos os tipos vem com a lista de lançamentos (task 14).

## Critérios de aceite

- [ ] CA1 — Unitário e integração: a transferência reduz a origem e aumenta o destino, e o pagamento de fatura reduz a conta que paga.
- [ ] CA2 — Unitário: transferência e pagamento de fatura não entram em `spendingByCategory` nem em `incomeByCategory`. As compras no crédito entram como qualquer despesa. Filtrar pelo mês da compra fica para quem chama: o dashboard, na task 23.
- [ ] CA3 — Unitário, Zod e integração: origem e destino iguais são recusados, com a mensagem própria.
- [ ] CA4 — Unitário: `invoiceSummaries` (total, pago, em aberto, aberta ou fechada, pagamento parcial e a maior) e `invoiceForDueDate`, inclusive com `dueDay ≤ closingDay` e com meses curtos.
- [ ] CA5 — Integração:
  - pagamento de uma fatura deste cartão: aceito, e com cartão arquivado também;
  - fatura que não é do cartão: recusada;
  - conta ou cartão de outro espaço: "não encontrado";
  - o mesmo `clientId` não duplica.
- [ ] CA6 — E2E (Chromium e iPhone/WebKit):
  - transferir R$ 500,00 de Banco Azul para Banco Verde pelo registro muda os dois saldos em `/contas`;
  - pagar a fatura pelo diálogo vem com o total das compras já preenchido e reduz o saldo da conta.
- [ ] CA7 — Lint, format, test, build, `test:e2e:docker` e CI verdes. Telas conferidas no iPhone (viewport) e no desktop.

## Casos de borda

- Transferência com origem e destino iguais na tela: o botão Salvar fica desativado, com a dica "Escolha contas diferentes.".
- A conta de destino é arquivada entre abrir a tela e salvar: aparece o erro da task 8 ("Essa conta está arquivada. Escolha outra.").
- Fatura sem compras e sem pagamentos (a aberta, recém-começada): aparece com R$ 0,00 em aberto. O valor fica vazio, para você digitar.
- Pagamento a mais: a fatura aparece com o crédito ("R$ 50,00 a favor").
- "Desfazer" depois de pagar: o saldo da conta e o em aberto da fatura voltam.

## Decisões

- **Pagar fatura em `/contas`, não no registro.** O cartão e a fatura aberta já aparecem ali, e o pagamento acontece uma vez por mês, não no meio do dia. O registro fica com as três opções que se usam no dia a dia. A tela de faturas (task 18) vai ter o mesmo botão.
- **Qualquer valor no pagamento.** Pagar o mínimo, parcelar ou adiantar é comum. O app registra o que saiu da conta e mostra o que falta, sem calcular juros.
- **Cartão arquivado pode receber pagamento,** mas não compras novas. Cancelar o cartão não cancela a última fatura.
- **A fatura do pagamento é validada contra as compras e o ciclo atual,** e não pela janela de ±3 da troca manual (task 8). Uma fatura antiga, com saldo em aberto, precisa continuar pagável.
- **`invoiceForDueDate` entra agora:** o resumo precisa do fechamento de cada vencimento, e a task 12 vai usar a mesma função.
- **Somas por categoria num módulo próprio** (`totals.ts`), para que a regra "transferência e pagamento não são gasto" fique testada num lugar só antes do dashboard.
- **Dinheiro na transferência** cobre saque e depósito para quem tem uma conta "Carteira". Para quem não tem, um saque continua sendo uma despesa em dinheiro.

### Revisão

O revisor (Opus, effort high) aprovou com nits. Tudo foi aplicado, menos o que está como aceito.

- **Status da fatura.** "Aberta" valia para toda fatura com fechamento no futuro. Com parcelas, o seletor mostraria várias "(aberta)". Agora há três estados: fechada, aberta (só a que recebe as compras de hoje) e futura, com o rótulo "(futura)". O padrão do diálogo nunca escolhe uma futura.
- **Valor do diálogo.** Tocar no valor e sair do campo contava como "mexeu", e o valor parava de acompanhar a troca de fatura. Agora só conta uma mudança de verdade.
- **`/contas` com N+1.** Eram três consultas por cartão. Agora são uma agregação para todos os cartões e uma para o último pagamento, com os ciclos que a lista de cartões já traz. As consultas também passaram a filtrar pelo espaço.
- **Testes mais fortes:**
  - a fronteira entre aberta e fechada no dia do fechamento;
  - duas versões do ciclo com o mesmo vencimento, em que vale o fechamento da mais nova;
  - a fatura de mais de 12 ciclos atrás, pagável porque tem compras;
  - a memória da transferência, que não muda com uma despesa.
- **Nits:**
  - o ano aparece no seletor quando a fatura não é deste ano;
  - fatura fechada com crédito a favor aparece no seletor;
  - trocar o tipo no registro gera um `clientId` novo, para um reenvio depois de erro de rede não reaproveitar o lançamento do outro tipo;
  - "Mais detalhes · preenchidos" não conta os campos escondidos na transferência.
- **Desvio da spec:** a conta de destino arquivada mostra "A conta de destino está arquivada. Escolha outra.", em vez da mensagem genérica da task 8. Assim se sabe qual das duas.
- **Aceito:** depois de uma mudança de ciclo, uma fatura antiga ainda não fechada aparece como futura, e o padrão do diálogo é a aberta. Ela continua na lista para ser escolhida.

## Fora do escopo

- Pagamento parcial com juros e rotativo.
- Estorno no cartão (task 18).
- Editar transferências e pagamentos, e a lista de lançamentos (task 14).
- Tela de faturas (task 18).
- Transferência entre espaços (fase 2).
