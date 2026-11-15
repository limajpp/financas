# 19 — Tela de assinaturas

Issue: #19 · Design: [Telas](../v1-design.md#telas) · [Indicadores](../v1-design.md#indicadores-e-insights-v1-por-regras) · [Regras e geração](13-subscriptions.md)

## Objetivo

Ver de uma vez quanto as assinaturas custam por mês e por ano, perceber quais ficaram mais caras e cuidar delas (pausar, cancelar, editar) sem procurar as cobranças na lista de lançamentos. As regras, a geração mensal e o histórico de valor já existem desde a task 13. Esta task é a tela em cima deles.

## Comportamento

### Tela `/assinaturas`

- **Topo, com dois números:**
  - **Por mês:** a soma das assinaturas ativas;
  - **Por ano:** o mesmo × 12.
  - Abaixo deles, "N assinaturas ativas". As pausadas e as canceladas não entram nos totais.
- **Ativas**, da mais cara para a mais barata. Cada linha mostra:
  - o nome (o estabelecimento; sem ele, a observação; sem os dois, a categoria);
  - o valor por mês e, menor, o valor por ano;
  - "Todo dia 8 · Cartão Roxo" (ou a conta e a forma, como "Banco Azul · Pix");
  - a categoria, com o ícone dela;
  - "Próxima cobrança em 08/12/2026".
- **Mudou de valor:** uma assinatura cujo valor mudou nos últimos 90 dias ganha um destaque na linha:
  - "Era R$ 34,90 · subiu em 05/11/2026" (ou "baixou");
  - com mais de uma mudança no período, o "era" é o valor de antes da primeira delas.
- **Pausadas:** uma seção própria, com "Pausada desde 05/11/2026" no lugar da próxima cobrança.
- **Canceladas:** escondidas, atrás de "Mostrar canceladas", com "Cancelada em 05/11/2026". Elas servem só de histórico: não têm ações.
- **Sem nenhuma assinatura:** "Nenhuma assinatura ainda. Ao registrar uma despesa, ligue “Assinatura” para ela se repetir todo mês." e um link "Registrar" para `/registrar`.
- **Acesso:** a tela já está no menu lateral do desktop e em Configurações no celular.

### Ações (por assinatura)

Tocar numa linha abre um diálogo (folha de baixo no celular) com os detalhes e as ações.

- **Editar.** Os campos são:
  - valor;
  - dia do mês (1 a 31);
  - categoria (só as de despesa);
  - forma de pagamento com a conta ou o cartão, nas mesmas combinações da despesa (task 8);
  - observação.
  - As mudanças valem para as **próximas cobranças**. As já geradas não mudam.
  - Mudar o valor grava a mudança no histórico, como na task 13.
  - **Aviso:** "Assinatura atualizada".
- **Pausar:** pede confirmação ("Pausar a Netflix? Os meses pausados não são cobrados."). Uma pausada ganha **Retomar**, que volta a cobrar a partir da próxima data, sem cobrar os meses pausados (task 13).
- **Cancelar:** pede confirmação ("Cancelar a Netflix? Não dá para desfazer."), e é definitivo.
- **Ver cobranças:** abre `/lancamentos` filtrado pelo estabelecimento da assinatura (o filtro da task 14), com o período desde o mês da 1ª cobrança. Só aparece quando a assinatura tem estabelecimento.

### Regras e servidor

- **`src/domain/subscriptions.ts`**, funções puras com testes:
  - `subscriptionTotals(regras)`: a soma das ativas por mês e por ano (mês × 12), e a contagem;
  - `recentChange(mudanças, hoje)`: o "era X, subiu/baixou em D" dos últimos 90 dias, ou nada;
  - `nextChargeDate(regra, hoje)`: a data da próxima cobrança de uma ativa, a partir do `nextMonth` e do dia (com o último dia nos meses curtos, `occurrenceDate`).
- **`listSubscriptions(spaceId)`:**
  - devolve as regras do espaço com a conta, o cartão, a categoria, o estabelecimento e as mudanças dos últimos 90 dias;
  - roda antes `generateRecurringSafely`, para a tela mostrar as próximas datas em dia.
- **`updateRecurringRule`** passa a aceitar, além do valor, o dia, a categoria, a forma com a conta ou o cartão e a observação. Ele valida como uma despesa nova:
  - conta, cartão e categoria do espaço, ativos, e a categoria do tipo despesa;
  - mas a conta, o cartão ou a categoria que a regra já tinha podem continuar, mesmo arquivados (como na edição de lançamentos);
  - uma regra cancelada não muda (`CANCELED`).
- **Mudar o dia não duplica nem pula cobranças.** O cursor (`nextMonth`) continua o mesmo: se o mês atual já foi cobrado, o dia novo vale a partir do mês seguinte; se não, a cobrança deste mês sai no dia novo, quando ele chegar (ou na próxima abertura, se já passou).
- **Server Actions com Zod:** editar (a action da task 13 passa a receber os campos novos), pausar, retomar e cancelar (já existem). Tudo restrito ao espaço.

## Critérios de aceite

- [ ] CA1 — Unitário: o total anual é a soma mensal das ativas × 12. Pausadas e canceladas não entram.
- [ ] CA2 — Unitário: o destaque de mudança aparece até 90 dias depois dela, diz "subiu" ou "baixou", e com duas mudanças usa o valor de antes da primeira.
- [ ] CA3 — Unitário: a próxima cobrança de uma regra de dia 31 com `nextMonth` em fevereiro cai em 28/02 (ou 29/02); com o mês atual já cobrado, cai no mês seguinte.
- [ ] CA4 — Integração:
  - editar valor, dia, categoria, forma e observação muda a regra, e as cobranças já geradas ficam iguais;
  - o valor novo vai para o histórico;
  - uma categoria de receita, ou uma conta ou cartão de outro espaço, são recusados;
  - uma regra cancelada não muda;
  - mudar o dia não gera cobrança duplicada no mês.
- [ ] CA5 — E2E (Chromium e iPhone/WebKit): uma assinatura que mudou de valor aparece destacada, com o valor anterior.
- [ ] CA6 — E2E: os totais por mês e por ano batem com as assinaturas ativas. Pausar tira a assinatura dos totais e a põe em "Pausadas". Cancelar a leva para as canceladas.
- [ ] CA7 — Lint, format, test, build, `test:e2e:docker` e CI verdes. Tela conferida no desktop e no viewport do iPhone.

## Casos de borda

- **Assinatura cujo dia ainda não chegou neste mês** e cujo mês ainda não foi cobrado: a próxima cobrança é este mês.
- **Conta ou cartão arquivados depois:** a assinatura continua cobrando (task 13) e mostra o nome com "(arquivada)" / "(arquivado)". Editar pode mantê-los, ou trocar por um ativo.
- **Assinatura sem estabelecimento** (registrada só com a categoria): o nome é a observação ou a categoria, e "Ver cobranças" não aparece.
- **Valor alterado de volta** (34,90 → 39,90 → 34,90 em 90 dias): o destaque compara o valor de antes da primeira mudança com o atual. Se forem iguais, não há destaque.

## Decisões

- **Totais só das ativas.** Uma pausada não sai do bolso agora. O "comprometido futuro" (task 23) é que olha os próximos meses.
- **Destaque por 90 dias.** Tempo para notar no próximo extrato. O alerta "assinatura mudou de valor" do dashboard (task 24) usa o mesmo histórico.
- **Editar a regra, não o estabelecimento.** O nome vem do estabelecimento, que tem memória e apelidos (task 10). Trocar a assinatura de estabelecimento é cancelar e registrar de novo, e a tela de estabelecimentos (task 20) é onde o nome se corrige.
- **Mudar o dia mantém o cursor.** É a forma de nunca cobrar duas vezes o mesmo mês, que o banco também garante (task 13).
- **Canceladas escondidas por padrão.** Viram ruído rápido, mas o histórico continua lá.

## Fora do escopo

- Criar assinatura pela tela (continua pelo registro, task 13).
- Receitas recorrentes e outras periodicidades (anual, semanal).
- Projeção das próximas cobranças nas faturas e o comprometido futuro (task 23).
- O insight "assinatura mudou de valor" no dashboard (task 24).
- Avisar antes de uma cobrança (push de "vai cobrar amanhã").
