# 13 — Assinaturas: regras recorrentes e geração mensal

Issue: #13 · Design: [Modelo de dados](../v1-design.md#modelo-de-dados-v1-preparado-para-a-fase-2) · [Regras de domínio](../v1-design.md#regras-de-domínio-que-eu-decidi-o-joão-confere)

## Objetivo

Registrar uma assinatura (streaming, academia, plano de celular) uma vez, e o app passa a lançar a cobrança todo mês sozinho, sem duplicar. As regras alimentam os gastos fixos e o comprometido futuro do dashboard (task 23). As mudanças de valor ficam registradas para o alerta "assinatura mudou de valor" (task 24).

## Comportamento

### Modelo

- **`RecurringRule`** (a assinatura):
  - `spaceId` e `createdById`;
  - valor (`amountCents`) e dia do mês (`dayOfMonth`, de 1 a 31);
  - forma de pagamento, conta ou cartão, categoria, estabelecimento e observação, nas mesmas combinações de uma despesa (task 8);
  - `status` (`ACTIVE`, `PAUSED` ou `CANCELED`) e `canceledAt?`;
  - `firstMonth` e `nextMonth` (`YYYY-MM`). O `nextMonth` é o primeiro mês que a geração ainda não examinou.
- **`RecurringRuleChange`** (o histórico de valor): a regra, o valor anterior, o valor novo e o dia da mudança (`changedOn`, dia de calendário).
- **`Transaction`** ganha `recurringRuleId?` e `recurringMonth?` (`YYYY-MM`), com `@@unique([recurringRuleId, recurringMonth])`: uma cobrança por regra e por mês, garantida pelo banco.
- **Migration `recurring_rules`,** com `CHECK`:
  - dia de 1 a 31 e valor maior que zero;
  - na regra, a forma, a conta e o cartão nas mesmas combinações da despesa;
  - no lançamento, `recurringRuleId` e `recurringMonth` juntos, só em despesa.
- **Só despesa e só mensal na v1.** Uma receita recorrente (como o salário) e outras periodicidades ficam fora do escopo.

### Regras (`src/domain/recurring.ts`, com testes)

- **`occurrenceDate(regra, mês)`:** o dia da cobrança naquele mês. O dia que o mês não tem vira o último: dia 31 cai em 30/04 e em 28/02 (ou 29/02).
- **`dueMonths(regra, hoje)`:** os meses a gerar, do `nextMonth` até o mês atual, desde que a data da cobrança já tenha chegado. Nunca gera cobrança futura.
- **Geração em atraso:** se o app ficou dois meses sem ser aberto, a próxima abertura gera as duas cobranças, cada uma na sua data.
- **Status:**
  - **ativa:** gera e avança o `nextMonth`;
  - **pausada:** avança o `nextMonth` sem gerar, então os meses pausados são pulados;
  - **cancelada:** não gera mais nada e não volta a ficar ativa.
- **Retomar uma pausa** põe o `nextMonth` no primeiro mês cuja cobrança ainda não passou. Assim, retomar não cria as cobranças dos meses pausados, mesmo que o app não tenha sido aberto durante a pausa.

### Geração (`src/server/recurring.ts`)

- **`generateRecurring(spaceId)`:**
  - cria as cobranças dos meses vencidos de todas as regras ativas do espaço;
  - avança o `nextMonth` das ativas e das pausadas.
- **Cada cobrança é uma despesa comum:**
  - leva o valor atual da regra, a data da cobrança, a forma, a conta ou o cartão, a categoria, o estabelecimento e a observação da regra;
  - no crédito, a fatura vem do ciclo da data, como numa compra à vista;
  - o `clientId` é determinístico: `rule:<id>:<YYYY-MM>`.
- **Sem duplicar.**
  - A inserção usa `skipDuplicates`, ou seja, `ON CONFLICT DO NOTHING` sobre o índice único (regra, mês).
  - Duas gerações ao mesmo tempo, ou repetidas, resultam numa cobrança por mês.
  - Excluir a cobrança de um mês não faz ela voltar, porque o `nextMonth` já passou daquele mês.
- **Conta, cartão ou categoria arquivados depois** não impedem a cobrança: a assinatura continua cobrando até ser cancelada.
- **Quando roda:**
  - ao abrir as telas que mostram dinheiro: início, contas e registro. Normalmente é uma consulta só, que não acha nada;
  - pelo cron diário, quando ele existir (task 17). A função já serve para ele.

### Criar pelo registro

- Na tela de registro, com Despesa, aparece a opção **"Assinatura"**, um interruptor que vale para qualquer forma de pagamento. Ligado, ele mostra "Repete todo dia 8", com o dia da data escolhida.
- **"Assinatura" e "Parcelado" não andam juntos:** ligar um desliga o outro. O Zod também recusa os dois juntos: "Uma compra parcelada não pode ser assinatura.".
- Salvar cria a regra e a primeira cobrança, no mês da data escolhida, numa só operação no banco.
  - Pode ser uma data passada: você registra hoje a assinatura que cobrou no dia 5.
  - Dia 31 vira o dia da regra, e nos meses curtos cai no último dia.
- **Idempotência:** a primeira cobrança leva o `clientId` do aparelho. Repetir o envio devolve o que já existe, sem criar uma segunda regra.
- **Aviso:** "Assinatura de R$ 39,90 salva". O "Desfazer" desfaz a assinatura inteira: a regra e todas as cobranças dela. Com uma data passada, a tela inicial já gera os meses seguintes logo depois de salvar, e o "Desfazer" leva esses também. Desfazer uma cobrança gerada depois (task 14) apaga só ela.

### Mudanças e status

- **`updateRecurringRule(spaceId, regra, { amountCents })`** muda o valor das próximas cobranças e grava a mudança no histórico, com o dia de hoje. As cobranças já geradas não mudam.
- **Editar uma cobrança** com `updateRule: true` faz duas coisas: muda o valor daquela cobrança e o da regra, e grava a mudança. É a resposta "sim" à pergunta "Atualizar a assinatura?". Sem a opção, só a cobrança muda. A pergunta na tela vem com a edição de lançamentos (task 14).
- **`setRecurringRuleStatus(spaceId, regra, status)`:** pausar, retomar e cancelar. Cancelar é definitivo.
- **Server Actions com Zod** para esses três. A tela de assinaturas, onde ficam os botões, é a task 19.
- Tudo restrito ao espaço.

### Contagens de uso

- As cobranças geradas automaticamente não contam nas categorias mais usadas (task 9) nem na memória por estabelecimento (task 10).
- Conta só a primeira cobrança, a que você registrou. Sem isso, cada assinatura entraria todo mês no topo das sugestões, sem você nunca ter digitado.

## Critérios de aceite

- [ ] CA1 — Unitário e integração: rodar a geração duas vezes no mesmo mês, ou duas ao mesmo tempo, não duplica. Excluir a cobrança de um mês não a faz voltar.
- [ ] CA2 — Unitário: o dia 31 gera em 30/04, em 28/02/2026 e em 29/02/2028. O dia 30 gera em 28/02.
- [ ] CA3 — Integração:
  - a mudança de valor fica registrada com o dia, o valor anterior e o novo, pela regra e pela edição com `updateRule`;
  - as próximas cobranças usam o valor novo, e as já geradas ficam como estavam.
- [ ] CA4 — Integração:
  - uma regra cancelada não gera mais;
  - uma pausada pula os meses da pausa;
  - retomar não cria as cobranças atrasadas.
- [ ] CA5 — Integração:
  - criar pelo registro grava a regra e a 1ª cobrança juntas, e o mesmo `clientId` não duplica nenhuma das duas;
  - dois meses sem abrir o app geram as duas cobranças, cada uma na sua data;
  - no crédito, a cobrança cai na fatura certa;
  - o saldo da conta cai a cada cobrança;
  - outro espaço não vê nem mexe.
- [ ] CA6 — Integração: as cobranças geradas não contam nas categorias mais usadas nem na memória por estabelecimento.
- [ ] CA7 — E2E (Chromium e iPhone/WebKit):
  - registrar "Streaming" de R$ 39,90 com "Assinatura" mostra "Repete todo dia N" e o aviso "Assinatura de R$ 39,90 salva";
  - o "Desfazer" apaga a cobrança e a regra.
- [ ] CA8 — Lint, format, test, build, `test:e2e:docker` e CI verdes. Tela conferida no iPhone (viewport) e no desktop.

## Casos de borda

- **Regra criada em 31/01:** a cobrança de fevereiro sai em 28/02 e a de março em 31/03. O dia da regra continua 31.
- **Geração no dia 10 com cobrança no dia 15:** o mês atual ainda não gera. Gera na primeira abertura a partir do dia 15.
- **Cobrança gerada excluída (task 14):** não volta. Se você quiser de novo, registra à mão.
- **Valor alterado no mesmo dia duas vezes:** ficam duas mudanças no histórico, na ordem em que foram feitas.
- **Desfazer uma assinatura com data passada:** a tela inicial gera os meses desde então logo depois de salvar, e o "Desfazer" apaga a regra e todas essas cobranças.

## Decisões

- **Uma cobrança por regra e por mês, garantida pelo banco** (`@@unique` mais `skipDuplicates`), e não só pelo código. A geração vai rodar em lugares diferentes, nas telas e no cron, ao mesmo tempo.
- **Um cursor (`nextMonth`) em vez de olhar o que já existe.** Ele separa "já examinado" de "existe": uma cobrança excluída não volta, e os meses pausados não voltam ao retomar.
- **Gerar ao abrir as telas, sem esperar o cron.** O plano Hobby da Vercel roda o cron uma vez por dia, e a task 17 ainda não existe. Abrir o app já deixa tudo em dia, com uma consulta barata.
- **Nunca gerar cobrança futura.** O saldo e as faturas mostram o que já aconteceu. O comprometido futuro (task 23) calcula os próximos meses a partir das regras, sem criar lançamentos.
- **Só despesa.** "Assinatura" é o caso do design. Uma receita recorrente, como o salário, é outra conversa: o valor varia e não é cobrado. Fica para depois, se fizer falta.
- **O histórico de valor é uma tabela própria,** e não um campo, porque o alerta da task 24 precisa da sequência de mudanças com as datas.

### Revisão

O revisor (Opus, effort high) pediu mudanças por um problema grave, já corrigido.

- **Editar uma cobrança de assinatura para receita** dava erro 500: o banco recusa pelo `CHECK`, e o servidor não tratava. Agora a resposta é "Uma cobrança de assinatura é sempre uma despesa.", com teste.
- **Cancelar não era definitivo numa corrida:** cancelar e retomar ao mesmo tempo podia terminar "ativa", com data de cancelamento. As mudanças de status agora são escritas sob condição, então o cancelamento sempre ganha. Há teste.
- **"Desfazer" de uma assinatura com data passada** deixava a regra e a cobrança do mês seguinte, que a tela inicial gera logo depois de salvar, e só apagava a primeira. Agora o "Desfazer" da 1ª cobrança desfaz a assinatura inteira. Há teste. É uma mudança em relação à spec aprovada, registrada em Comportamento.
- **Geração com cursor velho:** uma geração que leu um cursor antigo podia trazer de volta uma cobrança excluída no meio do caminho, ou falhar depois de um "Desfazer". Agora a geração toma o cursor antes de inserir, numa transação, e só insere se conseguiu tomá-lo. O "Desfazer" cancela a regra antes de apagar.
- **Uma falha na geração derrubava a tela** inicial, a de contas ou a de registro. Agora ela é registrada no log, e a tela abre.
- **Testes novos:** a observação sugerida ignora as cobranças geradas (a consulta SQL), e a geração passa o cursor de uma assinatura pausada sem cobrar.
- **O "Desfazer" do aviso** mostra um erro se a rede falhar, em vez de uma rejeição silenciosa.
- **Aceito:**
  - **Gravar no banco ao abrir a tela.** A documentação do Next desaconselha efeitos na renderização. A geração é idempotente, só grava quando há cobrança vencida e roda depois da sessão (nada roda no build). O cron (task 17) é o caminho limpo, e a geração nas telas fica como garantia.
  - **Faturas e lançamentos ainda não geram:** as telas deles são das tasks 14 e 18, que chamam a mesma função.
  - **O "Atualizar a assinatura?"** ignora uma assinatura cancelada e não é atômico com a edição da cobrança. A task 14 decide o que mostrar.
  - **"Load failed" no log do WebKit:** é o aborto de requisição na troca de página, já visto na task 9. Rodando sem paralelismo, não aparece.

## Fora do escopo

- Tela de assinaturas, com lista, pausar, cancelar e totais (task 19).
- A pergunta "Atualizar a assinatura?" na edição (task 14). O servidor já aceita a resposta.
- Periodicidade anual ou semanal (a v1 é só mensal).
- Receitas recorrentes.
- O cron (task 17) e o comprometido futuro (task 23).
- Registrar assinaturas já ativas no primeiro uso (task 22).
