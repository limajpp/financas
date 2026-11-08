# 14 — Lista de lançamentos: celular por dia, web com filtros e edição em massa

Issue: #14 · Design: [Telas](../v1-design.md#telas)

## Objetivo

Um lugar para conferir, corrigir e categorizar o que você registrou. No celular, uma lista por dia. No computador, uma tabela com filtros. Dá para editar ou excluir qualquer lançamento, e categorizar vários de uma vez. Esta task também traz a tela de edição que as tasks 11, 12 e 13 deixaram pronta no servidor:

- editar transferências e pagamentos de fatura;
- o escopo das parcelas;
- a pergunta "Atualizar a assinatura?".

## Comportamento

### Tela `/lancamentos`

- **Período:** o mês atual, por padrão. Botões "‹" e "›" trocam de mês, e um filtro abre um período livre ("de" e "até").
- **Filtros, todos na URL** (`?de=2026-11-01&ate=2026-11-30&conta=…&q=…`), para voltar, recarregar e compartilhar o mesmo recorte:
  - **conta:** inclui as transferências que entram nela e os pagamentos de fatura que saem dela;
  - **cartão;**
  - **forma de pagamento;**
  - **categoria:** uma categoria-mãe inclui as subs. "Sem categoria" também é uma opção;
  - **estabelecimento;**
  - **tipo:** despesa, receita, transferência ou pagamento de fatura.
- **Busca (`q`):**
  - procura na observação e no nome e apelidos do estabelecimento, sem diferença de acentos e maiúsculas;
  - um valor ("47,90") também acha os lançamentos com esse valor exato.
- **Ordem:** do mais novo para o mais antigo, pela data e depois pela hora em que foi registrado.
- **50 por vez.** Mais lançamentos carregam sozinhos quando você chega ao fim da lista, e há também um botão "Carregar mais".
- **Cada lançamento mostra:**
  - o ícone e o nome da categoria (ou "Sem categoria");
  - o estabelecimento ou, sem ele, a observação;
  - a linha "Banco Azul · Pix" ou "Cartão Roxo · 3/10" (parcela 3 de 10) ou "Assinatura";
  - o valor: despesa em tom normal com "−", receita em verde com "+". Transferência mostra "Banco Azul → Banco Verde", e pagamento de fatura mostra "Pagamento · Cartão Roxo", os dois sem cor.
- **Celular:**
  - grupos por dia ("Sexta, 07/11"), cada um com o total do dia: receitas menos despesas, sem transferências nem pagamentos de fatura;
  - a busca fica no topo, e os filtros abrem numa folha pelo botão "Filtros", com o número de filtros ativos;
  - tocar num lançamento abre a edição.
- **Computador:**
  - uma tabela com as colunas seleção, data, descrição, categoria, conta ou cartão, forma e valor;
  - os filtros ficam numa barra acima da tabela;
  - clicar numa linha abre a edição.
- **Sem lançamentos no recorte:** "Nenhum lançamento neste período." e, com filtros ativos, um botão "Limpar filtros".
- **A tela também gera as assinaturas vencidas,** como as outras telas com dinheiro (task 13).

### Categorizar em massa

- **No computador,** a primeira coluna é uma caixa de seleção, e há uma para selecionar todos os carregados.
- **No celular,** o botão "Selecionar" põe a lista em modo de seleção.
- **Só despesas e receitas entram na seleção.** Transferências e pagamentos não têm categoria.
- **A barra de ações** aparece com "N selecionados", um seletor de categoria (com "Sem categoria") e "Aplicar".
- **A seleção precisa ser de um tipo só.** Misturando despesas e receitas, o seletor fica desativado com a dica "Selecione só despesas ou só receitas.". O seletor oferece as categorias ativas daquele tipo.
- **No servidor,** `bulkSetCategory(spaceId, ids, categoryId | null)`:
  - confere que todos os ids são do espaço, do mesmo tipo e de despesa ou receita, e que a categoria é ativa e daquele tipo;
  - aplica tudo numa só operação, ou nada;
  - uma parcela muda só a si mesma, porque a seleção já é explícita.
- **Depois de aplicar:** o aviso "3 lançamentos categorizados", e a seleção é limpa.

### Edição

Uma folha (ou diálogo, no computador) com os campos do tipo do lançamento:

- **Despesa e receita:**
  - valor;
  - "O que foi?", com o autocomplete da task 10, que preenche só o nome;
  - categoria, num seletor nativo agrupado por categoria-mãe;
  - forma, e conta ou cartão;
  - data;
  - fatura (só no crédito, com a janela da task 8);
  - observação.
- **Transferência:** valor, de, para, forma, data e observação.
- **Pagamento de fatura:** valor, cartão (fixo), fatura, conta que paga, forma, data e observação.
- **Parcela (task 12):**
  - aparece "Parcela 3 de 10 · R$ 1.000,00 no total";
  - a data, o cartão e a forma ficam travados, com a dica "Para mudar, exclua e registre de novo.";
  - salvar e excluir perguntam o escopo: **"Só esta"** ou **"Esta e as próximas"**.
- **Cobrança de assinatura (task 13):**
  - aparece "Assinatura · todo dia 8";
  - se o valor mudou, aparece a caixa **"Atualizar também o valor da assinatura"**, marcada por padrão. Marcada, ela é o "sim" ao "Atualizar a assinatura?";
  - o tipo fica travado em despesa;
  - excluir apaga só aquela cobrança.
- **Excluir:** o botão "Excluir" pede confirmação ("Excluir este lançamento?"). Para parcela, a confirmação vem com o escopo.
- **Depois de salvar ou excluir:** a folha fecha, a lista atualiza, e aparece um aviso ("Lançamento atualizado", "Lançamento excluído").

### Servidor

- **`listTransactions(spaceId, filtros, cursor?)`** devolve:
  - até 50 lançamentos;
  - o cursor da próxima página (data, hora de registro e id);
  - o total de cada dia que aparece na página.

  O total do dia vem de uma agregação com os mesmos filtros, então fica certo mesmo quando o dia continua na página seguinte.

- **`updateTransfer` e `updateCardPayment`** passam a existir, com as mesmas regras da criação (task 11) e o mesmo `NOT_FOUND` para outro espaço. O tipo de uma transferência ou de um pagamento não muda.
- **Server Actions com Zod:**
  - listar mais (filtros e cursor);
  - editar cada tipo;
  - categorizar em massa;
  - excluir (já existe, com escopo).
- **Os filtros da URL** passam por um schema Zod: um valor inválido é ignorado, sem erro na tela.

## Critérios de aceite

- [ ] CA1 — E2E (Chromium e iPhone/WebKit): filtrar por conta e período mostra só os lançamentos certos, e os filtros ficam na URL. Recarregar a página mantém o recorte.
- [ ] CA2 — E2E: categorizar 3 lançamentos de uma vez muda a categoria dos 3 e mostra o aviso.
- [ ] CA3 — E2E e componente: uma parcela aparece como "Cartão Roxo · 3/10".
- [ ] CA4 — Integração:
  - `listTransactions` com cada filtro, inclusive a categoria-mãe que inclui as subs, "sem categoria" e a conta que inclui as transferências de entrada;
  - a busca por nome, apelido, acento e valor;
  - a paginação sem repetir nem pular lançamentos;
  - o total do dia;
  - outro espaço não vê nada.
- [ ] CA5 — Integração: `bulkSetCategory` recusa ids de outro espaço, tipos misturados, transferências e categoria de outro tipo ou arquivada, e aplica tudo ou nada.
- [ ] CA6 — Integração: editar uma transferência e um pagamento de fatura, com as regras da task 11.
- [ ] CA7 — E2E:
  - editar o valor de uma despesa atualiza a lista e o saldo;
  - excluir pede confirmação;
  - numa parcela, "esta e as próximas" muda da parcela em diante.
- [ ] CA8 — Lint, format, test, build, `test:e2e:docker` e CI verdes. Telas conferidas no iPhone (viewport) e no desktop.

## Casos de borda

- Um filtro que aponta para uma conta arquivada continua valendo. Ela aparece nos filtros como "(arquivada)".
- Um lançamento excluído em outro aparelho e editado aqui: "Lançamento não encontrado.", e a lista atualiza.
- Selecionar todos com 50 carregados e mais na próxima página: a seleção vale só para os carregados, e o texto diz isso ("50 selecionados nesta lista").
- A busca só com espaços é ignorada.
- Um mês sem lançamentos e sem filtros: o estado vazio, com os botões de mês ainda funcionando.

## Decisões

- **Filtros na URL, e não em estado local.** A URL guarda o recorte ao voltar de uma edição e ao recarregar, e funciona como atalho.
- **Paginação por cursor, e não por número de página.** Lançamentos novos entrando no meio da lista não fazem repetir nem pular nenhum.
- **A edição é um formulário próprio, sem o teclado numérico do registro.** Corrigir é diferente de registrar: os campos precisam estar todos visíveis, e o valor é digitado como nos outros formulários (`MoneyInput`).
- **O autocomplete na edição preenche só o nome.** Trocar a categoria ou a observação de um lançamento já categorizado, sem pedir, seria surpresa.
- **Categorizar em massa não segue o escopo das parcelas.** A seleção já diz exatamente o que mudar.
- **Busca no banco:** a busca no nome do estabelecimento usa o nome sem acentos (`nameKey`). Nas observações, ela ignora maiúsculas, mas não acentos, porque o Postgres do projeto não tem a extensão `unaccent`.

### Revisão

O revisor (Opus, effort high) pediu mudanças por dois problemas graves, já corrigidos.

- **O período livre não existia no computador.** Os campos "De" e "Até" só estavam na folha de filtros do celular. Agora também ficam na barra de filtros do desktop.
- **A busca podia perder letras:** se você continuasse digitando enquanto a página carregava, a resposta da busca anterior apagava o que tinha sido digitado depois. Os seletores tinham o mesmo problema, com duas mudanças rápidas seguidas. A barra agora guarda uma cópia própria dos filtros e só aceita a URL quando a mudança veio de fora (voltar, "Limpar filtros").
- **Também corrigido:**
  - `%` e `_` na busca eram curingas e passaram a ser caracteres;
  - um lançamento excluído em outro aparelho e editado aqui mostra "Lançamento não encontrado." e a lista atualiza;
  - "50 selecionados nesta lista", quando há mais páginas;
  - a categoria escolhida na ação em massa é limpa quando a seleção muda de tipo, e com tipos misturados o seletor fica desativado, com a dica;
  - o carregamento automático funciona mesmo quando a lista começa vazia;
  - a coluna "Forma" aparece separada na tabela;
  - as faturas oferecidas na edição de um pagamento são as que o servidor aceita, e um pagamento antigo pode ter a observação editada mantendo a fatura e a conta arquivada que já tinha;
  - os filtros de categoria arquivada e de estabelecimento antigo aparecem selecionados;
  - um cursor adulterado é recusado.
- **Testes novos:**
  - empate na hora de registro, com o id desempatando;
  - o total do dia segue os filtros;
  - o filtro por subcategoria;
  - a conta inclui o pagamento de fatura que sai dela;
  - os curingas da busca;
  - editar como transferência ou como pagamento um lançamento de outro tipo;
  - o pagamento antigo com conta arquivada.
- **Aceito:**
  - **Depois de editar ou categorizar, a lista volta para a primeira página.** As páginas carregadas a mais somem, e a posição da rolagem muda. Manter as páginas exigiria recarregar todas elas.
  - **A página pesa um pouco mais:** cada filtro carrega as opções completas (categorias, estabelecimentos e a memória), e a busca lê os estabelecimentos do espaço. No volume de uma pessoa, é rápido.

## Fora do escopo

- Exportar CSV.
- Edição em massa de outros campos além da categoria.
- Desfazer a edição em massa.
- A tela de faturas (task 18) e a de assinaturas (task 19).
