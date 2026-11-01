# 10 — Memória por estabelecimento: autocomplete, sugestões e apelidos

Issue: #10 · Design: [Regras de domínio](../v1-design.md#regras-de-domínio-que-eu-decidi-o-joão-confere) · [Decisões do João](../v1-design.md#decisões-do-joão)

## Objetivo

Resolver a dor principal: o extrato mostra "PAG\*JOSE SILVA 12.345.678/0001-90" e, no fim do dia, você já não lembra o que foi. Você descreve uma vez ("Padaria do bairro", Alimentação), e o app passa a sugerir o estabelecimento, a categoria e a observação nas próximas vezes. Também dá para guardar o nome que aparece no extrato e o CPF/CNPJ, e achar o estabelecimento por eles.

## Comportamento

### CPF e CNPJ (`src/domain/document.ts`, com testes)

- `parseDocument(texto)` aceita CPF ou CNPJ, com ou sem pontuação, e devolve o documento normalizado ou um erro:
  - **CPF:** 11 dígitos, com os dígitos verificadores certos. Sequências repetidas (`111.111.111-11`) são inválidas;
  - **CNPJ:** 14 caracteres. Os 12 primeiros podem ter letras (o **CNPJ alfanumérico**, emitido desde julho de 2026), e os 2 últimos são dígitos verificadores, calculados pelo módulo 11 com o valor ASCII − 48 de cada caractere. O CNPJ só de números é um caso particular da mesma conta;
  - normalizado: só letras maiúsculas e dígitos (`12ABC34501DE35`).
- Mensagens:
  - "CPF inválido. Confira os números.";
  - "CNPJ inválido. Confira os caracteres.";
  - "Informe um CPF (11 dígitos) ou um CNPJ (14 caracteres)."
- `formatDocument(normalizado)` devolve `123.456.789-09` ou `12.ABC.345/01DE-35`, para exibir.

### Busca (`src/domain/counterparty-search.ts`, com testes)

`searchCounterparties(consulta, estabelecimentos, limite = 5)` procura em três lugares:

- **no nome e nos apelidos,** sem diferença de acentos, maiúsculas e espaços extras ("padaria sao joao" acha "Padaria São João"). Vale qualquer parte do texto;
- **no documento,** quando a consulta, sem pontuação, tem pelo menos 3 dígitos. A comparação é sem pontuação: "345.678", "345678" e "12.345.678/0001-90" acham o CNPJ `12345678000190`. Dígitos dentro de um apelido ("PAG\*JOSE SILVA 12.345.678/0001-90") também valem;
- **ordem:**
  - quem começa com a consulta vem antes de quem só a contém;
  - o nome vale mais que um apelido, e um apelido mais que o documento;
  - no empate, o mais usado, e depois o usado mais recentemente;
- **consulta vazia:** os 5 estabelecimentos mais usados nos últimos 90 dias, como atalho ao focar o campo.

Cada resultado diz onde casou (nome, apelido ou documento), para a lista mostrar, por exemplo, "no extrato: PAG\*JOSE SILVA".

### Sugestões (o que o app aprendeu)

`suggestionFor(estabelecimento, tipo)` (pura) devolve a categoria e a observação a sugerir para um tipo (despesa ou receita):

- **categoria:**
  - a padrão gravada (`defaultCategoryId`), se houver. Ninguém grava isso nesta task: é a edição da memória, na task 20;
  - senão, **a mais usada** nos lançamentos daquele estabelecimento e tipo. No empate, a usada mais recentemente;
  - uma categoria arquivada (ou com a mãe arquivada) não é sugerida;
- **observação:** a padrão gravada (`defaultDescription`) ou, senão, a do lançamento mais recente com observação.

O servidor calcula isso por agregação (`groupBy` por estabelecimento, tipo e categoria) e manda junto com os dados da tela de registro. Ficam de fora os estabelecimentos sem lançamentos: um órfão de uma corrida do sync, como apontou a revisão da task 8, não aparece.

### Tela de registro

- **"O que foi?" vira um combobox:**
  - ao digitar ou focar o campo, abre logo abaixo uma lista com até 5 sugestões, por cima das categorias;
  - cada sugestão mostra o nome, o ícone da categoria sugerida e, quando casou por apelido ou documento, onde casou;
  - no celular, um toque escolhe. No computador, ↑/↓ andam pela lista, Enter escolhe e Esc fecha;
  - segue o padrão ARIA de combobox: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant` e `role="listbox"`/`option`;
  - o Return do iPhone continua fechando o teclado, como na task 9. Com uma opção ativa, Enter escolhe essa opção.
- **Escolher uma sugestão:**
  - o campo recebe o nome do estabelecimento;
  - **a categoria sugerida é selecionada se você ainda não escolheu uma.** Se já tinha escolhido, ela fica;
  - a observação sugerida entra no campo Observação, se ele estiver vazio;
  - tudo continua editável;
  - a lista fecha, e o foco sai do campo, para o teclado do iPhone fechar e as categorias aparecerem.
- **Texto que não é de nenhum estabelecimento:** ao salvar, cria um estabelecimento novo (como na task 8), com uma exceção. Se o texto for exatamente um apelido ou o CPF/CNPJ de **um único** estabelecimento, o lançamento vai para ele. Por exemplo, você cola "12.345.678/0001-90". Se mais de um tiver aquele apelido ou documento, o texto vira um estabelecimento novo: o app não adivinha.
- **"Mais detalhes"** (fechado por padrão) ganha, além da Observação:
  - **"Nome no extrato"**: um apelido acrescentado ao estabelecimento ao salvar. Se já existe, sem diferença de acentos e maiúsculas, nada muda;
  - **"CPF/CNPJ"**: validado ao salvar. Preenchido, substitui o documento do estabelecimento. Vem com o documento atual quando você escolhe uma sugestão;
  - os dois exigem "O que foi?" preenchido: "Informe o que foi para guardar o nome no extrato." (ou "…o CPF/CNPJ.").
- **Limites:**
  - até 10 apelidos por estabelecimento, de até 60 caracteres cada;
  - passando de 10, o mais antigo sai: o apelido mais recente costuma ser o que o banco mostra hoje.

### Servidor

- `registerData` passa a trazer os estabelecimentos para o autocomplete, filtrados no próprio aparelho (a busca é instantânea e vai funcionar offline na task 16):
  - para cada um: `id`, nome, apelidos, documento, uso (quantidade e último uso) e as sugestões por tipo;
  - no máximo os 500 usados mais recentemente.
- A entrada do lançamento (Zod) ganha `counterpartyAlias` (até 60 caracteres) e `counterpartyDocument` (validado por `parseDocument`), os dois opcionais.
- `counterpartyIdFor` passa a resolver nesta ordem:
  1. o nome normalizado;
  2. o apelido exato de um único estabelecimento;
  3. o documento de um único estabelecimento;
  4. senão, cria um.

  Depois aplica o apelido e o documento informados. Tudo continua restrito ao espaço.

## Critérios de aceite

- [ ] CA1 — Unitário: buscar por parte do CNPJ, com ou sem pontuação, encontra o estabelecimento. Vale também para o CNPJ alfanumérico, para o CPF e para dígitos dentro de um apelido.
- [ ] CA2 — Unitário: a busca ignora acentos, maiúsculas e espaços extras no nome e nos apelidos. A ordem é: começo antes de meio, nome antes de apelido antes de documento, e mais usado no empate.
- [ ] CA3 — E2E (Chromium e iPhone/WebKit): depois de registrar "Padaria do Bairro" em Alimentação, digitar "pada" mostra a sugestão. Escolhê-la preenche o nome e seleciona Alimentação, e salvar grava no mesmo estabelecimento.
- [ ] CA4 — Unitário: CPF e CNPJ inválidos (dígito verificador errado, tamanho errado, sequência repetida) são recusados, cada um com a sua mensagem. Exemplos válidos de CPF, CNPJ numérico e CNPJ alfanumérico passam e são normalizados.
- [ ] CA5 — Integração: a categoria sugerida é a mais usada naquele estabelecimento e tipo (empate: a mais recente) e nunca uma arquivada. A observação é a mais recente. Estabelecimentos sem lançamentos e de outro espaço não vêm.
- [ ] CA6 — Integração:
  - apelido e documento informados ao salvar ficam no estabelecimento, sem apelido repetido e com no máximo 10;
  - um texto igual ao apelido ou ao documento de um único estabelecimento vai para ele;
  - se for de dois, cria um novo;
  - um documento inválido é recusado.
- [ ] CA7 — E2E: guardar "PAG\*JOSE SILVA" como nome no extrato e depois buscar "jose" acha o estabelecimento, mostrando onde casou.
- [ ] CA8 — Lint, format, test, build, `test:e2e:docker` e CI verdes. Tela conferida no iPhone (viewport) e no desktop.

## Casos de borda

- Consulta só com pontuação ("./-"): sem resultados.
- Dois estabelecimentos com o mesmo CNPJ (comum em intermediadores de pagamento, como "PAG\*"): os dois aparecem na busca. Texto igual ao CNPJ cria um novo, porque é ambíguo.
- A categoria sugerida é de outro tipo (você está registrando uma receita): não vem. A sugestão é por tipo.
- Escolher uma sugestão e depois editar o texto: vale o texto final. Se ele não for mais o nome de nenhum estabelecimento, cria um novo.
- Estabelecimento sem nenhuma categoria usada: escolhê-lo não seleciona categoria.
- CPF/CNPJ com espaço, ponto, barra ou hífen em qualquer lugar: a pontuação é ignorada.

## Decisões

- **Busca no aparelho, não no servidor.** Para uma pessoa, são centenas de estabelecimentos: a lista vem com a tela, e cada tecla filtra sem ir à rede. Isso também é o que a fila offline da task 16 precisa. O teto de 500 (os usados mais recentemente) evita uma página pesada.
- **A categoria aprende por contagem, sem gravar.** "A mais usada" sai de uma agregação na hora. Assim, corrigir um lançamento (task 14) ajusta a sugestão sem nada para sincronizar. `defaultCategoryId` e `defaultDescription` ficam como escolha explícita, editada na task 20, e têm prioridade.
- **A sugestão não troca uma categoria que você já escolheu.** O caso comum é: valor, "O que foi?", sugestão. Quem tocou numa categoria antes decidiu.
- **CNPJ alfanumérico desde já.** A Receita emite CNPJs com letras desde julho de 2026. Um validador só numérico recusaria estabelecimentos novos.
- **Documento não é único.** Um intermediador ("PAG\*", maquininhas) usa o mesmo CNPJ para muitos estabelecimentos. Por isso, um texto igual a um documento ou apelido só resolve quando há um único dono.
- **Apelido mais antigo sai depois de 10.** Sem limite, a lista cresce para sempre. Com um limite que recusasse o novo, o nome que o banco mostra hoje ficaria de fora.
- **Os campos novos ficam em "Mais detalhes".** O design pede que o registro não fique mais lento: quem não precisa, nem vê.

## Fora do escopo

- Editar, juntar ou apagar estabelecimentos e definir os padrões à mão (task 20).
- Casar com o extrato importado (fase 3).
- Busca no servidor e paginação (desnecessárias no volume de uma pessoa).
