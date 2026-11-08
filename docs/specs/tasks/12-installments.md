# 12 — Compras parceladas

Issue: #12 · Design: [Regras de domínio](../v1-design.md#regras-de-domínio-que-eu-decidi-o-joão-confere) · [Ciclo da fatura](07-cards.md)

## Objetivo

Registrar uma compra parcelada no crédito de uma vez. Uma compra de 10× vira 10 parcelas, e cada uma conta no seu mês e cai na sua fatura. É o que vai alimentar o "comprometido futuro" do dashboard (task 23) e o valor de cada fatura (task 18).

## Comportamento

### Modelo

- `Transaction` ganha `installmentGroupId?` (o mesmo UUID para todas as parcelas da compra), `installmentNumber?` (1…N) e `installmentTotal?` (N).
- Migration `installments`, com `CHECK`:
  - os três campos estão juntos: todos preenchidos ou todos vazios;
  - preenchidos, só numa despesa no crédito, com N de 2 a 24 e o número da parcela de 1 a N.
- Índice em `installmentGroupId`.
- Cada parcela é um lançamento comum: valor, data, fatura, categoria, estabelecimento e observação próprios. Os campos de parcela só dizem a que compra ela pertence.

### Geração (`src/domain/installments.ts`, com testes)

`planInstallments(compra, n, ciclos)` devolve as N parcelas: número, valor, data e fatura.

- **Valor:**
  - cada parcela recebe o total dividido por N, arredondado para baixo no centavo, e o que sobrar vai para a 1ª;
  - **a soma é sempre exatamente o total;**
  - o total precisa dar pelo menos R$ 0,01 por parcela. Senão: "O valor é pequeno demais para N parcelas.".
- **Data (competência):** a parcela _i_ tem a data da compra + (_i_ − 1) meses, contada sempre a partir do dia original, e o dia que o mês não tem vira o último dia do mês. Uma compra em 31/01 gera 28/02 (ou 29/02 no ano bissexto), 31/03, 30/04, 31/05…
- **Fatura:**
  - a parcela _i_ cai na (_i_ − 1)-ésima fatura depois da fatura da compra, seguindo a sequência de faturas do cartão: cada fatura vem logo depois do fechamento da anterior;
  - com um ciclo só, é o `shiftInvoice` da task 7;
  - **depois de uma mudança de ciclo,** a sequência passa a usar o ciclo novo a partir do dia em que ele começou a valer. É o que o banco faz: as parcelas que faltam caem nas faturas novas, uma por fatura.
  - O cálculo é a função pura `nextInvoice(ciclos, fatura)`: a fatura que recebe as compras do dia seguinte ao fechamento. Se uma versão nova do ciclo começar antes de essa fatura fechar, ela passa a valer a partir do dia em que começou.
- A fatura de cada parcela fica gravada no `invoiceDueDate`, como nas compras à vista.

### Registro

- Na tela de registro, com Despesa e Crédito escolhidos, aparece a opção **"Parcelado"** (um interruptor) com o número de parcelas, de 2× a 24×, num seletor nativo.
- **O valor digitado é o total da compra.** Embaixo dele aparece "3× de R$ 100,00". Quando há sobra, aparece também "(1ª de R$ 100,01)".
- **Parcelado, a troca manual de fatura some.** No lugar dela aparece "1ª parcela na fatura que vence em 10/12". Escolher a fatura de cada parcela à mão fica fora do escopo.
- O aviso diz "Despesa de R$ 300,00 em 3× salva", com o "Desfazer", que exclui a compra inteira.
- Ao trocar para outra forma de pagamento ou para Receita, o "Parcelado" desliga.

### Servidor

- **Criar.** Uma despesa no crédito com `installments: N` (de 2 a 24) cria as N parcelas numa só operação no banco: ou entram todas, ou nenhuma.
  - Só vale para despesa no crédito. Em outro caso, o Zod recusa: "Só compras no crédito podem ser parceladas.".
- **Idempotência.** A 1ª parcela leva o `clientId` do aparelho, e as outras levam `clientId:2`, `clientId:3` e assim por diante. Repetir o envio devolve a compra que já existe, como nas compras à vista. Duas chamadas ao mesmo tempo resultam numa compra só.
- **Excluir** recebe um escopo:
  - **"só esta":** exclui só aquela parcela. As outras continuam com o número e o total que tinham. É o caso de uma parcela estornada;
  - **"esta e as próximas":** exclui a parcela e as de número maior, e mantém as anteriores;
  - num lançamento que não é parcela, o escopo não importa.
- **Editar uma parcela** também recebe o escopo, "só esta" ou "esta e as próximas":
  - a categoria, o estabelecimento e a observação mudam no escopo escolhido;
  - o valor muda só em "só esta", para o caso de IOF ou ajuste do banco;
  - a data, o cartão, a forma de pagamento e o tipo de uma parcela não mudam. A mensagem é "Para mudar a data ou o cartão de uma compra parcelada, exclua e registre de novo.". A tela de edição é da task 14.
- **Mudança no ciclo do cartão.** O recálculo da task 8 passa a tratar as parcelas: as parcelas de um grupo cuja fatura ainda não fechou são refeitas pela sequência de faturas. As que já fecharam ficam como estão.
- **Contagens de uso.** As categorias mais usadas (task 9) e a memória por estabelecimento (task 10) contam uma compra parcelada uma vez só: contam a 1ª parcela e ignoram as outras. Sem isso, uma compra de 10× valeria por 10 e, com as datas futuras, ficaria no topo por meses.

## Critérios de aceite

- [ ] CA1 — Unitário: 10× de R$ 1.000,01 dá 1ª de R$ 100,01 e as outras de R$ 100,00, e 3× de R$ 100,00 dá R$ 33,34 + R$ 33,33 + R$ 33,33. O exemplo da issue (1ª de R$ 100,10 e as outras de R$ 99,99) não segue a regra: ver Decisões.
- [ ] CA2 — Unitário: uma compra em 31/01 gera datas de dias válidos (28/02 em 2026, 29/02 em 2028, 31/03, 30/04), sempre a partir do dia original.
- [ ] CA3 — Unitário por propriedade: para todo N de 2 a 24 e milhares de totais, a soma das parcelas é exatamente o total, nenhuma parcela fica com menos de R$ 0,01, e só a 1ª pode ser maior que as outras.
- [ ] CA4 — Unitário:
  - com um ciclo só, a fatura da parcela _i_ é `shiftInvoice(fatura da compra, i − 1)`, por propriedade em todos os ciclos;
  - com uma mudança de ciclo, as parcelas seguintes caem nas faturas do ciclo novo, uma por fatura, sem pular nenhuma nem repetir.
- [ ] CA5 — Integração:
  - criar 3× grava 3 parcelas com o mesmo grupo, números 1 a 3, valores, datas e faturas certos;
  - o saldo da conta não muda;
  - o resumo das faturas (task 11) mostra uma parcela em cada fatura;
  - o mesmo `clientId`, em sequência e em paralelo, não duplica;
  - outro espaço não vê nem mexe.
- [ ] CA6 — Integração:
  - excluir "esta e as próximas" na 3ª de 5 mantém a 1ª e a 2ª;
  - "só esta" exclui só ela;
  - editar a categoria com "esta e as próximas" muda da parcela escolhida em diante;
  - mudar a data de uma parcela é recusado.
- [ ] CA7 — Integração: mudar o ciclo do cartão refaz as faturas das parcelas que ainda não fecharam e não mexe nas fechadas.
- [ ] CA8 — Integração: uma compra de 10× conta uma vez nas categorias mais usadas e na memória do estabelecimento.
- [ ] CA9 — E2E (Chromium e iPhone/WebKit):
  - registrar R$ 300,00 em 3× mostra "3× de R$ 100,00" e o aviso "Despesa de R$ 300,00 em 3× salva";
  - no "Pagar fatura", a fatura aberta aparece com R$ 100,00 a pagar, e as futuras também;
  - o "Desfazer" apaga as 3 parcelas.
- [ ] CA10 — Lint, format, test, build, `test:e2e:docker` e CI verdes. Tela conferida no iPhone (viewport) e no desktop.

## Casos de borda

- R$ 0,05 em 10×: recusado, porque o valor é pequeno demais.
- Compra no dia do fechamento: a 1ª parcela já vai para a fatura seguinte (task 7), e as outras vêm depois.
- Compra em 29/02/2028 em 12×: as parcelas de 2029 ficam em 28/02/2029.
- Um cartão arquivado depois da compra: as parcelas continuam nele. Arquivar não apaga nada.
- "Desfazer" depois de pagar a fatura da 1ª parcela: a compra some, e o pagamento fica, mostrando crédito a favor na fatura.

## Decisões

- **O exemplo da issue tem um erro de conta.** R$ 1.000,01 ÷ 10 = R$ 100,001. A regra do design ("os centavos que sobram vão para a 1ª") dá R$ 100,01 + 9 × R$ 100,00. A issue diz R$ 100,10 + 9 × R$ 99,99, o que soma o mesmo total, mas tira 9 centavos das outras parcelas sem motivo. Sigo o design e corrijo o CA1. **Confira se concorda.**
- **O valor digitado é o total.** É como a compra aparece no recibo e na maquininha ("R$ 300 em 3×").
- **Parcelas seguem a sequência de faturas do cartão,** e não o ciclo da data da compra para sempre. Sem isso, depois de uma mudança de ciclo as parcelas iam cair em vencimentos que o cartão não tem mais. Essa era a decisão que a task 7 deixou para cá.
- **Cada parcela é um lançamento,** sem tabela de grupo. A fatura, o saldo e as somas já funcionam por lançamento. O grupo só serve para editar e excluir juntas e para mostrar "3/10".
- **`clientId` derivado (`clientId:N`)** para as parcelas seguintes. O índice único continua garantindo que um reenvio não duplique, sem mudar a fila offline (task 16), que só conhece um id por registro.
- **Sem troca manual de fatura no parcelado.** É raro, e a fatura de uma parcela já pode ser corrigida pela edição "só esta" (task 14).
- **"Só esta" não renumera.** A parcela 3 de 10 continua sendo a 3 de 10 depois de excluir a 2, porque é assim que o extrato mostra.

## Fora do escopo

- Parcelamento sem cartão (boleto ou carnê).
- Juros de parcelamento: o total digitado já é o que você paga.
- Registrar parcelamentos em andamento ("parcela 3 de 10"), que entram com o onboarding (task 22).
- A tela de edição e a lista de lançamentos (task 14).
- A tela de faturas (task 18).
