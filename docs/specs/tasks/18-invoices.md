# 18 — Faturas por cartão e vencimento

Issue: #18 · Design: [Telas](../v1-design.md#telas) · [Regras de domínio](../v1-design.md#regras-de-domínio-que-eu-decidi-o-joão-confere) · [Ciclo da fatura](07-cards.md) · [Resumo das faturas](11-transfers-card-payments.md)

## Objetivo

O gasto no crédito conta no mês da compra, mas o João precisa saber quanto paga em cada vencimento. A tela `/faturas` mostra, por cartão, a fatura atual, as próximas (com as parcelas futuras) e as anteriores, cada uma com o total e se já foi paga. O detalhe de uma fatura lista o que caiu nela e permite pagá-la. Esta task também traz o **estorno no crédito** e a troca de fatura das **parcelas**, que as tasks 8, 11 e 12 deixaram para cá.

## Comportamento

### Estorno no crédito

Estorno é dinheiro que volta para o cartão: uma compra devolvida ou cancelada.

- **No modelo, é uma receita no crédito:** `type: INCOME` com `method: CREDIT`. Assim como a compra no crédito, ele:
  - aponta para um cartão e uma fatura (`cardId`, `invoiceDueDate`), sem conta (`accountId` nulo);
  - não mexe no saldo de nenhuma conta;
  - cai na fatura pelo ciclo da data do estorno, e aceita a troca manual de fatura (janela de 3, task 8).
- **Na fatura, ele abate o total:** total = compras − estornos. Um estorno maior que as compras deixa a fatura com crédito (total negativo), que aparece como "R$ 50,00 de crédito".
- **Nos indicadores, ele é uma receita.** A categoria padrão é "Reembolsos", e ele entra em `incomeByCategory`. Como abater o estorno no gasto da categoria original é decisão do dashboard (task 23).
- Não pode ser parcelado nem virar assinatura.
- **A migration** muda a restrição `Transaction_shape_check` para aceitar `INCOME` no crédito com o mesmo formato da compra no crédito. As outras restrições não mudam: parcelas e assinaturas continuam só em despesas.

### Registro do estorno

- **Em `/registrar`, com "Receita" escolhida, as formas ganham "Crédito".** Com ela:
  - a linha "conta · forma" vira "cartão · forma", como numa despesa no crédito, com o mesmo padrão de cartão;
  - a categoria sugerida é "Reembolsos";
  - as opções de parcelar e de assinatura não aparecem;
  - o botão é "Salvar estorno", e o aviso diz "Estorno de R$ 89,90 salvo", com o "Desfazer".
- **Na edição (task 14)** vale o mesmo: uma receita pode ir para o crédito e voltar para Pix, TED, dinheiro ou boleto.
- **Na lista de lançamentos**, o estorno aparece como receita, com o nome do cartão e "Estorno" ("Cartão Roxo · Estorno"). O filtro de forma "Crédito" passa a incluir os estornos.
- **Depois de salvar um estorno**, a próxima receita volta a começar na forma de sempre, e não no crédito.
- O sync offline (task 16) aceita o estorno pela mesma validação, sem mudança no protocolo.

### Tela `/faturas`

- **Seletor de cartão** no topo, em forma de abas (que rolam na horizontal no celular):
  - os cartões ativos, em ordem alfabética;
  - depois deles, os arquivados, marcados como "arquivado";
  - o cartão escolhido fica na URL (`/faturas?cartao=<id>`). Sem ele, ou com um id que não é do espaço, abre o primeiro cartão ativo.
- **Cabeçalho do cartão:** nome, "fecha dia 3 · vence dia 10" pelo ciclo atual e, se cadastrado, "Limite R$ 5.000,00".
- **Fatura atual** (a aberta), em destaque:
  - vencimento, fechamento e total;
  - "Ver fatura", que abre o detalhe;
  - "Pagar fatura", que abre o diálogo da task 11 já nessa fatura.
- **Próximas:** as faturas futuras com algum lançamento, em geral as parcelas, do vencimento mais próximo ao mais distante. Cada linha tem o vencimento e o total.
- **Anteriores:** as fechadas, da mais recente para a mais antiga. Cada linha tem o vencimento, o total e o status:
  - **"Paga"**, quando o saldo em aberto é zero;
  - **"A pagar R$ 120,00"**, quando falta pagar, em destaque;
  - **"R$ 50,00 de crédito"**, quando foi pago a mais ou os estornos superaram as compras.
  - Aparecem as 6 mais recentes. Se houver mais, um botão "Mostrar anteriores" mostra todas.
- Cada linha abre o detalhe daquela fatura.
- **Sem cartões:** "Você ainda não tem cartões." e um link "Cadastrar cartão" para `/contas`.
- **Acesso:** a tela já está no menu lateral do desktop e em Configurações no celular. Em `/contas`, cada cartão ganha o link "Ver faturas".
- **Navegação com rota dinâmica:** o detalhe é a primeira página com um segmento dinâmico. Os links do menu e o componente que guarda as telas visitadas leem o endereço, e por isso ficam dentro de um `Suspense`, como o Cache Components exige. Nessa página, o item do menu aparece marcado só depois que ela carrega.

### Detalhe da fatura (`/faturas/<cardId>/<vencimento>`)

- **Cabeçalho:**
  - cartão e status ("Aberta", "Futura", "Paga", "A pagar");
  - "Vence em 10/12/2026 · fechou em 03/12/2026" (ou "fecha em", se ainda não fechou);
  - o total, o pago e quanto falta.
- **Botão "Pagar fatura"** (diálogo da task 11, já nesta fatura). Ele não aparece numa fatura sem nada a pagar.
- **Lançamentos:** as compras e os estornos da fatura, do mais recente para o mais antigo, cada um com a data, o estabelecimento ou a descrição, a categoria e o valor:
  - parcelas com o número ("2/10");
  - estornos com sinal de menos e a cor de receita;
  - tocar num lançamento abre o diálogo de edição da task 14.
- **Pagamentos:** os pagamentos desta fatura, com data, conta e valor. Tocar abre a edição do pagamento.
- **Endereço inválido:** um cartão de outro espaço, uma data inválida ou uma fatura que o cartão não tem mostram "Fatura não encontrada", com um link para `/faturas`. O cartão tem a fatura se algum lançamento cai nela, ou se ela é uma das faturas pagáveis (task 11).
- Todo o resto da tela vem dos mesmos dados do resumo. O total do cabeçalho é sempre a soma da lista.

### Trocar a fatura de um lançamento

- **Compra ou estorno avulso:** já é possível no diálogo de edição (task 8), dentro da janela de 3 faturas. O detalhe da fatura só leva até ele.
- **Parcela (novo):** o diálogo de edição de uma parcela ganha o campo "Fatura", com a mesma janela de 3 em torno da fatura calculada para aquela parcela.
  - Trocar a fatura da parcela 3 de 10 move **essa e as seguintes**: elas continuam uma por fatura a partir da escolhida. As anteriores, em geral já pagas, ficam onde estão.
  - As parcelas movidas ficam com `invoiceOverridden: true`, menos a que volta para a fatura calculada.
  - A parcela não pode ir para a fatura de uma parcela anterior, nem antes dela: "Uma parcela não pode ir para a fatura de uma parcela anterior, nem antes dela."
  - O diálogo oferece as faturas da janela em torno da fatura calculada da parcela, com a mesma função que o servidor usa para conferir (`installmentInvoiceWindow`).
  - O caso de uso é o banco lançar a parcela uma fatura depois do esperado, e o resto seguir esse atraso.
- **Depois da troca**, as duas faturas, a de onde saiu e a para onde foi, mostram os totais novos, tanto na lista quanto no detalhe.

### Servidor

- **`invoiceSummaries`** (task 11) passa a receber os estornos e os desconta do total. As funções puras continuam em `src/domain/invoices.ts`, com testes.
- **`cardAmounts`** soma também as receitas no crédito.
- **`invoiceDetail(spaceId, cardId, dueDate)`** devolve:
  - o resumo da fatura;
  - os lançamentos e os pagamentos dela;
  - ou `null` se a fatura não for do cartão.
- **`cardsOverview(spaceId)`** devolve os cartões, com os resumos de todas as faturas, para a tela `/faturas`, numa quantidade fixa de consultas, qualquer que seja o número de cartões.
- **Validação do estorno:** `METHODS_BY_TYPE.INCOME` ganha `CREDIT`. `validateEntry` trata o crédito igual para despesa e receita. Parcelas e assinatura numa receita continuam recusadas.
- **Troca de fatura de parcelas:**
  - `updateInstallments` aceita `invoiceDueDate`, com qualquer escopo, e move as seguintes na mesma transação do banco que as outras mudanças. Uma fatura recusada desfaz tudo;
  - a nova função pura `shiftGroupInvoices` (em `installments.ts`) calcula as faturas novas;
  - mudar o valor e a fatura juntos segue as regras da task 12 para o valor.
- **Mudança de ciclo do cartão (task 7):** um grupo de parcelas com alguma parcela trocada à mão não é recalculado, do mesmo jeito que uma compra avulsa trocada à mão.

## Critérios de aceite

- [ ] CA1 — Unitário: o total da fatura é a soma das compras com aquele `invoiceDueDate`, menos os estornos. Um estorno maior que as compras dá total negativo e status de crédito.
- [ ] CA2 — Integração: `invoiceDetail` lista exatamente os lançamentos e pagamentos daquela fatura do cartão, com o total igual à soma da lista. Um cartão de outro espaço, ou uma fatura que o cartão não tem, devolve `null`.
- [ ] CA3 — E2E (Chromium e iPhone/WebKit): uma compra de 3× aparece na fatura atual e nas duas próximas, cada uma com o valor da parcela, e o detalhe mostra "1/3", "2/3" e "3/3".
- [ ] CA4 — Integração e e2e: mover um lançamento de fatura atualiza os totais das duas faturas. Mover a parcela 2 de 4 para a fatura seguinte leva a 3 e a 4 junto, e deixa a 1 onde estava.
- [ ] CA5 — Unitário e integração: o estorno no crédito não mexe no saldo de nenhuma conta, entra em `incomeByCategory` e não pode ser parcelado nem virar assinatura. A restrição do banco recusa uma receita no crédito sem cartão ou sem fatura.
- [ ] CA6 — E2E: registrar um estorno em `/registrar` reduz o total da fatura atual na tela `/faturas`.
- [ ] CA7 — Integração: mudar o ciclo de um cartão não recalcula um grupo de parcelas trocado à mão.
- [ ] CA8 — E2E: o status das anteriores ("Paga", "A pagar") segue os pagamentos registrados pelo diálogo, e pagar pelo detalhe atualiza o "falta pagar".
- [ ] CA9 — Lint, format, test, build, `test:e2e:docker` e CI verdes. Telas conferidas no desktop e no viewport do iPhone.

## Casos de borda

- **Cartão arquivado com fatura a pagar:** aparece no seletor, marcado como "arquivado", e a fatura pode ser paga, como na task 11.
- **Cartão sem nenhum lançamento:** mostra só a fatura atual, com R$ 0,00, e "Nenhuma fatura anterior".
- **Assinatura no crédito:** só aparece na fatura depois que a cobrança do mês é gerada (task 13). As cobranças dos meses seguintes não aparecem nas próximas faturas. Projetar o futuro das assinaturas é o "comprometido futuro" (task 23, mostrado no dashboard da task 25).
- **Mudança de ciclo:** faturas com vencimentos antigos continuam aparecendo enquanto tiverem lançamentos, com o fechamento calculado pela versão do ciclo que as gerou (`closingDateFor`, task 11).
- **Estorno em cartão arquivado:** recusado num lançamento novo (`CARD_ARCHIVED`), como uma compra. O estorno de uma compra de um cartão já cancelado não deve ser comum, e dá para registrá-lo como receita na conta.
- **Parcela movida depois de a 1ª ser apagada:** a sequência do grupo parte da menor parcela que sobrou, com a fatura que ela tem. Se essa parcela já tinha sido movida à mão, a janela passa a girar em torno da fatura movida. É raro e não perde dado: é a mesma regra do recálculo da task 12.
- **Mover a última parcela para fora da janela:** recusado com "Essa fatura não é deste cartão.", como na troca avulsa. As seguintes não são checadas contra a janela: elas só acompanham a parcela movida.

## Decisões

- **Estorno como receita no crédito, e não como um tipo novo.**
  - **Por quê:** o modelo já tem tudo o que precisa: cartão, fatura e categoria de receita ("Reembolsos" existe desde a task 5). Um tipo novo mexeria no saldo, nos filtros, no sync e em todas as somas.
  - **O custo:** nos indicadores, um estorno de R$ 100 aparece como receita, e não como um gasto R$ 100 menor. O dashboard (task 23) pode descontar os "Reembolsos" do gasto, se o João preferir.
- **O total da fatura sai do mesmo resumo da task 11.** A tela, o diálogo de pagamento e os testes usam a mesma função. Isso evita dois cálculos de "quanto falta".
- **Parcelas: "essa e as seguintes".** O atraso do banco costuma valer para o resto do parcelamento. Mover só uma parcela deixaria duas parcelas na mesma fatura e um buraco na outra.
- **A troca de fatura fica no diálogo de edição, e não em um botão "mover" separado.** É onde a troca avulsa já mora, e o detalhe da fatura só precisa abrir o diálogo.
- **Anteriores limitadas a 6 por padrão.** Seis meses cobrem a conferência do dia a dia, e o resto fica a um toque.

## Revisão

O revisor (Opus, effort high) aprovou com nits, sem bloqueios. Corrigido:

- **A janela de faturas de uma parcela era diferente no diálogo e no servidor.** O diálogo partia da data da parcela, e o servidor, da sequência do grupo. Elas divergem quando a data foi encurtada no fim de um mês curto e cruza o fechamento (ex.: fecha dia 30, compra em 29/01 em 3×: a 2ª parcela é de 28/02). Agora os dois usam `installmentInvoiceWindow`, e o diálogo parte da fatura que a parcela já tem quando ela não foi movida à mão. Teste novo com esse caso.
- **Mover uma parcela para trás podia deixar duas parcelas na mesma fatura**, contra a própria decisão da spec. Agora é recusado (`INSTALLMENT_ORDER`).
- **Uma parcela apagada no meio da troca de fatura** (outra aba) dava erro 500. Agora devolve "Lançamento não encontrado." e nada muda.
- **Total negativo** na fatura atual e nas próximas aparecia como "−R$ 50,00". Agora aparece como "R$ 50,00 de crédito", como nas anteriores.
- **Depois de um estorno, a próxima receita da mesma visita à tela** começava no crédito. Agora volta à forma de sempre.
- **Testes novos:** editar uma receita do Pix para o crédito e de volta (saldo e fatura), trocar a fatura com "esta e as próximas" junto da categoria, e um estorno vindo da fila offline (`/api/sync`).
- A janela de 3 faturas das parcelas usa a mesma constante da task 8.

Aceito ou ajustado na spec:

- **"Cartão Roxo · Estorno" na lista**, e não "Crédito": diz o que o lançamento é. A spec foi ajustada.
- **Âncora movida depois de a 1ª parcela ser apagada:** registrado nos casos de borda.
- **Segunda rodada: aprovado com nits, aplicados.** Da 2ª parcela em diante, o diálogo oferece só a fatura atual e as seguintes (as anteriores sempre esbarram na regra de ordem), e esse erro aparece junto do campo da fatura.
- **Aceito:** em dois casos raros o diálogo ainda pode oferecer uma fatura que o servidor recusa, com "Essa fatura não é deste cartão.", sem mexer em nada: uma parcela não movida num grupo que ficou fora de uma mudança de ciclo (por ter outra parcela movida), e uma parcela já movida com a data encurtada num mês curto. A correção completa seria o servidor mandar a fatura calculada de cada parcela na lista.
- **Também corrigido, por causa de um e2e instável antigo:** o diálogo "Novo cartão" aberto logo depois de criar a primeira conta abria sem conta escolhida, e salvar pedia "Escolha a conta que paga a fatura.". Agora a primeira conta vira o padrão assim que a lista chega.
- **O e2e do CA4 cobre a compra avulsa.** Mover a parcela 2 de 4 está nos testes de integração e de unidade, e usa o mesmo diálogo.

## Fora do escopo

- Limite disponível (limite − faturas em aberto). Só o limite cadastrado aparece.
- Juros, rotativo e pagamento mínimo.
- Importar a fatura do banco (PDF, OFX) e conciliar com os lançamentos.
- Projeção das assinaturas nas próximas faturas (task 23).
- Fatura atual de cada cartão na tela inicial (task 25).
