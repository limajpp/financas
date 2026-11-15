# 20 — Estabelecimentos: ranking e edição da memória

Issue: #20 · Design: [Telas](../v1-design.md#telas) · [Indicadores](../v1-design.md#indicadores-e-insights-v1-por-regras) · [Memória por estabelecimento](10-counterparty-memory.md)

## Objetivo

Ver onde o dinheiro vai, por estabelecimento, e ter um lugar para arrumar a memória que o app aprendeu (task 10): o nome, os apelidos do extrato, o CPF/CNPJ, a categoria e a observação padrão. Também dá para juntar dois estabelecimentos que são o mesmo ("Padaria do bairro" e "Padaria Sao Joao").

## Comportamento

### Tela `/estabelecimentos`

- **Período** no topo, com as opções "Este mês" (padrão), "Mês passado", "Últimos 3 meses" e "Este ano". Ele fica na URL (`?periodo=mes|mes-passado|3-meses|ano`).
- **Duas abas: "Por valor" e "Por frequência".**
  - **Por valor:** os estabelecimentos com despesas no período, do maior total para o menor. Cada linha mostra o nome, o total, o número de compras e a categoria mais usada.
  - **Por frequência:** os mesmos, do maior número de compras para o menor, com o mesmo conteúdo.
  - **Empate:** no valor, quem tem mais compras vem antes; na frequência, quem tem o maior total. Depois, o nome, em ordem alfabética (pt-BR).
  - **Até 20 estabelecimentos.** "Mostrar mais" traz o resto.
- **O que conta:**
  - **Valor:** a soma das despesas do estabelecimento no período, pela data de cada lançamento. Uma parcela conta no mês dela (design), e uma cobrança de assinatura conta no mês dela.
  - **Frequência:** o número de compras. Uma compra parcelada conta uma vez, pela 1ª parcela. Cada cobrança de assinatura é uma compra.
  - Receitas, estornos, transferências e pagamentos de fatura não entram.
- **Buscar:** um campo "Buscar estabelecimento" acima das abas procura em todos os estabelecimentos em uso (com algum lançamento), com a busca da task 10 (nome, apelido ou documento). Assim dá para editar a memória de quem não teve despesa no período, como a empresa que paga o salário.
- **Sem despesas com estabelecimento no período:** "Nenhuma despesa com estabelecimento neste período."
- Cada linha, e cada resultado da busca, abre o detalhe.

### Detalhe `/estabelecimentos/<id>`

- **Cabeçalho:** o nome, o CPF/CNPJ formatado (se houver) e os apelidos.
- **Números do período** (o mesmo seletor, que começa no período de onde você veio):
  - o total;
  - o número de compras;
  - o ticket médio, que é o total dividido pelo número de compras, arredondado para o centavo.
  - Sem compras no período, aparecem "R$ 0,00", "0" e "—".
- **Lançamentos:** os 10 mais recentes do estabelecimento no período, de qualquer tipo, como na lista da task 14. Tocar num deles abre a edição da task 14. "Ver todos" abre `/lancamentos` filtrado pelo estabelecimento e pelo período.
- **Um estabelecimento de outro espaço,** ou que não existe, mostra "Estabelecimento não encontrado".

### Editar a memória

O botão "Editar" abre um diálogo com:

- **Nome,** até 60 caracteres e obrigatório. Ele precisa ser único no espaço, sem diferença de acentos e maiúsculas. Se já existir, aparece "Já existe um estabelecimento com esse nome. Para juntar os dois, use “Mesclar”."
- **Apelidos** (o nome no extrato):
  - a lista atual, cada um com um botão de remover, e um campo para acrescentar;
  - até 10 apelidos, cada um com até 60 caracteres;
  - um apelido igual ao nome, ou repetido, sem diferença de acentos e maiúsculas, é ignorado.
- **CPF/CNPJ,** opcional, validado como na task 10 (`parseDocument`), com as mesmas mensagens.
- **Categoria padrão,** opcional: uma categoria ativa do espaço, de despesa ou de receita. Escolhida, ela passa na frente da categoria aprendida nas sugestões do registro (task 10), para o tipo dela.
- **Observação padrão,** opcional, até 120 caracteres. Ela passa na frente da última observação usada.
- Salvar mostra "Estabelecimento atualizado". **Os lançamentos já feitos não mudam:** eles apontam para o estabelecimento, e o nome novo aparece neles.

### Mesclar

- **No detalhe, "Mesclar com…"** abre um diálogo para escolher o outro estabelecimento, com a mesma busca. O que está aberto é o que **fica**, e o escolhido é **absorvido**.
- **Antes de confirmar,** o diálogo resume: "Os 12 lançamentos e a assinatura de “Padaria Sao Joao” passam para “Padaria do bairro”. “Padaria Sao Joao” vira um apelido e deixa de existir."
- **Confirmar faz tudo numa só transação do banco:**
  - os lançamentos e as assinaturas do absorvido passam a apontar para o que fica;
  - o nome do absorvido e os apelidos dele entram nos apelidos do que fica, sem repetir e até o limite de 10. Os mais antigos do que fica saem primeiro, como em `addAlias`;
  - CPF/CNPJ, categoria padrão e observação padrão: vale o do que fica. Se ele não tiver, herda o do absorvido;
  - o absorvido é apagado.
- **Se os dois tinham CPF/CNPJ diferentes,** o resumo avisa: "O CPF/CNPJ de “Padaria Sao Joao” (…) será descartado."
- **Não dá para mesclar** um estabelecimento com ele mesmo, nem com um de outro espaço.
- Depois de mesclar, o detalhe do que fica mostra os números somados, e o aviso "Estabelecimentos mesclados" aparece.

### Regras e servidor

- **`src/domain/counterparties.ts`**, funções puras com testes:
  - `rankCounterparties(linhas, ordem)`: a ordenação por valor ou por frequência, com os desempates;
  - `periodRange(período, hoje)`: o intervalo de datas de cada opção. "Últimos 3 meses" é o mês atual e os 2 anteriores; "Este ano" vai de 1º de janeiro até o fim do ano;
  - `averageTicket(total, compras)`: o ticket médio, ou nulo sem compras;
  - `mergeMemory(fica, absorvido)`: os apelidos, o documento e os padrões resultantes;
  - `validateMemoryEdit`: nome, apelidos e documento.
- **`counterpartyRanking(spaceId, período)`:** uma agregação no banco (`groupBy` por estabelecimento) para o total e outra para as compras. A categoria mais usada vem de uma terceira consulta, sem trazer todos os lançamentos.
- **`counterpartyDetail(spaceId, id, período)`, `updateCounterparty` e `mergeCounterparties`,** sempre restritos ao espaço.
- **Server Actions com Zod:** editar e mesclar.
- Depois de editar ou mesclar, o registro já sugere com a memória nova, porque ele recalcula as sugestões ao abrir.

## Critérios de aceite

- [ ] CA1 — Unitário: o ranking de um conjunto fixo de dados sai na ordem certa por valor e por frequência, com os desempates.
- [ ] CA2 — Integração: o ranking do período soma só as despesas, conta uma compra parcelada uma vez, cada cobrança de assinatura uma vez, e não mostra outro espaço.
- [ ] CA3 — Integração: mesclar move todos os lançamentos e assinaturas, junta os apelidos (com o nome do absorvido), herda o documento e os padrões quando faltam, e apaga o absorvido. Mesclar com ele mesmo, ou com outro espaço, é recusado.
- [ ] CA4 — Integração:
  - editar o nome, os apelidos, o documento e os padrões grava tudo;
  - um nome repetido, um documento inválido e mais de 10 apelidos são recusados;
  - a categoria padrão passa a ser a sugestão do registro.
- [ ] CA5 — E2E (Chromium e iPhone/WebKit): o ranking mostra os estabelecimentos na ordem certa nas duas abas, e o detalhe mostra o total, as compras e o ticket médio.
- [ ] CA6 — E2E: mesclar dois estabelecimentos deixa um só, com os lançamentos somados, e o nome do absorvido vira apelido.
- [ ] CA7 — Lint, format, test, build, `test:e2e:docker` e CI verdes. Telas conferidas no desktop e no viewport do iPhone.

## Casos de borda

- **O nome novo é igual a um apelido de outro estabelecimento:** é aceito. O nome é que precisa ser único, e no registro o nome vence o apelido (task 10).
- **Mesclar quando a soma passa de 10 apelidos:** ficam os 10 mais novos, e o nome do absorvido é sempre um deles.
- **Mesclar com uma corrida no registro:** um lançamento novo com o nome do absorvido, salvo no mesmo instante, ou é movido junto, ou chega depois e cria o estabelecimento de novo pelo nome. O nome do absorvido vira apelido do que fica, então o registro passa a casar com o que fica.
- **Estabelecimento sem lançamentos** (órfão de uma corrida, task 8): não aparece no ranking nem na busca.

## Decisões

- **Só despesas no ranking.** É a pergunta "onde mais gasto". As receitas por fonte são outra visão, e a busca resolve a edição delas.
- **A compra parcelada conta uma vez na frequência, mas cada parcela conta no valor do mês dela.** O valor segue a regra de competência do design. A frequência é sobre ir à loja.
- **Mesclar só move:** não apaga lançamento, não muda valores nem categorias já gravadas. A categoria dos lançamentos antigos é sua escolha de cada vez.
- **O nome do absorvido vira apelido.** É o que garante que o próximo registro com o nome antigo caia no estabelecimento certo.
- **Não há desfazer da mescla.** Ela pede confirmação, com o resumo do que vai acontecer.

## Fora do escopo

- Apagar um estabelecimento (os lançamentos apontam para ele; mesclar resolve os duplicados).
- O insight "gastos pequenos recorrentes" (task 24).
- Gráficos de evolução por estabelecimento.
- Sugerir duplicados automaticamente.
