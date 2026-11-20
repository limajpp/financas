# 23 — Módulo de métricas

Issue: #23 · Design: [Indicadores](../v1-design.md#indicadores-e-insights-v1-por-regras) · [Regras de domínio](../v1-design.md#regras-de-domínio-que-eu-decidi-o-joão-confere) · [Totais](21-reconcile-balance.md)

## Objetivo

Os números do dashboard (task 25) precisam ser certos e explicáveis. Esta task faz só os cálculos: funções puras em `src/domain/metrics.ts`, testadas com um conjunto fixo de dados inventados e resultados calculados à mão, e uma função do servidor que junta os dados de um mês. Não tem tela.

## O que entra nas contas

- **Despesa e receita** são os lançamentos `EXPENSE` e `INCOME`, pela data de cada um (a competência).
  - **Uma compra no crédito conta no mês da compra,** e não no da fatura.
  - **Uma parcela conta no mês dela.** Uma compra de 10× em 28/10 conta R$ 100 por mês, de outubro a julho (design).
  - **Uma cobrança de assinatura conta no mês dela.**
- **Ficam de fora:** transferências, pagamentos de fatura e ajustes. Isso vale para os ajustes de conferência (task 21) e para os saldos anteriores de fatura (task 22). A regra é a de `src/domain/totals.ts`.
- **Um estorno no crédito** (task 18) é uma receita, como em `incomeByCategory`. Veja as Decisões.
- **Antes de calcular,** as cobranças de assinatura vencidas são geradas (task 13).

## As métricas

Todas são de um mês (`YYYY-MM`), com hoje no fuso de São Paulo. O dinheiro é em centavos.

### Sobra e taxa de poupança

- **Receitas, despesas e sobra:** a sobra é receitas − despesas, e pode ser negativa.
- **Taxa de poupança:** sobra ÷ receitas, como uma fração (0,25 = 25%), que pode ser negativa.
  - **Sem receita no mês,** a taxa é indefinida (`null`), e nunca há divisão por zero.

### Fixos × variáveis

- **Fixo** é uma despesa que se encaixa em pelo menos um destes (design):
  - uma cobrança de assinatura (`recurringRuleId`);
  - uma parcela (`installmentGroupId`);
  - uma despesa de categoria marcada como fixa (`isFixed`), ou cuja categoria-mãe é fixa. Por exemplo, Aluguel e Contas da casa.
- **Variável** é toda outra despesa, inclusive a sem categoria.
- **O mês tem os dois totais.** Fixos + variáveis = despesas.

### Projeção do mês

Só para o mês atual. Um mês passado não tem projeção: o real já é o valor final. Um mês futuro também não tem.

- **Ritmo diário dos variáveis:** os variáveis de 1º até hoje ÷ o número de dias até hoje, contando hoje. No dia 10, são 10 dias.
- **Fixos que ainda vão cair**, depois de hoje, neste mês:
  - as parcelas já registradas com data depois de hoje;
  - as cobranças das assinaturas ativas que ainda não saíram neste mês. São as de cursor (`nextMonth`) até este mês e dia de cobrança depois de hoje.
- **Despesa projetada** = as despesas até hoje + o ritmo × os dias que faltam + os fixos que ainda vão cair.
  - O ritmo × os dias é arredondado para o centavo mais próximo.
  - No último dia do mês, não faltam dias e a projeção é a despesa real.
- **Sobra projetada** = as receitas do mês − a despesa projetada.
  - As receitas são só as já registradas: a v1 não tem receita recorrente (fora do escopo da task 22).

### Comprometido futuro

O que já está contratado para os próximos 6 meses, a partir do mês seguinte ao atual.

- **Mês a mês:**
  - as parcelas com data naquele mês (pelo mês da parcela, e não pela fatura);
  - mais o valor das assinaturas ativas. Uma assinatura pausada ou cancelada não entra.
- **O total dos 6 meses** e o total das parcelas a partir do mês seguinte, mesmo depois dos 6 meses ("faltam R$ 1.200 em parcelas").
- **Os saldos anteriores de fatura** (task 22) ficam de fora. São compras de antes do app, e não um gasto futuro.

### Categorias e a média dos 3 meses anteriores

- **O total das despesas do mês por categoria principal:** uma subcategoria soma na mãe. Por exemplo, Mercado e Restaurante somam em Alimentação.
  - "Sem categoria" é uma linha à parte.
  - Cada linha também tem as subcategorias, para o detalhe.
- **A média dos 3 meses anteriores** de cada categoria: a soma dos 3 meses ÷ 3, arredondada para o centavo. Um mês sem gasto na categoria conta como zero.
- **Uma categoria sem gasto no mês** aparece quando a média dela não é zero: é o "este mês você não gastou com isso".
- **A ordem:** o maior total primeiro, depois a maior média, depois o nome.
- **A média só existe com histórico suficiente:**
  - é preciso que o app estivesse em uso desde o começo do 1º desses 3 meses, ou antes;
  - "em uso" quer dizer a data de criação do espaço, ou do saldo inicial mais antigo, se for antes;
  - sem isso, a média é `null`, e não zero. É o "médias ocultas até existir histórico" do design.
  - Por exemplo, com o espaço criado em 30/10, a média de janeiro (out–dez) não aparece, porque outubro foi parcial. A de fevereiro (nov–jan) aparece.
- **O destaque** ("acima de 25% e de R$ 50") é um insight, e fica para a task 24.

### Evolução de 6 meses

- **Para o mês escolhido e os 5 anteriores,** receitas, despesas, sobra, fixos e variáveis de cada mês, do mais antigo ao mais novo.
- **Os meses antes do uso do app** vêm marcados (`beforeHistory: true`), para o gráfico não mostrar como zero o que não foi registrado.

## Regras e servidor

- **`src/domain/metrics.ts`,** funções puras sobre uma lista de lançamentos já carregada. Cada lançamento tem:
  - o tipo e o valor;
  - a data;
  - a categoria, com a mãe e o `isFixed` das duas;
  - `adjustment`, `installmentGroupId` e `recurringRuleId`.

  As funções:
  - `monthSummary(lançamentos, mês)`: receitas, despesas, sobra, taxa de poupança, fixos e variáveis;
  - `isFixedExpense(lançamento)`;
  - `monthProjection(lançamentos, assinaturas, mês, hoje)`;
  - `futureCommitments(parcelas, assinaturas, hoje, meses = 6)`;
  - `categoryBreakdown(lançamentos, mês, inícioDoHistórico)`;
  - `monthlyEvolution(lançamentos, mês, inícioDoHistórico, meses = 6)`.

- **As constantes ficam no topo do módulo:** 6 meses de evolução, 6 de comprometido e 3 de média.
- **`src/server/metrics.ts` · `dashboardMetrics(spaceId, mês)`:**
  - gera as assinaturas vencidas;
  - carrega numa só consulta os lançamentos do 1º mês da evolução até o último mês do comprometido (a média de 3 meses cabe nesse intervalo);
  - carrega as assinaturas ativas e o início do histórico;
  - devolve todas as métricas.
  - **Tudo restrito ao espaço.** O mês vem validado (`YYYY-MM`). Para um mês futuro, só o resumo do que já está registrado e o comprometido.

## Critérios de aceite

- [ ] CA1 — Unitário:
  - cada métrica tem um teste com o mesmo conjunto fixo de dados inventados;
  - o resultado esperado de cada uma está calculado à mão no comentário do teste.
- [ ] CA2 — Unitário: uma compra no crédito de 28/11, com fatura que vence em janeiro, conta em novembro. As parcelas contam uma por mês.
- [ ] CA3 — Unitário: num mês sem receita, a taxa de poupança é `null`, sem divisão por zero.
- [ ] CA4 — Unitário: sem 3 meses completos de histórico, a média é `null`. Com eles, a média sai, inclusive quando é zero.
- [ ] CA5 — Unitário: transferências, pagamentos de fatura, ajustes de conferência e saldos anteriores de fatura não entram em nenhuma métrica.
- [ ] CA6 — Unitário, a projeção:
  - no 1º dia, no meio e no último dia do mês;
  - com uma assinatura que ainda vai cair e uma que já caiu;
  - um mês passado não tem projeção.
- [ ] CA7 — Integração: `dashboardMetrics` com dados no banco dá os mesmos números do conjunto fixo e não vê outro espaço.
- [ ] CA8 — Lint, format, test, build e CI verdes.

## Casos de borda

- **Um estorno maior que as compras do mês:** a receita sobe e a sobra cresce. Isso é coerente com a regra de que o estorno é receita.
- **O dia 31 de uma assinatura num mês de 30 dias:** cai no dia 30, como na geração (task 13).
- **Uma assinatura pausada:** não entra nem na projeção nem no comprometido. Ao retomar, volta a entrar.
- **Uma categoria arquivada com gastos no mês:** continua no total e na média. Arquivar não apaga o passado.
- **Mudar uma categoria para fixa:** muda os fixos de todos os meses, inclusive os passados. É uma marca da categoria, e não do lançamento.
- **Uma subcategoria fixa numa mãe que não é fixa:** só a subcategoria é fixa.

## Decisões

- **O estorno no crédito é receita,** como já é em `incomeByCategory` (task 21), e não um desconto na despesa. Isso é simples e igual em toda parte. Em troca, um estorno grande infla a taxa de poupança do mês.
  - _João, confira:_ a alternativa é o estorno abater a despesa da categoria da compra. Só que o estorno tem categoria de receita, e ligar um ao outro mexeria no registro.
- **A projeção só conta os fixos que o app sabe que vão cair** (parcelas e assinaturas). Um aluguel do mês ainda não registrado não entra. Estimar pelos meses anteriores seria um palpite, e um insight pode avisar disso (task 24).
- **A média é por categoria principal.** O dashboard compara Alimentação, e não cada subcategoria. O detalhe ainda traz as subcategorias.
- **O histórico começa no uso do app,** e não no lançamento mais antigo. Um gasto antigo registrado depois não deve liberar médias de meses que não foram acompanhados.
- **Funções puras sobre dados carregados uma vez.** Os testes ficam diretos, e o servidor faz uma consulta só, em vez de uma por métrica.

## Fora do escopo

- A tela do dashboard e o início (task 25).
- Os insights e os destaques (task 24).
- Receitas recorrentes e a previsão de receitas.
- Métricas por conta ou por cartão.
