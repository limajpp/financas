# 05 — Categorias: dois níveis, lista padrão e gestão

Issue: #5 · Design: [Modelo de dados](../v1-design.md#modelo-de-dados-v1-preparado-para-a-fase-2) · [Regras de domínio](../v1-design.md#regras-de-domínio-que-eu-decidi-o-joão-confere)

## Objetivo

Todo espaço já nasce com uma lista padrão brasileira de categorias e subcategorias, e o João consegue ajustá-la nas configurações. As próximas telas (registro, lançamentos, indicadores) só leem essas categorias.

## Comportamento

### Modelo

- `Category`:
  - `id`, `spaceId` (`onDelete: Cascade`), `parentId?` (`onDelete: NoAction`: apagar uma mãe com filhas é recusado, mas apagar o espaço inteiro em cascata funciona);
  - `name`, `type` (`EXPENSE` | `INCOME`), `icon`, `color` e `isFixed` (padrão `false`);
  - `archivedAt?`, `createdAt` e `updatedAt`;
  - índice em `(spaceId, type)`.
- `Space.categoriesSeededAt?`: marca que a lista padrão já foi criada. Assim, uma categoria padrão apagada ou arquivada não volta.
- Migration `categories`.

### Regras (funções puras em `src/domain/categories.ts`, com testes)

- **No máximo dois níveis:**
  - a categoria-mãe de uma subcategoria tem que ser de primeiro nível, do mesmo espaço e não arquivada;
  - a subcategoria herda o `type` da mãe;
  - a mãe é escolhida na criação e não muda depois;
  - o `type` também não muda depois da criação, para um lançamento antigo não trocar de lado entre despesa e receita.
- **Nome:**
  - de 1 a 40 caracteres, sem espaços nas pontas;
  - não pode repetir entre irmãs (mesma mãe, ou mesmo primeiro nível e mesmo tipo), sem diferença de maiúsculas e acentos ("Saúde" = "saude");
  - entra na comparação qualquer irmã, arquivada ou não. Para usar o nome de uma arquivada, o caminho é desarquivá-la.
- **Fixa (efetiva)** = a própria categoria marcada **ou** a mãe marcada (`isFixedEffective`). Só vale para despesas: em receitas, a opção não aparece e o servidor grava `false`.
- **Arquivada (efetiva)** = a própria categoria ou a mãe arquivada.
  - Uma arquivada some das escolhas (`selectableCategories`), mas continua existindo, então os lançamentos antigos mantêm a categoria.
  - Desarquivar uma subcategoria cuja mãe está arquivada é recusado: primeiro se desarquiva a mãe.
- **Ícone e cor** vêm de listas fechadas: `CATEGORY_ICONS`, 52 ícones do `lucide-react` guardados pelo nome, e `CATEGORY_COLORS`, com 11 cores. O Zod valida contra essas listas.
- **Ordem:** alfabética em pt-BR (`Intl.Collator('pt-BR')`), com as subcategorias embaixo da mãe. Não há reordenação manual na v1.
- **Sem apagar na v1:** só arquivar, porque os lançamentos (task 7) vão apontar para a categoria.

### Lista padrão (`src/domain/default-categories.ts`)

Os nomes são genéricos, nada pessoal. As marcadas com **(fixa)** entram com `isFixed`.

**Despesas**

| Categoria              | Subcategorias                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| Moradia                | Aluguel (fixa), Condomínio (fixa), Contas da casa (fixa), Manutenção                                |
| Alimentação            | Mercado, Restaurante, Delivery, Padaria e lanches                                                   |
| Transporte             | Combustível, Transporte público, App de transporte, Estacionamento e pedágio, Manutenção do veículo |
| Saúde                  | Plano de saúde (fixa), Farmácia, Consultas e exames                                                 |
| Educação               | Mensalidade (fixa), Cursos, Livros e material                                                       |
| Lazer                  | Viagens, Passeios e eventos, Hobbies                                                                |
| Compras                | Roupas, Eletrônicos, Casa e decoração                                                               |
| Cuidados pessoais      | Beleza, Academia                                                                                    |
| Assinaturas e serviços | Streaming, Apps e software, Celular e internet (fixa)                                               |
| Pets                   | —                                                                                                   |
| Presentes e doações    | —                                                                                                   |
| Impostos e tarifas     | Impostos, Tarifas bancárias, Juros e multas                                                         |
| Outros                 | —                                                                                                   |

**Receitas:** Salário, Freelance, Rendimentos, Reembolsos, Presentes recebidos e Outras receitas, todas sem subcategorias.

Cada categoria de primeiro nível tem ícone e cor próprios. Na lista padrão, as subcategorias herdam a cor da mãe e, quando existe um ícone mais específico (Mercado → carrinho), usam o próprio; senão, herdam o da mãe. Uma subcategoria nova criada pela tela começa com o ícone e a cor da mãe. Depois dá para mudar qualquer um.

### Criação da lista padrão

- `ensureDefaultCategories(spaceId)` cria a lista numa transação e grava `categoriesSeededAt`. Se o espaço já tem a marca, não faz nada. Numa corrida, só uma chamada cria a lista: um `UPDATE ... WHERE categoriesSeededAt IS NULL` decide qual.
- `ensurePersonalSpace` chama essa função quando cria o espaço **e** quando encontra um espaço sem a marca. Isso cobre a sua conta, que já existe em produção, e uma falha do hook no cadastro. O custo para um espaço já marcado é zero, porque a marca vem na mesma leitura do espaço.

### Servidor

- `src/server/categories.ts`:
  - `listCategories(spaceId, { includeArchived })`;
  - `selectableCategories(spaceId, type)`;
  - `createCategory(spaceId, input)`;
  - `updateCategory(spaceId, id, input)`, que muda nome, ícone, cor e fixa;
  - `setCategoryArchived(spaceId, id, archived)`.
- Toda leitura e escrita filtra por `spaceId`. Um `id` de outro espaço responde como "não encontrada".
- **Server Actions** em `src/app/(app)/configuracoes/categorias/actions.ts`: validam com Zod, pegam o espaço com `getCurrentSpace()`, chamam as funções acima e fazem `refresh()` da página. Os erros voltam em pt-BR.

### Tela `/configuracoes/categorias` (mobile-first)

- **Abas:** Despesas | Receitas.
- **Lista em árvore.** Cada linha mostra o ícone na cor, o nome e a etiqueta "Fixa" quando for o caso. As subcategorias ficam recuadas embaixo da mãe.
- **Ações por linha:**
  - **Editar** (nome, ícone, cor, fixa) num diálogo, que no celular abre como folha de baixo;
  - **Nova subcategoria**, só nas de primeiro nível;
  - **Arquivar** e **Desarquivar**.
- **Botões gerais:** "Nova categoria" no topo e um interruptor "Mostrar arquivadas", desligado por padrão. As arquivadas aparecem esmaecidas.
- **Componentes:** os do shadcn que faltam (`dialog`, `tabs`, `switch`), adicionados pela CLI.
- **Acesso:** `/configuracoes` ganha a seção "Categorias" com o link, no desktop e no celular.

## Critérios de aceite

- [ ] CA1 — Integração: um usuário novo, cadastrado pelo `auth.api.signUpEmail`, já tem a lista padrão completa. Chamar `ensureDefaultCategories` de novo, inclusive em paralelo, não duplica nada. Um espaço antigo sem a marca recebe a lista na próxima `ensurePersonalSpace`.
- [ ] CA2 — Unitário + integração: criar uma subcategoria de subcategoria é recusado. Também são recusadas uma mãe de outro espaço, uma mãe arquivada e uma subcategoria de tipo diferente do da mãe.
- [ ] CA3 — Unitário: nome repetido entre irmãs (maiúsculas e acentos diferentes) é recusado, e o mesmo nome em mães diferentes passa.
- [ ] CA4 — Integração: uma categoria arquivada, ou uma filha de mãe arquivada, some de `selectableCategories`, mas continua em `listCategories({ includeArchived: true })`. O registro não é apagado.
- [ ] CA5 — Integração: um usuário não lista, edita nem arquiva categoria de outro espaço; o resultado é "não encontrada" e nada muda.
- [ ] CA6 — Unitário: `isFixedEffective` (própria ou da mãe) e uma receita nunca fixa.
- [ ] CA7 — E2E: cadastro → Configurações → Categorias mostra Moradia > Aluguel com "Fixa". Depois: criar uma subcategoria, renomear, trocar ícone e cor, arquivar (some da lista) e ver de novo com "Mostrar arquivadas". No Chromium e no iPhone (WebKit).
- [ ] CA8 — Lint, format, test, build, `test:e2e:docker` e CI verdes. Tela conferida no navegador, no desktop e no viewport de iPhone.

## Casos de borda

- Arquivar uma mãe com filhas → as filhas somem das escolhas junto, sem serem alteradas uma a uma. Desarquivar a mãe traz as filhas de volta.
- Desmarcar "fixa" na mãe não desmarca as filhas que eram fixas por conta própria.
- Duplo clique em "Salvar" → o botão desabilita, e a regra de nome único recusa a segunda criação.
- Categoria editada por outra aba que já foi arquivada → a edição continua permitida, porque arquivar não bloqueia mudar nome, ícone ou cor.

## Decisões

- **Arquivar, sem apagar:** a issue pede arquivar, e apagar deixaria lançamentos sem categoria. Apagar uma categoria que nunca foi usada pode entrar depois da task 7, se fizer falta.
- **Regras de dois níveis e de nome único no código, não no banco:** um `CHECK` do Postgres não enxerga outras linhas, e um índice único por expressão (sem acento, minúsculo) o Prisma não representa no schema, então cada `migrate dev` tentaria apagá-lo. O app tem um usuário por espaço, então a chance de corrida é mínima. As funções puras têm teste.
- **Marca `categoriesSeededAt` no espaço**, em vez de "criar a lista se não houver categorias": se o João arquivar tudo, nada volta sozinho.
- **Ícones e cores em listas fechadas:** a UI fica coerente com o tema e o dark mode (task 26), e o banco nunca guarda uma classe CSS arbitrária.
- **Mãe e tipo fixos depois da criação:** mover uma subcategoria ou trocar o tipo mexeria nos indicadores do histórico. Se fizer falta, entra com a edição em massa da task 14.

### Revisão

- Corrigido: o teste de corrida da lista padrão agora parte de um espaço sem a marca; a tela usa `isFixedEffective`/`isArchivedEffective` (filhas de uma mãe arquivada aparecem como arquivadas); o diálogo avisa quando a subcategoria já é fixa pela mãe e não pisca vazio ao fechar; `archived` validado com Zod; transação da lista padrão com timeout de 20 s (início a frio da Neon).
- Descartado por ora: navegação por setas nos seletores de ícone e cor (cada opção é um botão com Tab; fica para o polimento de acessibilidade da task 26).

## Fora do escopo

- Limites por categoria (fase 3).
- Reordenação manual e mover subcategoria de mãe.
- Apagar categoria.
- Botões de "mais usadas" no registro (task 9).
