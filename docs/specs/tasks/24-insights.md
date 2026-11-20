# 24 — Motor de insights por regras

Issue: #24 · Design: [Indicadores e insights](../v1-design.md#indicadores-e-insights-v1-por-regras) · [Métricas](23-metrics.md) · [Assinaturas](19-subscriptions-screen.md) · [Estabelecimentos](20-counterparties.md)

## Objetivo

O dashboard (task 25) mostra 2–3 frases simples que apontam onde dá para economizar. Esta task faz só o motor: regras puras em `src/domain/insights.ts`, com os limites num módulo de constantes, e os insights entram no `dashboardMetrics` da task 23. Não tem tela.

## Os dados

Os insights usam os mesmos lançamentos das métricas (task 23), com a mesma regra do que conta:

- **Contam só as despesas e receitas,** pela data delas.
- **Ficam de fora** as transferências, os pagamentos de fatura e os ajustes.
- **O início do histórico é o mesmo da task 23,** com uma mudança decidida pelo João na revisão dela: passa a ser só o dia da criação do espaço.
  - O saldo inicial de uma conta não conta mais. Uma conta cadastrada depois com um saldo de um ano atrás não libera médias de meses que não foram acompanhados.
  - Isso muda o `historyStart` do `src/server/metrics.ts`, com teste, e a spec 23 é atualizada.

A consulta da task 23 passa a trazer o estabelecimento de cada lançamento, e as assinaturas ativas passam a trazer o nome e o histórico de valor (task 19).

## Os limites

Ficam todos em `src/domain/insight-limits.ts`, e nenhuma regra tem número solto:

| Constante                      | Valor    | Uso                                                     |
| ------------------------------ | -------- | ------------------------------------------------------- |
| `CATEGORY_ABOVE_AVERAGE_RATIO` | 0,25     | Variação mínima sobre a média (25%)                     |
| `MIN_IMPACT_CENTS`             | R$ 50,00 | Impacto mínimo da categoria e dos gastos pequenos       |
| `SMALL_PURCHASE_MAX_CENTS`     | R$ 30,00 | Uma compra "pequena" é de até esse valor, inclusive     |
| `SMALL_PURCHASES_MIN_COUNT`    | 5        | Compras pequenas no mesmo lugar para virar insight      |
| `SUBSCRIPTION_CHANGE_DAYS`     | 90       | Por quanto tempo uma mudança de valor vira insight      |
| `TOP_COUNTERPARTY_MIN_SHARE`   | 0,20     | Fatia mínima das despesas do mês no maior lugar (20%)   |
| `TIMES_AVERAGE_FROM`           | 3        | A partir de quantas vezes a média o texto diz "N vezes" |
| `MAX_INSIGHTS`                 | 3        | Quantos insights o dashboard mostra                     |

`SUBSCRIPTION_CHANGE_DAYS` começa igual ao `RECENT_CHANGE_DAYS` da task 19, para a tela de assinaturas e o insight concordarem. Ele é passado ao `recentChange`, então mudá-lo aqui muda o insight.

## As regras

Todas são de um mês (`YYYY-MM`), com hoje no fuso de São Paulo. "Este mês" no texto vira "em outubro" para um mês passado, e "em dezembro de 2025" para um de outro ano.

### 1. Categoria acima da média (alerta)

- **A base:** cada categoria principal do `categoryBreakdown` da task 23, com o total do mês e a média dos 3 meses anteriores.
- **Dispara quando** a categoria tem média, e o excesso (total − média) é:
  - maior que 25% da média;
  - e de pelo menos R$ 50,00.
- **Uma média zero** não tem porcentagem. Dispara com o total de pelo menos R$ 50,00 e outro texto.
- **Sem histórico suficiente,** a média é `null` e a regra não dispara.
- **"Sem categoria" fica de fora:** não há categoria para cuidar.
- **No mês atual,** o total é o de até agora. Passar da média no meio do mês já é um sinal.
- **O impacto é o excesso.**
- **Os textos:**
  - "Alimentação: R$ 820,00 este mês, 46% acima da média de R$ 560,00."
  - Com a média zero: "Viagem: R$ 600,00 este mês, sem gastos nos 3 meses anteriores."
- **A porcentagem é arredondada para inteiro,** sempre para baixo, para nunca anunciar o limite sem tê-lo passado.
- **A partir de 3 vezes a média,** o texto diz "N vezes", também arredondado para baixo. Uma média baixa daria uma porcentagem absurda: "Presentes: R$ 200,00 este mês, 60 vezes a média de R$ 3,33."

### 2. Gastos pequenos recorrentes (alerta)

- **Uma compra pequena** é uma despesa do mês de até R$ 30,00. Parcelas e cobranças de assinatura não entram: não são compras do dia a dia.
- **Agrupadas por estabelecimento.** Dispara com pelo menos 5 compras pequenas no mesmo lugar, somando pelo menos R$ 50,00.
- **Depois, por categoria:** as compras pequenas que sobraram somam na subcategoria delas. Ficam de fora as de um estabelecimento que já disparou, e as sem categoria. Isso pega o lanche em lugares diferentes. Uma compra nunca conta em dois insights.
- **O impacto é a soma.**
- **Os textos:**
  - "Padaria Pão Quente: 12 compras de até R$ 30,00 somaram R$ 186,00 este mês."
  - "Lanches: 7 compras de até R$ 30,00 somaram R$ 98,50 este mês."
  - O nome vem antes, como na regra 1: "na" ou "no" dependeria do gênero do lugar.

### 3. Assinatura que subiu de valor (alerta)

- **A base:** o `recentChange` da task 19, sobre o histórico de cada assinatura ativa.
- **Dispara quando** o valor subiu nos últimos 90 dias. Uma baixa não é onde economizar.
  - Um valor que voltou ao de antes não dispara, como na tela.
- **Só no mês atual:** a mudança é contada a partir de hoje.
- **O impacto é o aumento × 12,** o custo de um ano sem agir.
- **O nome é o da tela de assinaturas:** o estabelecimento, senão a observação, senão a categoria.
- **O texto:** "Streamflix subiu de R$ 39,90 para R$ 44,90: R$ 60,00 a mais por ano."

### 4. Assinaturas no ano (informativo)

- **Dispara com pelo menos uma assinatura ativa.** Usa o `subscriptionTotals` da task 19.
- **Só no mês atual.**
- **O impacto é o total do ano.**
- **O texto:**
  - "Suas 4 assinaturas custam R$ 1.438,80 por ano (R$ 119,90 por mês)."
  - Com uma só: "Sua assinatura custa R$ 478,80 por ano (R$ 39,90 por mês)."

### 5. Onde você mais gastou (informativo)

- **O estabelecimento com o maior total de despesas no mês.** Cada parcela conta no mês dela, como no ranking da task 20.
- **As cobranças de assinatura não contam para escolher o lugar.** Um aluguel cadastrado como assinatura ganharia todo mês. Elas continuam no total de despesas do mês, que é a base da fatia.
- **Um lugar que já está num alerta de compras pequenas** não volta aqui: seria a mesma frase duas vezes.
- **Dispara quando** ele passa de 20% das despesas do mês e de R$ 50,00. Um empate no total vai pelo nome.
- **O impacto é o total.**
- **O texto:** "Onde você mais gastou este mês: Mercado Bom Preço, R$ 820,00 em 6 compras (23% das despesas)."
  - Com 1 compra, o texto diz "em 1 compra".

### A ordem

- **Os alertas vêm antes dos informativos.** Um fato que se repete todo mês não deve tirar o lugar de um sinal novo.
- **Dentro de cada grupo,** o maior impacto vem primeiro. Num empate, a ordem das regras acima, depois o texto.
- **O dashboard recebe os 3 primeiros.** Sem nenhum, a lista vem vazia, e a task 25 decide o estado vazio.
- **Um mês futuro não tem insights** (`null`), como as categorias da task 23.

## Regras e servidor

- **`src/domain/insights.ts`:**
  - `monthInsights({ month, today, entries, categories, rules })` devolve os insights do mês, já ordenados e cortados;
  - uma função por regra, exportada para os testes.
  - Cada insight tem:
    - o tipo (`kind`);
    - o grupo (`alert` ou `info`);
    - o impacto em centavos;
    - o texto pt-BR;
    - o assunto (`{ type: "category" | "counterparty" | "subscription", id }`, ou `{ type: "subscriptions" }` para o total das assinaturas), para a tela da task 25 virar um link.
- **O dinheiro do texto usa o `formatBRL`,** e a porcentagem é um inteiro com "%".
- **O mês no texto** é o nome em pt-BR, minúsculo ("em outubro"), com o ano quando não é o de hoje.
- **`src/server/metrics.ts`:** o `dashboardMetrics` ganha o campo `insights`. Ele usa os lançamentos e as categorias já carregados, sem consulta nova de lançamentos.
  - A consulta passa a trazer o estabelecimento (id e nome).
  - A das assinaturas ativas passa a trazer o nome e as mudanças de valor.
  - Tudo continua restrito ao espaço.

## Critérios de aceite

- [x] CA1 — Unitário: cada regra tem um teste que dispara e um que não dispara logo abaixo do limite:
  - categoria: 25% + 1 centavo dispara e 25% exatos não; R$ 50,00 de excesso dispara e R$ 49,99 não;
  - gastos pequenos: 5 compras dispara e 4 não; R$ 30,00 é pequena e R$ 30,01 não; somando R$ 49,99 não dispara;
  - assinatura: subiu há 90 dias dispara e há 91 não; uma baixa não dispara;
  - onde mais gastou: 20% + 1 centavo dispara e 20% exatos não.
- [x] CA2 — Unitário: sem histórico suficiente, a regra de categoria não dispara, mesmo com um total muito acima.
- [x] CA3 — Unitário: os textos saem em pt-BR, com os valores em R$ pelo `formatBRL`. "Este mês" no atual, "em outubro" num passado e "em dezembro de 2025" num de outro ano.
- [x] CA4 — Unitário: a ordem. Os alertas por impacto, depois os informativos, e só os 3 primeiros. Um mês futuro não tem insights.
- [x] CA5 — Unitário: uma compra pequena não conta em dois insights, e parcelas, cobranças de assinatura, transferências e ajustes não contam como compras pequenas.
- [x] CA6 — Integração: o `dashboardMetrics` com dados no banco traz os insights esperados e não vê outro espaço.
- [x] CA7 — Os limites estão todos em `src/domain/insight-limits.ts`.
- [x] CA8 — Lint, format, test, build e CI verdes.

## Casos de borda

- **Uma categoria arquivada** continua no total e na média, como na task 23, e pode disparar.
- **Uma subcategoria** soma na mãe. O alerta é da categoria principal.
- **Um estorno** é receita e não abate a categoria (task 23).
- **Uma assinatura pausada ou cancelada** não entra nas regras 3 e 4.
- **Uma assinatura que subiu duas vezes nos 90 dias** compara o valor de antes da primeira com o atual, como na tela (task 19).
- **Um estabelecimento sem nenhuma compra pequena** não entra na regra 2, mesmo que tenha muitas compras.
- **Um mês sem despesas** não tem "onde mais gastou", e nunca há divisão por zero.

## Decisões

- **Dois grupos, alerta e informativo.** O design pede a ordem por impacto em R$. Mas o total anual das assinaturas (R$ 1.400) ganharia todo mês de um sinal novo, como uma categoria R$ 80 acima da média. Os informativos só preenchem as vagas que sobram.
  - _João, confira._
- **O impacto da assinatura é o aumento de um ano.** R$ 5 a mais por mês parece pouco, mas é R$ 60 no ano e não acaba sozinho.
- **Só alertas de alta.** Uma categoria abaixo da média e uma assinatura que baixou são boas notícias, e não apontam onde economizar. A tela da task 25 já mostra a comparação de todas as categorias.
- **"Muitas compras" = 5 no mês.** Uma por semana passa despercebida. O valor fica no módulo de limites para ajustar.
- **"Onde mais gastou" só com mais de 20% das despesas.** Senão o insight vira uma lista, que já existe na tela de estabelecimentos (task 20).
- **As regras de assinatura só no mês atual.** Elas falam do agora, e não de um mês passado.
- **Sem IA, e sem palpites sobre o que falta registrar,** por exemplo o aluguel que costuma cair e ainda não caiu. Isso fica para depois.

## Revisão

O revisor (Opus, effort high) aprovou com nits, sem bloqueios. Ele conferiu todas as fronteiras e comparou a fatia de 20% por força bruta com a conta inteira. Corrigido:

- **O mesmo lugar ocupava duas vagas:** o alerta de compras pequenas da padaria e o "onde mais gastou" da mesma padaria. Agora o informativo sai quando um alerta já fala do mesmo lugar. Há teste.
- **Uma média baixa dava "5906% acima da média de R$ 3,33".** A partir de 3 vezes a média, o texto diz "N vezes".
- **O `SUBSCRIPTION_CHANGE_DAYS` não era usado:** a regra chamava o `recentChange` com os 90 dias dele. Agora a constante é passada.
- **O nome da assinatura estava em dois lugares** (a tela e o servidor). Agora é o `subscriptionName`, uma função pura em `src/domain/subscriptions.ts`.
- **O teste do mês passado não provava** que a regra das assinaturas no ano fica de fora. Ganhou um caso com vaga sobrando.
- **O aluguel cadastrado como assinatura** viraria "onde você mais gastou" todo mês. As cobranças de assinatura não escolhem mais o lugar.
- **O assunto do total das assinaturas** (`{ type: "subscriptions" }`) entrou na spec.

**Segunda rodada: aprovado,** sem bloqueios nem nits a corrigir.

Anotado, sem mudança:

- **Um alerta de categoria (Alimentação) e um de compras pequenas numa subcategoria dela** (Lanches) podem contar o mesmo dinheiro. Eles dizem coisas diferentes, o total e o hábito, e a regra 2 só proíbe contar duas vezes dentro dela.
- **Uma média que arredonda para zero** (1 centavo em 3 meses) diz "sem gastos". É improvável.
- **O onboarding nomeia a assinatura sem a categoria** como último recurso (`src/server/onboarding.ts`). Isso fica fora deste diff, e a tela de lá sempre tem um estabelecimento ou uma observação.

## Fora do escopo

- A tela (task 25).
- Insights com IA (fase 3).
- O alerta de um fixo de costume ainda não registrado no mês.
- A comparação por subcategoria e por conta ou cartão.
