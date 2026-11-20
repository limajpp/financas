# 25 — Dashboard web e início do celular

Issue: #25 · Design: [Telas](../v1-design.md#telas) · [Decisões do João](../v1-design.md#decisões-do-joão) · [Métricas](23-metrics.md) · [Insights](24-insights.md)

## Objetivo

O resumo do mês em poucos números, com o detalhe só quando pedido. A tela `/` é o "Dashboard" na barra lateral do computador e o "Início" na barra de baixo do celular. Os números vêm do `dashboardMetrics` (tasks 23 e 24): a tela só formata e desenha, e não refaz contas. Os gráficos seguem a skill `dataviz`.

## Uma tela, dois arranjos

A mesma rota `/` serve os dois. O que muda é o arranjo por largura (CSS, `md:`), e cada bloco carrega no seu próprio `<Suspense>`, para o topo aparecer primeiro.

### Celular (até `md`): o início

De cima para baixo:

1. **Saudação** ("Olá, Ana"), como hoje.
2. **O mês em três números:**
   - gasto de hoje;
   - gasto do mês até agora;
   - sobra do mês até agora.
3. **Botão grande "Registrar um lançamento"** (com "+"), para `/registrar`. O nome não é só "Registrar" para não se confundir com o item da barra de baixo.
4. **A fatura atual de cada cartão ativo:**
   - o nome, o total da fatura aberta e "vence em 10/12";
   - cada uma leva a `/faturas?cartao=…`.
   - Sem cartões, o bloco não aparece.
5. **Os últimos 5 lançamentos,** como na lista (task 14), e o link "Ver todos" para `/lancamentos`.
6. **O resumo do mês,** na mesma ordem do computador: o seletor, os KPIs, os insights, as categorias, a evolução e os atalhos.

O convite do onboarding (task 22) e a dica de instalação (task 15) continuam onde estão hoje, logo abaixo da saudação.

### Computador (`md` em diante): o dashboard

Na ordem do design:

1. **Título e seletor de mês.**
2. **4 KPIs:** sobra, taxa de poupança, projeção do mês e comprometido no futuro.
3. **Os insights** (até 3).
4. **Categorias × média** e **evolução de 6 meses,** lado a lado a partir de `lg`, empilhados abaixo disso.
5. **Atalhos:** Estabelecimentos, Faturas e Assinaturas, cada um com uma linha de contexto:
   - Estabelecimentos: o lugar com o maior total no mês.
   - Faturas: o total das faturas abertas.
   - Assinaturas: o total por mês.

No celular, o resumo (KPIs, categorias e evolução) fica abaixo do início, na mesma ordem. Os blocos só do início (hoje, cartões, últimos lançamentos e o botão) não aparecem no computador: lá a barra lateral já tem "Registrar", e a lista tem tela própria.

## O seletor de mês

- **O mês vai na URL:** `/?mes=2026-10`. Sem o parâmetro, ou com um mês inválido, vale o mês atual.
- **Setas "mês anterior" e "próximo mês"** e o nome do mês ("novembro de 2026").
  - O "próximo" some no mês atual: um mês futuro só teria o comprometido, que já está no KPI.
  - O "anterior" vai até o mês do início do histórico (a criação do espaço).
- **"Voltar para este mês"** aparece fora do mês atual.
- **O seletor muda o resumo:** os KPIs, os insights, as categorias e a evolução.
- **O que não muda:** "hoje", as faturas e os últimos lançamentos são sempre de agora.

## Os KPIs

Cada um é um número grande, um rótulo e uma linha de contexto. O valor exibido é sempre um campo do `dashboardMetrics`, sem conta na tela:

| KPI                        | Mês atual                                                                                                                                                                  | Mês passado                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Sobra**                  | "Sobra até agora": as receitas − a despesa até hoje (`projection.expenseToDateCents`). Contexto: "R$ X de receitas, R$ Y de despesas".                                     | `summary.leftoverCents`, com as receitas e as despesas no contexto. |
| **Taxa de poupança**       | A sobra até agora ÷ as receitas, em %. Sem receita no mês: "—" e "Sem receitas no mês".                                                                                    | `summary.savingsRate`, em %.                                        |
| **Projeção do mês**        | `projection.projectedExpenseCents` (a despesa projetada) e a sobra projetada no contexto. Antes do dia 5, ganha o selo "estimativa" e a frase "Poucos dias para projetar." | Vira **"Despesa do mês"**, o valor final (`summary.expenseCents`).  |
| **Comprometido no futuro** | `commitments.totalCents` (os próximos 6 meses). Contexto: "Faltam R$ X em parcelas" (`remainingInstallmentsCents`), ou "Sem parcelas a pagar".                             | O mesmo: é sempre a partir de hoje, e o contexto diz isso.          |

- **A "sobra até agora" usa a despesa até hoje.** A despesa registrada do mês inclui as parcelas com data mais adiante, que ainda não aconteceram (decisão 4 da revisão da task 23). Elas entram na projeção.
  - O `dashboardMetrics` passa a devolver a sobra e a taxa até agora, para a tela não fazer conta. São campos novos da `projection`: `leftoverToDateCents` e `savingsRateToDate`.
- **A "projeção" a partir do dia 5** (decisão 1). Antes, o valor aparece, mas com o selo e sem destaque de cor.
- **No celular, o início** usa os mesmos números: "Gasto do mês" é a despesa até hoje, e "Sobra" é a sobra até agora.
- **O dinheiro** sai pelo `formatBRL`, e a porcentagem é inteira ("25%"), arredondada para baixo, como nos insights. Um valor negativo aparece com o sinal e a cor de alerta (`destructive`).

## Os insights

- **Uma lista simples, sem cartão por item.** O texto vem pronto da task 24.
- **Cada insight é um link:**
  - categoria → `/lancamentos?categoria=…&de=…&ate=…` (o mês escolhido);
  - estabelecimento → `/estabelecimentos/…`;
  - assinatura e assinaturas → `/assinaturas`.
- **Um ícone pequeno distingue um alerta de um informativo.** A cor não é o único sinal.
- **Sem insights:** "Nada fora do comum neste mês." No primeiro mês, ainda sem médias, diz também "Os alertas de categoria começam em <mês>", a partir do início do histórico.

## Categorias × média

Uma lista, e não um gráfico de pizza: o que importa é comparar cada categoria com a média dela.

- **Cada linha tem:**
  - o ícone e o nome da categoria;
  - o total do mês;
  - uma barra do total;
  - uma marca vertical na posição da média;
  - à direita, a variação ("+46%" ou "−12%"), com a mesma regra de cor dos insights.
- **A escala** é a mesma para todas as linhas: o maior entre os totais e as médias.
- **Sem média** (histórico curto), a linha não tem a marca nem a variação. Uma nota única acima da lista diz "As médias aparecem a partir de <mês>".
- **Com subcategorias,** a linha abre (um `<details>`) e mostra as subcategorias com o total de cada uma. A linha "direta" (`direct`) aparece como "<Categoria> (direto)".
- **No celular,** as 5 maiores aparecem, e "Ver todas" abre o resto. No computador, aparecem todas.
- **Cada linha leva à lista de lançamentos** filtrada pela categoria e pelo mês.

## Evolução de 6 meses

- **Um gráfico de barras agrupadas:** receitas e despesas por mês, com a sobra como uma linha por cima. É Recharts, que entra como dependência nesta task.
- **Os meses antes do histórico** (`beforeHistory`) aparecem vazios, com "sem dados" no eixo, e não como zero.
- **O primeiro mês de uso, parcial,** fica mais claro e com a nota "parcial" no rótulo (decisão 2). É o mês do início do histórico, quando não começou no dia 1º.
- **O mês escolhido** fica destacado no eixo.
- **Uma tabela escondida** (`sr-only`) traz os mesmos números para leitores de tela.
- **As cores vêm dos tokens do tema,** e o gráfico é conferido em claro e escuro: as receitas, as despesas e a sobra, com contraste nos dois.
- **O tooltip** mostra os três valores do mês em R$.
- **O componente é de cliente,** carregado sem bloquear o resto da tela.

## Estados vazios

- **Nenhum lançamento ainda** (o primeiro uso):
  - o resumo vira um convite: "Registre seu primeiro gasto para ver o resumo do mês", com o botão "Registrar o primeiro gasto";
  - os KPIs aparecem zerados, sem a projeção;
  - a evolução não aparece.
- **Sem receitas no mês:** a taxa de poupança diz "—" (acima).
- **O primeiro mês:** as médias e os alertas de categoria têm a nota de quando começam (acima).
- **Sem cartões:** o bloco das faturas não aparece no início.

## Servidor

- **`dashboardMetrics`** ganha:
  - `projection.leftoverToDateCents` e `projection.savingsRateToDate` (acima);
  - os nomes, ícones e cores das categorias, para as linhas. O `categoryBreakdown` já traz o id e o nome; o ícone e a cor vêm junto da consulta.
- **`homeSummary(spaceId)`** (nova, em `src/server/home.ts`):
  - o gasto de hoje (as despesas de hoje que contam, pela regra da task 23);
  - a fatura aberta de cada cartão ativo, pelo `cardsInvoices` que a tela de faturas já usa;
  - os últimos 5 lançamentos, pelo `listTransactions` da task 14.
  - Tudo restrito ao espaço.
- **Os atalhos** usam o que já existe: o ranking da task 20 (o maior do mês), as faturas abertas acima e o `subscriptionTotals` da task 19.

## Critérios de aceite

- [ ] CA1 — E2E (Chromium e iPhone/WebKit), com dados inventados e fixos registrados pela própria tela: os 4 KPIs exibidos batem com o `dashboardMetrics` dos mesmos dados. Os valores esperados são calculados à mão no teste.
- [ ] CA2 — E2E: no primeiro mês, nenhuma seta leva a outro mês, e um `?mes=` inválido, futuro ou anterior ao histórico abre o mês atual. Unitário: num mês passado, a projeção vira "Despesa do mês", e o seletor tem "anterior" até o início do histórico.
  - Uma conta criada pelo e2e começa hoje, e o e2e não mexe no banco: um mês passado com dados só aparece nas screenshots (CA8), feitas com uma conta semeada à parte.
- [ ] CA3 — E2E: no celular, o início mostra o gasto de hoje, o do mês, a sobra, a fatura atual de um cartão e os últimos lançamentos, e o botão "Registrar um lançamento" leva ao registro.
- [ ] CA4 — E2E: os estados vazios. Uma conta nova mostra o convite para registrar, e os insights dizem "Nada fora do comum neste mês."
- [ ] CA5 — E2E: um insight e uma linha de categoria levam à lista de lançamentos filtrada.
- [ ] CA6 — Unitário: a formatação dos KPIs (porcentagem, "—" sem receita, o selo "estimativa" antes do dia 5) e o nome do mês do seletor.
- [ ] CA7 — Integração: `homeSummary` dá o gasto de hoje, a fatura aberta de cada cartão e os últimos 5 lançamentos, só do espaço. `leftoverToDateCents` e `savingsRateToDate` batem com o conjunto fixo da task 23.
- [ ] CA8 — Os gráficos e a lista de categorias legíveis em claro e escuro, no celular e no computador (screenshots mandadas ao João no chat, com dados inventados; o repositório não guarda imagens).
- [ ] CA9 — Lint, format, test, build e CI verdes.
- [ ] CA10 — Manual, no iPhone, depois do merge na `develop`: o início abre rápido no app instalado. Vai junto da verificação das tasks 15 e 17.

## Casos de borda

- **O mês escolhido antes do histórico,** por URL: o seletor leva ao mês do início do histórico.
- **Um mês com estorno maior que as despesas:** a sobra fica maior que as receitas, e a taxa passa de 100%. A tela mostra o número como vem.
- **Uma categoria só com média** (nada gasto no mês): a linha tem a barra vazia e a marca da média. É o "este mês você não gastou com isso".
- **Um cartão sem nada na fatura aberta:** aparece com R$ 0,00.
- **A virada do mês com a tela aberta:** a próxima navegação já usa o mês novo. Não há atualização ao vivo.

## Decisões

- **Uma rota só, com dois arranjos.** O "Início" e o "Dashboard" já apontam para `/`. Duas telas repetiriam os números e dividiriam a navegação.
  - O preço é carregar o resumo também no celular. Ele vem em `<Suspense>` abaixo do início, e o gráfico carrega por último.
  - _João, confira._
- **Categorias numa lista com barras, e não numa pizza.** A pergunta do dashboard é "gastei mais que o normal?", e uma pizza não mostra a média.
- **A evolução em barras agrupadas com a linha da sobra:** é a comparação de dois valores por mês com o resultado deles.
- **A sobra e a taxa "até agora" no mês atual** usam a despesa até hoje (decisão 4 da task 23). O resumo do mês fechado usa o total.
- **O "próximo mês" não existe.** O comprometido no futuro já responde "quanto já devo nos próximos meses".

## Fora do escopo

- Metas, limites por categoria e alertas por push dos insights (fase 3).
- O dashboard do casal (fase 2).
- Exportar o resumo.
- O polimento geral da v1, com os estados vazios das outras telas e o desempenho medido no iPhone (task 26).
