# 21 — Conferir saldo com o banco

Issue: #21 · Design: [Telas](../v1-design.md#telas) · [Metas](../v1-design.md#anti-metas-o-que-faz-o-joão-largar-o-app) · [Saldo da conta](08-transactions.md)

## Objetivo

De vez em quando, você abre o app do banco, digita o saldo que ele mostra e o app diz se bate. Se não bater, a diferença é quase sempre um lançamento esquecido. O app mostra os últimos lançamentos da conta, para ajudar a lembrar, e oferece dois caminhos:

- **registrar o que falta**, com o valor da diferença já preenchido;
- **criar um ajuste**, quando não dá para saber o que foi.

## Comportamento

### Em `/contas`

- Cada conta ativa ganha o botão **"Conferir saldo"**.
- Abaixo do saldo atual, aparece "Conferido em 10/11/2026" quando a conta já foi conferida, ou "Nunca conferido".

### O diálogo "Conferir saldo · Banco Azul"

1. **"Saldo no app do banco hoje":** um campo de valor que aceita negativo (cheque especial, "-120,00"). O botão é "Comparar".
2. **O resultado:**
   - "No app: R$ 1.234,56", "No banco: R$ 1.200,00" e a diferença, explicada em português:
     - **o banco tem menos:** "Faltam R$ 34,56 em saídas: um gasto que não foi registrado?";
     - **o banco tem mais:** "Faltam R$ 34,56 em entradas: um recebimento que não foi registrado?";
     - **bate:** "O saldo bate com o banco.", com o botão **"Marcar como conferido"**.
   - **Os últimos lançamentos da conta** (os 10 mais recentes até hoje, incluindo as transferências de entrada e de saída), com data, nome e valor, para ajudar a lembrar.
3. **Quando há diferença, duas ações:**
   - **"Registrar o que falta"** abre `/registrar` já com:
     - o valor da diferença;
     - o tipo: despesa, quando o banco tem menos, ou receita, quando tem mais;
     - a conta conferida, com a forma Pix.

     Você completa e salva como sempre. Depois, volta e confere de novo. A conferência só fica gravada quando bate.

   - **"Criar ajuste de R$ 34,56"** cria um lançamento de ajuste que zera a diferença, marca a conta como conferida hoje e fecha o diálogo. O aviso "Ajuste de R$ 34,56 criado" tem "Desfazer". Desfazer apaga o ajuste, mas a data da conferência fica.
4. **"Voltar"** volta ao passo 1, para corrigir o saldo digitado.

### O ajuste

- **No modelo, é uma despesa ou uma receita marcada como ajuste** (`adjustment: true`):
  - despesa, quando o banco tem menos; receita, quando tem mais;
  - o valor é o tamanho da diferença;
  - a data é hoje e a conta é a conferida;
  - sem categoria, sem estabelecimento, sem parcelas e sem assinatura;
  - a observação é "Ajuste da conferência de saldo";
  - a forma gravada é Pix, que a tela não mostra.
- **Ele mexe no saldo da conta**, como qualquer despesa ou receita. É o que zera a diferença.
- **Ele fica fora dos indicadores:**
  - `spendingByCategory` e `incomeByCategory`, a base do dashboard (task 23);
  - os totais por dia da lista de lançamentos;
  - a contagem do lembrete diário (task 17);
  - as categorias mais usadas e a memória por estabelecimento (ele não tem nenhum dos dois).
- **Na lista de lançamentos (task 14):**
  - aparece como "Ajuste de saldo", na linha "Banco Azul · Conferência", com o sinal certo;
  - não entra no filtro "Sem categoria" e não pode ser categorizado em massa;
  - tocar abre um diálogo só com os dados e o botão **"Excluir"**. Um ajuste não se edita: para mudar, exclua e confira de novo;
  - o filtro de tipo "Despesa" ou "Receita" o inclui.
- **A migration** acrescenta `adjustment` ao lançamento, com um `CHECK`: um ajuste é despesa ou receita, fora do crédito, sem categoria, estabelecimento, parcelas ou assinatura.

### A conferência

- **A conta guarda** `reconciledOn` (o dia, um dia de calendário) e `reconciledBalanceCents` (o saldo do banco naquele dia). Uma conferência nova substitui a anterior. O histórico de conferências fica fora do escopo.
- **Ela é gravada** quando o saldo bate ("Marcar como conferido") ou junto com o ajuste.
- **O saldo comparado** é o de hoje, até o fim do dia em São Paulo, o mesmo de `/contas` (`accountBalances`).

### Regras e servidor

- **`src/domain/reconciliation.ts`**, funções puras com testes:
  - `reconciliationDiff(saldoNoApp, saldoNoBanco)` devolve a diferença (banco − app) e a direção: `MISSING_EXPENSE`, `MISSING_INCOME` ou `MATCH`;
  - `adjustmentFor(diferença)` devolve o tipo e o valor do ajuste, ou nada quando bate.
- **`reconcileAccount(spaceId, contaId, saldoNoBanco, { adjust, clientId, expectedDiffCents })`:**
  - trava a conta e recalcula o saldo do app no servidor, dentro da transação do banco, sem confiar no que a tela mostrou;
  - se a diferença não é mais a que a tela mostrou (`expectedDiffCents`), não grava nada e devolve o saldo novo. A tela atualiza a comparação e avisa;
  - quando bate, grava a conferência;
  - com `adjust` e diferença, cria o ajuste, idempotente pelo `clientId` como os outros lançamentos, e grava a conferência, na mesma transação do banco;
  - sem `adjust` e com diferença, devolve a diferença e não grava nada;
  - uma conta de outro espaço, ou arquivada, é recusada.
- **`accountRecentEntries(spaceId, contaId, desde)`:** os 10 lançamentos mais recentes da conta, do dia do saldo inicial até hoje.
- **Antes de comparar e de conferir,** as cobranças de assinatura vencidas são geradas (task 13), para o saldo já ter as de hoje.
- **O ajuste também fica fora** da forma de pagamento que o registro lembra e do filtro de forma da lista: a forma dele não é escolha de ninguém.
- **Server Actions com Zod:**
  - comparar: devolve o saldo do app, a diferença e os lançamentos;
  - confirmar: marca como conferido, ou cria o ajuste;
  - o "Desfazer" usa a exclusão que já existe.
- **O registro aceita, na URL,** `?valor=3456&tipo=despesa|receita&conta=<id>` para começar preenchido. Valores inválidos ou de outra conta são ignorados, e o registro começa como sempre.

## Critérios de aceite

- [ ] CA1 — Unitário: a diferença e a direção saem certas para o banco com mais, com menos, igual e com saldos negativos.
- [ ] CA2 — Integração:
  - o ajuste zera a diferença: o saldo da conta passa a ser o do banco;
  - o ajuste não entra em `spendingByCategory` nem em `incomeByCategory`, nem nos totais por dia da lista;
  - a conferência fica gravada com o dia e o saldo.
- [ ] CA3 — Integração:
  - repetir o ajuste com o mesmo `clientId` não duplica;
  - conta de outro espaço ou arquivada é recusada;
  - sem `adjust`, nada é gravado;
  - o banco recusa um ajuste com categoria ou no crédito.
- [ ] CA4 — Integração: um ajuste não se edita nem entra na categorização em massa, e a exclusão funciona.
- [ ] CA5 — E2E (Chromium e iPhone/WebKit):
  - conferir com diferença mostra o texto e os últimos lançamentos;
  - "Criar ajuste" deixa o saldo igual ao do banco e a conta "Conferido em" hoje;
  - "Registrar o que falta" abre o registro com o valor e o tipo certos.
- [ ] CA6 — Lint, format, test, build, `test:e2e:docker` e CI verdes. Telas conferidas no desktop e no viewport do iPhone.

## Casos de borda

- **Um lançamento de hoje registrado depois de conferir:** o saldo muda, e a próxima conferência mostra a diferença nova. A data da conferência anterior não muda.
- **Saldo inicial informado hoje** (task 6) e conferido em seguida: bate, se nada foi lançado.
- **Diferença de centavos:** vale como qualquer outra. Não há tolerância, porque o dinheiro é em centavos exatos.
- **Conta arquivada:** não tem o botão. Ajustes antigos dela continuam no saldo.
- **Desfazer o ajuste:** o saldo volta a ter a diferença, e a conta continua "Conferido em" hoje. Conferir de novo mostra a diferença.

## Decisões

- **O ajuste é uma despesa ou receita marcada, e não um tipo novo.** O saldo, a lista e o sync já tratam despesa e receita. Um tipo novo mexeria em todos eles. A marca basta para tirá-lo dos indicadores.
- **A conferência só é gravada quando bate**, seja por estar certo, seja pelo ajuste. "Conferido em" quer dizer "o app e o banco batiam nesse dia".
- **"Registrar o que falta" leva ao registro normal** em vez de um formulário no diálogo. O registro já tem a memória, as categorias e a fila offline.
- **Sem tolerância e sem casar linha a linha.** Casar com o extrato é a fase de importação, fora da v1 (design).

## Revisão

O revisor (Opus, effort high) pediu mudanças, sem bloqueios. Corrigido:

- **O ajuste virava a forma de pagamento padrão do registro** (era o último lançamento do tipo): o registro passava a abrir em "conta · Pix". Agora o ajuste fica fora da memória de pagamento. Há teste.
- **O diálogo ficava aberto e desatualizado depois de "Registrar o que falta".** Ao voltar para `/contas`, o botão ainda oferecia o ajuste do valor antigo. Agora o diálogo fecha no link. O servidor só confere a diferença que a tela mostrou; se ela mudou, nada é gravado e a tela mostra os valores novos. O aviso usa o valor gravado.
- **Uma resposta "o saldo mudou"** deixava a tela dizendo "bate". Agora a comparação é refeita com o saldo novo.
- **Dois aparelhos conferindo ao mesmo tempo** criavam dois ajustes. A conta é travada e o saldo recalculado dentro da transação: o segundo vê a diferença nova e não grava. Há teste.
- **O `clientId` de um lançamento comum** nunca é tomado como o ajuste.
- **"Excluir" um ajuste** pede confirmação, como os outros lançamentos.
- **As assinaturas de hoje** são geradas antes de comparar.
- **A lista do diálogo** começa no dia do saldo inicial.
- **O filtro de forma "Pix" da lista** não traz ajustes.
- **O campo `adjustment` nos totais é obrigatório**, para nenhum chamador futuro (o dashboard, task 23) esquecer de selecioná-lo.
- **Uma diferença acima de R$ 20.000.000,00** é recusada com mensagem, em vez de estourar o banco.
- **Testes novos:**
  - a memória de pagamento;
  - a corrida entre aparelhos;
  - o saldo que mudou;
  - o `clientId` de outro lançamento;
  - a conta arquivada na comparação;
  - o `CHECK` conferido pelo nome, incluindo uma transferência;
  - no e2e, o "Desfazer" do ajuste, o preenchimento com uma segunda conta e uma URL inválida no registro.

Aceito:

- **O resultado é anunciado pelo `role="status"`**, sem mover o foco para ele. Alguns leitores de tela podem não ler um status montado já com o texto. Fica para a revisão de acessibilidade (task 26).

## Fora do escopo

- O histórico das conferências.
- Conferir a fatura do cartão com o banco.
- Importar o extrato e casar linha a linha.
- Um lembrete para conferir ("faz 30 dias que você não confere").
