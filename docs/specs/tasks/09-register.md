# 09 — Tela única de registro (mobile-first)

Issue: #9 · Design: [Telas](../v1-design.md#telas) · [Anti-metas](../v1-design.md#anti-metas-o-que-faz-o-joão-largar-o-app) · [Decisões do João](../v1-design.md#decisões-do-joão)

## Objetivo

Registrar um gasto em poucos segundos no iPhone. Você digita o valor, toca numa categoria e salva. O resto já vem preenchido. É a primeira tela que usa os lançamentos da task 8.

## Comportamento

### Tela `/registrar`

De cima para baixo, numa coluna que cabe em 375 px sem rolagem horizontal:

1. **Despesa | Receita**, um seletor de dois botões no topo. Começa em Despesa. Trocar o tipo troca as categorias e a forma de pagamento lembrada.
2. **Valor** em destaque: "R$ 0,00" até você digitar.
3. **"O que foi?"**, um campo de texto opcional que vira o estabelecimento (`counterparty`) do lançamento. O autocomplete é da task 10.
4. **Categorias:** até 5 botões com as categorias mais usadas e um botão **"Mais"**, que abre uma folha com todas as categorias ativas do tipo (mães e subs). Tocar numa categoria a seleciona, e tocar de novo tira a seleção. Sem categoria, o lançamento vai como "Sem categoria". A categoria escolhida pelo "Mais" aparece no lugar do último botão, para você ver o que escolheu.
5. **Conta e forma de pagamento**, uma linha só: "Banco Inter · Débito". Tocar abre uma folha com:
   - as formas de pagamento aceitas pelo tipo (despesa: Pix, Débito, Crédito, Dinheiro, Boleto, TED; receita: Pix, TED, Dinheiro, Boleto);
   - a lista das contas ativas ou, no Crédito, a dos cartões ativos.
6. **Fatura**, só no Crédito: "Cai na fatura que vence em 12/11". Logo abaixo, um seletor nativo deixa trocar por uma das 3 faturas anteriores ou das 3 seguintes. É a janela da task 8.
7. **Data:** botões "Hoje" e "Ontem", mais um seletor de data nativo para outro dia, com o máximo em hoje. O padrão é hoje.
8. **"Mais detalhes"**, fechado por padrão: o campo "Observação" (`description`).
9. **Teclado numérico** da própria tela, sempre aberto: 1–9, 0, "00" e apagar.
10. **Salvar**, botão grande no fim, sempre visível.

### Valor digitado em centavos

- Cada dígito entra pela direita, como nos apps de banco: `4`, `7`, `9`, `0` → R$ 47,90. "00" acrescenta dois zeros. Apagar tira o último dígito.
- O valor para de aceitar dígitos no teto de R$ 20.000.000,00 (task 6). Um zero à esquerda não conta.
- No computador, o teclado físico também funciona: dígitos, Backspace e Enter (salva), desde que o foco não esteja num campo de texto.
- Fica num módulo puro (`src/domain/amount-keypad.ts`, com testes).

### Categorias mais usadas (`src/domain/register.ts`, com testes)

- `topCategories(uso, categorias, n = 5)`:
  - ordena as categorias selecionáveis do tipo pela quantidade de lançamentos nos últimos 90 dias;
  - em caso de empate, vale o uso mais recente;
  - completa com as categorias-mãe na ordem da lista padrão quando não há uso suficiente. Assim, no primeiro dia já aparecem Alimentação, Mercado etc.;
  - uma categoria arquivada (ou com a mãe arquivada) nunca aparece.
- O uso é contado no servidor, por espaço e tipo, só nos últimos 90 dias, para acompanhar mudanças de hábito.

### Última conta e forma de pagamento

- O servidor lê o lançamento mais recente (pela data de criação) de cada tipo: despesa e receita lembram em separado.
- `defaultPayment(último, contas, cartões, tipo)` (puro, com testes) decide o que vem selecionado:
  - a mesma forma de pagamento e a mesma conta ou cartão do último lançamento, se ainda estiverem ativos;
  - se o cartão do último crédito foi arquivado, o primeiro cartão ativo; sem cartão ativo, Pix na primeira conta;
  - se a conta foi arquivada, a primeira conta ativa com a mesma forma;
  - sem histórico: Pix na primeira conta ativa, em ordem alfabética.
- Lembrar pelo servidor, e não pelo aparelho: o celular e o computador ficam iguais.
- Ao trocar para Crédito na folha, vem o último cartão usado (ou o primeiro). Ao sair do Crédito, volta para a última conta.

### Salvar

- O botão fica desativado com valor zero. O valor é o único campo obrigatório.
- Cada abertura da tela gera um `clientId` (`crypto.randomUUID()`). Um toque duplo, ou um reenvio depois de erro de rede, usa o mesmo id e não duplica (task 8). A próxima abertura gera outro.
- Durante o envio, o botão mostra "Salvando…" e não aceita outro toque.
- Deu certo:
  - volta para o início (`/`);
  - mostra uma confirmação discreta embaixo por 5 segundos, "Despesa de R$ 47,90 salva", com o botão **"Desfazer"**, que exclui o lançamento;
  - o componente de aviso é o `sonner` (via shadcn), montado no layout autenticado.
- Deu errado: a mensagem aparece acima do botão Salvar (por exemplo, "Essa categoria está arquivada. Escolha outra."), e nada do que você preencheu se perde.
- A action de criar passa a devolver o `id` do lançamento criado, para o "Desfazer".

### Acesso

- **Celular:** o "+" da barra inferior (já existe) leva a `/registrar`.
- **Computador:** a sidebar ganha um botão "Registrar" no topo, acima da navegação.
- **Sem contas cadastradas:** a tela mostra "Cadastre uma conta para começar a registrar." com um link para `/contas`, no lugar do formulário.
- **Sem cartões ativos:** a opção Crédito aparece desativada, com a dica "Nenhum cartão".

## Critérios de aceite

- [ ] CA1 — E2E (Chromium e iPhone/WebKit): registrar uma despesa só com o valor (digita 4790 e salva) mostra a confirmação "R$ 47,90" na tela inicial, e o saldo da conta em `/contas` cai R$ 47,90.
- [ ] CA2 — E2E: depois de registrar no Banco Inter/Débito, a próxima abertura de `/registrar` mostra "Banco Inter · Débito".
- [ ] CA3 — E2E: o caso comum leva 2 toques além do valor (uma categoria e Salvar) e grava a categoria escolhida.
- [ ] CA4 — E2E: no viewport de 375 px, a página não rola na horizontal.
- [ ] CA5 — E2E: no Crédito, a tela mostra a fatura calculada; uma compra salva lá não muda o saldo da conta e cai no cartão.
- [ ] CA6 — E2E: "Desfazer" exclui o lançamento, e o saldo volta.
- [ ] CA7 — Unitário: teclado (dígitos, "00", apagar, teto, zeros à esquerda), `topCategories` (frequência, empate, preenchimento, arquivadas fora) e `defaultPayment` (histórico, conta e cartão arquivados, sem histórico, receita).
- [ ] CA8 — Integração: o uso das categorias conta só os últimos 90 dias e só o espaço do usuário; o "último uso" é por tipo.
- [ ] CA9 — Lint, format, test, build, `test:e2e:docker` e CI verdes. Tela conferida no iPhone (viewport e, no preview, o aparelho de verdade) e no desktop.

## Casos de borda

- Salvar com valor zero: o botão fica desativado.
- Digitar além do teto: o dígito é ignorado.
- Despesa → Receita com uma categoria de despesa selecionada: a seleção é limpa. Se a forma lembrada for Crédito ou Débito, vale a forma lembrada da receita.
- Trocar a data de uma compra no crédito atualiza a fatura mostrada e desfaz a troca manual de fatura.
- A conta lembrada foi arquivada em outro aparelho entre abrir e salvar: aparece o erro da task 8 ("Essa conta está arquivada. Escolha outra.").
- "Desfazer" depois que o lançamento já foi excluído: "Lançamento não encontrado." no aviso.

## Decisões

- **Teclado numérico da própria tela, não o do sistema.** No iPhone, o Safari não abre o teclado do sistema sozinho ao carregar a página: precisa de um toque num campo. Um teclado na tela fica aberto desde o início, não esconde metade do formulário e dispensa a vírgula: os dígitos entram em centavos. É o padrão dos apps de banco.
- **Sem "Transferência" no seletor por enquanto.** A issue pede despesa, receita e transferência no topo, mas criar transferência é da task 11, que acrescenta a terceira opção.
- **Categoria não vem pré-selecionada.** Uma categoria sugerida errada passa despercebida e estraga os relatórios. Sem categoria, o lançamento fica visível como tal e se corrige na task 14. Com a memória (task 10), o estabelecimento vai sugerir a categoria.
- **Volta para o início depois de salvar**, como pede a issue, com o "Desfazer" no aviso. Para registrar vários seguidos, o "+" está sempre a um toque.
- **"Desfazer" exclui** em vez de pedir confirmação antes de salvar. Salvar fica com um toque, e o erro raro se desfaz sem custo.
- **Uso das categorias nos últimos 90 dias**, contado no banco por agregação (`groupBy`), sem carregar os lançamentos.
- **Só criação nesta task.** A edição usa o mesmo formulário e entra com a lista (task 14). Ela precisa reenviar a fatura escolhida à mão (revisão da task 8).
- **`sonner` para o aviso**, o componente de toast do shadcn: acessível (região `aria-live`) e sobrevive à navegação para o início.

## Fora do escopo

- Offline e fila de envio (task 16).
- Autocomplete e sugestões da memória (task 10).
- Transferência e pagamento de fatura (task 11).
- Parcelado e assinatura (tasks 12 e 13).
- Editar e listar lançamentos (task 14).
- Tela inicial com os números do mês (task 25).
