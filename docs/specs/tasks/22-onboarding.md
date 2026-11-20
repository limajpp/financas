# 22 — Onboarding: primeiro uso

Issue: #22 · Design: [Regras de domínio](../v1-design.md#regras-de-domínio-que-eu-decidi-o-joão-confere) · [Contas](06-accounts.md) · [Cartões](07-cards.md) · [Parcelas](12-installments.md) · [Assinaturas](13-subscriptions.md)

## Objetivo

Quem começa a usar o app já tem saldo nas contas, faturas abertas, compras parceladas pela metade e assinaturas rodando. Sem isso, as faturas e o "comprometido futuro" (task 23) nascem errados. Um assistente curto, logo depois do cadastro, registra esse estado inicial. Ele é pulável e retomável.

## Comportamento

### Quando aparece

- **Depois de criar a conta,** o app vai para `/comecar`, e não para o início.
- **"Pular por agora"** leva ao início. Enquanto o onboarding não for concluído, o início mostra um cartão "Termine de configurar o app", com:
  - **"Continuar"**, que volta para `/comecar`;
  - **"Não mostrar mais"**, que dá o onboarding por concluído.
- **"Concluir"** (no último passo, ou em qualquer passo depois do primeiro) marca o espaço como configurado (`Space.onboardedAt`) e leva ao início, com tudo já refletido.
- **Quem já usa o app** não vê o onboarding. A migration marca como configurado todo espaço que já tem alguma conta.
- **Retomável:** cada item é salvo assim que você o adiciona. Voltar a `/comecar` mostra o que já foi cadastrado em cada passo.

### A tela `/comecar`

- **Quatro passos**, com "Passo 2 de 4", o título do passo e os botões "Voltar", "Pular este passo" (ou "Próximo", quando o passo já tem algo) e "Pular por agora". O passo fica na URL (`?passo=1..4`).
- **Cada passo** lista o que já foi cadastrado e tem um botão para adicionar mais um.

#### Passo 1 — Contas

- "Quais contas você usa? Informe o saldo de hoje de cada uma."
- "Adicionar conta" abre o mesmo diálogo de `/contas` (task 6), com a data do saldo em hoje.

#### Passo 2 — Cartões e faturas

- "Quais cartões de crédito você usa?"
- "Adicionar cartão" abre o mesmo diálogo de `/contas` (task 7). Sem nenhuma conta, o passo pede uma conta primeiro, como em `/contas`.
- **Para cada cartão,** uma linha pergunta "Quanto já tem na fatura aberta (vence em 10/12)?", com o valor que o app do banco mostra hoje, incluindo as parcelas. Salvar grava o valor, e salvar de novo substitui.
- **Se a fatura anterior já fechou e ainda não venceu,** aparece também "E a fatura fechada que vence em 10/11, ainda sem pagar?". Assim, o "Pagar fatura" (task 11) já sai com o valor certo.
- **Cada valor vira um "saldo anterior da fatura":** um ajuste no crédito (como o da task 21), naquela fatura. Ele entra no total da fatura, mas não é gasto de nenhum mês: as compras dele aconteceram antes do app.

#### Passo 3 — Parcelamentos em andamento

- "Tem compras parceladas que ainda não acabaram?"
- **"Adicionar parcelamento"** pede:
  - o cartão;
  - o que foi (opcional);
  - a categoria (opcional, de despesa);
  - a parcela atual e o total, por exemplo "3 de 10";
  - o valor de cada parcela.
- **Gera só as parcelas restantes,** da atual até a última. "3 de 10, R$ 150" cria 8 parcelas de R$ 150:
  - a 3ª na fatura aberta, e as seguintes uma por fatura (`invoiceSequence`, task 12);
  - todas no mesmo grupo, com o total 10 e os números 3 a 10, como um parcelamento cujas primeiras parcelas foram apagadas (task 12);
  - a data da parcela _k_ é a da compra mais _k_ − 1 meses, com a data da compra estimada em hoje menos (atual − 1) meses. Assim, cada parcela conta no mês dela, como manda o design.
- **A parcela atual já está no valor da fatura aberta informado no passo 2.** Para não contar duas vezes, o valor dela sai do saldo anterior daquela fatura, que nunca fica negativo. A tela avisa: "A parcela 3 (R$ 150,00) já fazia parte da fatura aberta informada."
- **A ordem não importa:** o saldo anterior é sempre o valor informado menos o que o app já tem naquela fatura: as parcelas do onboarding, as compras e os estornos registrados desde então e as cobranças de assinatura. O valor do banco já inclui tudo isso. Assim, informar a fatura depois de usar o app (pulou e voltou), ou de novo, não conta nada duas vezes.
- **"O que foi"** é o estabelecimento, achado ou criado como no registro (task 10).
- **"1 de 1",** a atual igual ao total, ou um valor zero são recusados.

#### Passo 4 — Assinaturas ativas

- "Quais assinaturas você paga todo mês?"
- **"Adicionar assinatura"** pede:
  - o que foi;
  - o valor;
  - o dia da cobrança;
  - a forma de pagamento, com a conta ou o cartão;
  - a categoria (opcional, de despesa).
- **Cria só a regra, sem cobrança agora.** A cobrança deste mês, se já aconteceu, já está no saldo informado ou na fatura aberta. A primeira cobrança gerada pelo app é a primeira depois de hoje. Por exemplo, dia 8 com hoje em 15/11 começa em 08/12, e dia 20 começa em 20/11.
- A assinatura aparece em `/assinaturas` (task 19) como qualquer outra.
- **A mesma assinatura ativa duas vezes** (o mesmo estabelecimento, valor, dia e forma) é recusada: "Essa assinatura já está cadastrada." Isso evita a duplicata de um toque duplo.

### O saldo anterior da fatura

- **No modelo, é um ajuste no crédito:** `type: EXPENSE`, `method: CREDIT`, `adjustment: true`, com o cartão e a fatura, sem conta, sem categoria e sem estabelecimento. A observação é "Saldo anterior da fatura".
- **A migration** amplia o `CHECK` dos ajustes (task 21): além do ajuste numa conta, aceita uma despesa no crédito, com cartão.
- **Um por cartão e por fatura:** o `clientId` é `opening:<cartão>:<vencimento>`. Gravar de novo substitui o valor, e zero apaga.
- **A data é a de hoje.** A fatura é escolhida (`invoiceOverridden`): uma mudança nos dias do cartão não a move.
- **As parcelas do onboarding** têm o `clientId` com o prefixo `onboarding:`. É assim que o passo 3 as lista.
- **Fica fora dos indicadores,** como todo ajuste (task 21). Entra no total da fatura e no "Pagar fatura".
- **Na lista,** aparece como "Saldo anterior da fatura", na linha "Cartão Roxo · Antes do app". No detalhe da fatura, onde o cartão já está no título, a linha é "15/11/2026 · Antes do app".
- **Não se edita, só se exclui,** como os outros ajustes. O diálogo explica: enquanto a fatura estiver aberta, informe o valor de novo em "Começar" (com o link); depois, exclua e registre a diferença como uma compra.

### Servidor

- **`src/domain/onboarding.ts`**, funções puras com testes:
  - `ongoingInstallments({ atual, total, valor }, ciclos, hoje)`: as parcelas restantes, com número, data e fatura;
  - `firstChargeMonth(dia, hoje)`: o mês da primeira cobrança depois de hoje;
  - `openingInvoices(ciclos, hoje)`: a fatura aberta e, se ainda não venceu, a fechada anterior.
- **`setOpeningBalance(spaceId, userId, cartão, vencimento, valor)`** grava ou substitui o saldo anterior. A fatura precisa ser uma das de `openingInvoices`.
- **`createOngoingInstallments`** cria as parcelas restantes de uma vez e desconta a atual do saldo anterior, numa transação do banco. É idempotente pelo `clientId`, como a compra parcelada (task 12).
- **Os dois travam o cartão** (`FOR UPDATE`) antes de ler e gravar o saldo anterior: um parcelamento e um valor de fatura gravados ao mesmo tempo não se perdem.
- **`createSubscriptionRule`** cria a regra sem cobrança, com `firstMonth` e `nextMonth` no mês da primeira cobrança. Valida como a edição de assinatura (task 19), e o estabelecimento é achado ou criado como no registro (task 10).
- **`finishOnboarding(spaceId)`** grava `Space.onboardedAt`.
- **Server Actions com Zod** para cada um. Tudo restrito ao espaço.

## Critérios de aceite

- [x] CA1 — Unitário e integração: "3 de 10, R$ 150" gera 8 parcelas, números 3 a 10, de R$ 150. A 3ª fica na fatura aberta e as seguintes, uma por fatura. As datas vão mês a mês.
- [x] CA2 — Integração:
  - o valor da fatura aberta aparece no total da fatura atual e no "Pagar fatura";
  - gravar de novo substitui;
  - o valor fica fora de `spendingByCategory`;
  - com um parcelamento, a parcela atual sai do saldo anterior, e o total da fatura continua o informado.
- [x] CA3 — Unitário e integração: a assinatura cadastrada no onboarding não gera cobrança hoje, e a primeira cobrança sai na primeira data depois de hoje.
- [x] CA4 — Integração:
  - outro espaço não usa cartão, conta ou categoria alheia;
  - fatura fora das permitidas, "1 de 1" e valor zero são recusados;
  - repetir o mesmo `clientId` não duplica.
- [x] CA5 — E2E (Chromium e iPhone/WebKit):
  - o cadastro leva a `/comecar`;
  - "Pular por agora" leva ao início, com o cartão "Termine de configurar o app", e o app funciona (registrar uma despesa);
  - "Não mostrar mais" tira o cartão.
- [x] CA6 — E2E: um onboarding completo (conta, cartão com fatura aberta, um parcelamento e uma assinatura) termina no início, e `/faturas` mostra a fatura aberta e as próximas certas.
- [x] CA7 — Lint, format, test, build, `test:e2e:docker` e CI verdes. Telas conferidas no desktop e no viewport do iPhone.

## Casos de borda

- **O app foi aberto em outro aparelho** com o onboarding pela metade: `/comecar` mostra o que já existe.
- **Um parcelamento num cartão sem saldo anterior informado:** as parcelas são criadas normalmente, e não há o que descontar.
- **A parcela atual maior que o saldo anterior:** o saldo anterior vai a zero e é apagado. O total da fatura passa a ser a parcela.
- **Um cartão criado com dias errados e corrigido depois** (task 7, no mesmo dia): o saldo anterior e a parcela atual ficam na fatura em que foram gravados, porque ela foi escolhida, e não calculada. As parcelas seguintes são reprogramadas a partir dela. Para acertar tudo, exclua o saldo anterior antigo e o parcelamento (na lista ou na fatura) e informe a fatura e o parcelamento de novo.
- **Excluir um parcelamento do onboarding** não devolve o valor ao saldo anterior. Para corrigir, informe a fatura aberta de novo no passo 2.
- **A tela aberta de um dia para o outro,** passando o fechamento ou o vencimento da fatura: gravar o valor é recusado com "Essa fatura mudou (fechou ou venceu). Atualize a página."
- **Um parcelamento do onboarding não tem a parcela 1.** Como numa compra cujas primeiras parcelas foram apagadas (task 12), o ranking de estabelecimentos e o lembrete, que contam uma compra pela parcela 1, não o contam. O "valor total" da lista soma só as parcelas restantes.

## Decisões

- **O cadastro leva ao onboarding,** em vez de só um convite no início. É o "logo após o cadastro" da issue. O convite no início cobre quem pulou.
- **O saldo anterior é um ajuste, não um gasto.** Ele é a soma de compras de antes do app: contar como gasto do mês distorceria o mês de quem começa.
- **A parcela atual sai do saldo anterior,** em vez de pedir uma fatura aberta "sem as parcelas". O valor que o banco mostra é o que a pessoa sabe digitar.
- **A assinatura não cobra agora.** O saldo de hoje já tem as cobranças passadas.
- **Os passos reaproveitam os diálogos de `/contas`.** Nada de dois formulários de conta e de cartão.

## Revisão

O revisor (Opus, effort high) aprovou com nits. Corrigido:

- **Contar duas vezes ao informar a fatura depois de usar o app:** quem pulava o onboarding, registrava uma compra no crédito (ou tinha uma cobrança de assinatura gerada) e voltava contava a compra duas vezes. Agora o saldo anterior é o valor informado menos tudo o que o app já tem naquela fatura (compras menos estornos), e não só as parcelas do onboarding. Há teste com compra, estorno e cobrança de assinatura.
- **Um valor digitado se perdia ao tocar em "Próximo":** o campo agora grava ao sair dele. "Salvar" logo depois não grava de novo.
- **O diálogo do saldo anterior mandava a um "Começar" sem caminho:** agora tem o link e diz o que fazer depois que a fatura fecha.
- **Travas:** `FOR UPDATE` no cartão e no espaço conflitava com a trava que um lançamento novo põe neles (chave estrangeira) e podia dar deadlock. Agora é `FOR NO KEY UPDATE`, que ainda serializa o onboarding.
- **O caso do cartão corrigido no mesmo dia:** a spec agora manda excluir o saldo anterior antigo. Há teste de que o saldo anterior e a parcela atual ficam, e as seguintes seguem os dias novos.
- **Fatura que mudou com a tela aberta:** mensagem própria.
- **Os botões "Salvar"** dizem, para o leitor de tela, de qual fatura e cartão são.
- **Testes novos:** cartão arquivado e a correção dos dias.
- **Segunda rodada: aprovado.** O nit aplicado: o e2e do CA6 digita o valor da fatura e toca em "Próximo" sem "Salvar", volta e confere que ficou.
- **O e2e:** o cadastro agora passa pelo onboarding antes do início. O limite de cada teste subiu de 30 para 45 s, porque alguns testes longos ficavam no limite com a suíte toda em paralelo.

Aceito:

- **Com a parcela maior que o valor informado,** o saldo anterior é apagado e o campo volta vazio. Raro, e o total da fatura continua certo.
- **A fatura fechada oferecida usa o ciclo de hoje.** Só difere logo depois de uma mudança de dias, e os cartões do onboarding são novos.
- **Uma parcela atual com a data ajustada ao fim do mês** (comprada dia 31) pode ter, pela data, uma fatura anterior à aberta em que fica. Não tem efeito: o grupo se ancora na fatura gravada (task 12).

## Fora do escopo

- Importar extratos ou faturas.
- Parcelamentos fora do cartão (boleto, crediário).
- Receitas recorrentes (salário).
- Um tour pelas telas do app.
