# 26 — Polimento da v1

Issue: #26 · Design: [Anti-metas](../v1-design.md#anti-metas-o-que-faz-o-joão-largar-o-app) · [Verificação](../v1-design.md#verificação)

## Objetivo

Fechar a v1 pronta para o uso diário: modo escuro, telas de erro e estados vazios em todas as telas, acessibilidade nos fluxos principais, desempenho medido no celular, testes e2e estáveis e o roteiro de verificação manual escrito e executado. Não entra funcionalidade nova.

## Modo escuro

- **Segue o sistema** (`prefers-color-scheme`). No iPhone, troca junto com o aparelho. Não há botão na v1 (veja as Decisões).
- **Os tokens escuros já existem** em `globals.css` (os do shadcn e os do gráfico, task 25). O que muda:
  - a variante `dark:` do Tailwind passa a seguir o sistema, e não mais a classe `.dark`;
  - os tokens escuros passam a valer pela mesma regra.
- **A barra do navegador e a do PWA** acompanham: `themeColor` com uma cor para o claro e outra para o escuro, pela media query.
- **Conferir tela por tela no escuro** (screenshots do celular e do computador). Corrigir o que estiver com cor fixa clara: fundos, bordas, os selos das faturas, os ícones das categorias, os toasts, os diálogos e o teclado numérico.
- **O contraste do texto** é de pelo menos 4,5:1 nos dois temas. O Lighthouse e o axe medem (abaixo).

## Erros e estados vazios

- **Uma tela de erro do app** (`error.tsx` no grupo das telas logadas):
  - "Algo deu errado ao carregar esta tela.";
  - os botões "Tentar de novo" (o `reset`) e "Ir para o início";
  - o erro vai para o log do servidor, sem detalhe técnico na tela.
- **Uma página não encontrada** (`not-found.tsx`): "Página não encontrada", com o link para o início. Vale para um endereço que não existe e para um lançamento, fatura ou estabelecimento de outro espaço ou apagado. Hoje cada tela trata isso do seu jeito.
- **Estados vazios:** conferir cada tela com uma conta nova. Cada uma diz o que falta e oferece o próximo passo, com um link ou botão. As telas:
  - lançamentos (sem nada, e sem nada no filtro);
  - faturas;
  - assinaturas;
  - estabelecimentos (sem nada, e na busca);
  - contas e cartões;
  - categorias;
  - registro sem conta cadastrada.
  - O que já existe fica. Só se completa o que falta, com o mesmo tom.

## Acessibilidade

Nos fluxos principais: entrar, registrar, a lista de lançamentos, as faturas, as contas, a conferência de saldo e o início.

- **Um link "Pular para o conteúdo"**, visível quando recebe o foco, antes da navegação.
- **O foco visível** em todos os controles, nos dois temas.
- **Os pendentes das tasks anteriores:**
  - **Conferência de saldo (task 21):** o resultado é anunciado por uma região `role="status"` que já existe vazia antes de receber o texto. Alguns leitores de tela não leem uma região que já nasce com o texto.
  - **Seletores de ícone e de cor (task 5):** viram um grupo de opções (`radiogroup`) com as setas do teclado, e não um botão por opção com Tab.
  - **Depois de arquivar uma conta ou cartão (task 6):** o foco vai para um lugar previsível, que é o título da lista, e não se perde no topo da página.
- **Um teste automático de acessibilidade:**
  - o `@axe-core/playwright` (nova dependência de desenvolvimento) roda no e2e sobre as telas principais, nos dois temas;
  - não pode haver violação séria nem crítica.

## Desempenho no celular

- **Medir com o Lighthouse,** no modo mobile, sobre o build de produção local, nas telas principais logadas:
  - início;
  - registro;
  - lançamentos;
  - faturas;
  - contas.
  - Os números entram na spec, antes e depois.
- **Meta:** pelo menos 90 em desempenho e em acessibilidade em cada uma (critério da issue).
- **Se alguma ficar abaixo,** corrigir a causa medida: o JavaScript da primeira carga, uma consulta lenta, uma imagem, uma fonte. Sem otimização às cegas.
- **O tamanho do JavaScript de cada tela** (do build) entra na spec, para comparar no futuro.

## Testes e2e estáveis

As rodadas recentes tiveram de 3 a 4 testes instáveis, que só passam na nova tentativa. Os conhecidos:

- o "Olá" duplicado durante a navegação depois de salvar (task 25);
- no WebKit:
  - o offline (CA8);
  - a busca e o CA5/CA6 de estabelecimentos;
  - o CA6 de assinaturas;
  - as contas;
  - o CA6 do onboarding;
  - a lista de lançamentos;
  - o CA3 das faturas.

- **Investigar cada um** e corrigir a causa, no teste ou no app. Um teste instável pode esconder um defeito real de navegação.
- **Meta:** duas rodadas completas seguidas, sem nenhuma nova tentativa (`--retries=0`), sem falha, no Docker.

## O roteiro de verificação manual

- **`docs/verificacao-v1.md`:** o roteiro do design, completo, com uma caixa por passo. São os fluxos de ponta a ponta:
  - criar a conta e passar pelo onboarding;
  - registrar despesa, receita, transferência, parcelado e assinatura;
  - registrar offline e ver sincronizar;
  - pagar uma fatura;
  - conferir um saldo com diferença;
  - editar e mesclar estabelecimentos;
  - mudar de mês no dashboard;
  - ativar o lembrete e receber o push.
- **No computador:** eu executo e registro no próprio documento, com a data e o que foi visto.
- **No iPhone:** você executa depois do release `develop → main`, com o app instalado. Isso inclui os pendentes:
  - instalar e registrar em modo avião (task 15, CA6);
  - o push de teste (task 17, CA7);
  - o início abrir rápido (task 25, CA10).
  - O que falhar vira uma issue de correção.

## README

- **O status passa para "v1 concluída",** com o link para o roteiro de verificação.
- **Conferir que o README descreve o que o app faz hoje,** por exemplo o dashboard e o onboarding.

## Critérios de aceite

- [x] CA1 — O modo escuro segue o sistema em todas as telas, e as barras do navegador e do PWA acompanham. Há screenshots do celular e do computador nos dois temas, mandadas ao João.
- [x] CA2 — Uma tela de erro e uma página não encontrada:
  - teste unitário da tela de erro;
  - e2e de um endereço inexistente (404), e de um estabelecimento e uma fatura de fora do espaço. O app não tem endereço próprio para um lançamento, que abre num diálogo.
- [x] CA3 — Os estados vazios de todas as telas da lista, conferidos com uma conta nova (e2e onde ainda não houver).
- [x] CA4 — Há o link "Pular para o conteúdo" e o foco visível. A conferência de saldo anuncia o resultado, os seletores de ícone e cor andam pelas setas, e arquivar deixa o foco no título da lista. Cada um tem teste.
- [x] CA5 — O axe no e2e, sobre as telas principais nos dois temas, sem violação séria nem crítica.
- [ ] CA6 — O Lighthouse mobile dá pelo menos 90 em desempenho e acessibilidade nas 5 telas principais. Os números ficam na spec.
  - **Não atingido; aceito pelo João para fechar a v1.** Os números estão em "Desempenho", acima. A reestruturação fica na issue #59, depois do release, com a medida na produção e a conferência no iPhone.
- [x] CA7 — Duas rodadas completas do e2e seguidas, com `--retries=0`, sem falha.
- [x] CA8 — `docs/verificacao-v1.md` está escrito e a parte do computador foi executada e registrada. A parte do iPhone fica com o João, depois do release.
- [x] CA9 — O README diz "v1 concluída" e descreve o app de hoje.
- [ ] CA10 — Lint, format, test, build e CI verdes.

## Implementação

- **Modo escuro:**
  - a variante `dark:` e os tokens escuros seguem `prefers-color-scheme`;
  - o `color-scheme: light dark` faz os controles nativos acompanharem (data, select, rolagem);
  - o `themeColor` tem uma cor por tema.
  - A auditoria percorreu todas as telas, com uma conta nova e com dados, nos dois temas, no celular e no computador. As cores já tinham variante escura; nada ficou com cor fixa clara.
- **O contraste do texto apagado:** o axe achou o `muted-foreground` do shadcn (0,556) a 4,3:1 sobre os fundos cinza dos botões de alternância. Ele passou a 0,52, com pelo menos 5:1 em todo fundo claro. O escuro já tinha 5,8:1.
- **Estados vazios:** quase todas as telas já tinham. O e2e `empty-states` confere os de lançamentos (com e sem filtro), estabelecimentos, contas e cartões e o registro sem conta; os de faturas, assinaturas e início já tinham e2e. As categorias nunca ficam vazias numa conta nova (vêm as padrão). Ganharam o próximo passo:
  - a lista de lançamentos vazia, sem filtro, com "Registrar um lançamento";
  - os estabelecimentos vazios, com a dica de dizer o lugar em "O que foi?" e o link "Registrar um gasto".
- **Erros:** a página não encontrada (`app/not-found.tsx`) cobre os endereços que não existem. A tela de erro (`(app)/error.tsx`, com o `retry` do Next 16) cobre as telas logadas. As telas de detalhe continuam com o "não encontrado" próprio delas, que já existia e diz mais.
- **Teclado:**
  - `radioKeys` em `src/components/radio-keys.ts`, o padrão de radio do WAI-ARIA, com teste;
  - `focusHeading` depois de arquivar: o título da tela, nas contas, e o título "Cartões de crédito", nos cartões;
  - o link "Pular para o conteúdo" leva ao `main`;
  - a conferência tem uma região `status` só para leitores de tela, sempre montada, e a linha visível fica `aria-hidden`.
- **O gráfico do início sai da árvore de acessibilidade por completo** (`accessibilityLayer={false}`): o axe apontou um elemento focável dentro da área escondida. A tabela "Ver os números" é a alternativa.
- **Um defeito real achado pelos testes instáveis:** na busca de estabelecimentos, o que se digitava antes de a página hidratar (num celular lento) ficava no campo, mas a busca não rodava. Agora o componente adota o texto ao montar.
- **Os testes instáveis, e a causa de cada um:**
  - **O "Olá" duplicado:** por um quadro, o Next 16 mantém a rota anterior viva (Activity) e há duas home no DOM. As esperas aceitam a primeira.
  - **`page.goto` interrompido:** o Next recarrega "/" depois de salvar, e isso interrompe a navegação. O helper `visit` passou para `e2e/helpers.ts`, e o `offline` o usa.
  - **Um clique durante a hidratação:** o teste repete o clique até a navegação acontecer.
  - **O teste aleatório do ciclo de fatura** estourava os 5 s com a suíte inteira em paralelo. Ganhou um limite explícito.
  - **O axe esperava `networkidle`,** que o WebKit nunca alcança. Agora espera o título e nenhum "Carregando…". E roda um teste por tema: os dois juntos passavam de 135 s no WebKit com a rodada inteira.
  - **Uma rodada com 15 falhas de uma vez,** todas no WebKit, no fim, na volta ao início depois de salvar (mais de 5 s): a máquina estava com carga de 25–30 durante as rodadas. Isolados, os mesmos testes passaram, e as duas rodadas seguintes também.
  - **Resultado:** duas rodadas completas seguidas, com `--retries=0`, 138 de 138, sem falha. Os 2 pulados são o teclado, sem Tab no iPhone, e a instalação, só no Chromium.

### Desempenho (Lighthouse 13.5, mobile, build local, mediana de 3 rodadas)

| Tela        | Antes | Depois | Acessibilidade | LCP   | TBT    | JS (transferido) |
| ----------- | ----- | ------ | -------------- | ----- | ------ | ---------------- |
| Início      | 61    | 68     | 100            | 3,7 s | 829 ms | 252 KB           |
| Registro    | 66    | 70     | 100            | 3,8 s | 764 ms | 306 KB           |
| Lançamentos | 71    | 74     | 100            | 3,6 s | 667 ms | 274 KB           |
| Faturas     | 73    | 76     | 100            | 3,5 s | 584 ms | 257 KB           |
| Contas      | 89    | 81     | 100            | 2,3 s | 681 ms | 264 KB           |

- **O "antes" é uma rodada só, e o "depois" a mediana de 3:** a comparação não é confiável tela a tela. As notas variam de uma rodada para outra: o início foi de 61 a 78 numa mesma série, e contas de 81 a 89. Medir de novo na produção, com brotli, HTTP/2 e a CDN da Vercel, dá um número mais realista.
- **O que mudou:**
  - o gráfico do início só carrega perto da tela (o Recharts pesava ~600 ms de CPU na abertura);
  - o zod saiu do JavaScript de quatro telas. As constantes dos filtros foram para `src/lib/transaction-filter-params.ts`, sem zod;
  - a fonte mono, sem uso, não é mais baixada;
  - o início não se desloca mais quando os blocos chegam.
- **O que pesa:** a base que toda tela paga, o React e o roteador do Next, com cerca de 200 KB e 1–3 s de CPU no celular simulado (4× mais lento). Além disso, o conteúdo chega por streaming depois desse JavaScript, o que puxa o LCP para 3,5 s no 4G lento simulado.
  - Subir a 90 pede uma mudança de estrutura: menos componentes de cliente por tela, a fila offline (Dexie) carregada sob demanda, o conteúdo principal no HTML estático. É trabalho de uma task própria, com o risco de mexer no offline.
- **A acessibilidade fica em 100** nas cinco telas.

## Revisão

O revisor (Opus, effort high) aprovou com nits, sem bloqueios. Ele confirmou a análise do desempenho nos chunks do build. O maior ganho seguinte é o Dexie: cerca de 34 KB, carregados em toda tela pelo layout, e que podem passar a ser sob demanda. Isso fica para a task própria, por causa do risco no offline. Corrigido:

- **O axe não auditava a página não encontrada:** sem login, o proxy manda o endereço para a entrada. Agora ela é auditada logada, e o gráfico do início também, depois de rolar até ele.
- **O CA3 pedia e2e dos estados vazios que ainda não tinham.** Ganhou o `e2e/empty-states.spec.ts`.
- **O roteiro dizia mais do que rodou.** Agora diz onde cada coisa rodou, e a cor das barras fica para o iPhone.
- **As esperas pelo "Olá" aceitavam uma home duplicada que ficasse na tela.** O helper `expectHome` espera a primeira e depois exige uma só.
- **Nits:**
  - o clique repetido do dashboard não clica de novo se a navegação já aconteceu;
  - o `visit` duplicado saiu dos specs novos;
  - as setas partem da opção focada;
  - o título das contas tem um id para o foco;
  - o anel de foco dos ícones ficou com o contraste cheio;
  - a dica dos estabelecimentos ganhou o link;
  - o nome do teste de "não encontrado" ficou fiel ao que testa;
  - o roteiro do iPhone confere a abertura no escuro, porque o manifesto tem o fundo branco fixo.
- **Anotado:**
  - um toque durante a hidratação, num celular lento, pode se perder e pedir um segundo toque. É comportamento do framework.
  - o início do celular agora mostra o convite do onboarding abaixo dos números e do botão Registrar, para a tela não pular. _João, confira._

## Decisões

- **O modo escuro segue o sistema, sem botão.** É o comportamento esperado de um app no iPhone, e não há preferência para guardar nem tela para escolher. Um botão pode vir depois, se você sentir falta.
  - _João, confira._
- **Sem identidade visual nova.** As tasks 1 e 3 deixaram a "identidade visual" para cá. A proposta é manter o visual neutro do shadcn, que já está coerente nas telas, e o ícone atual. Uma marca própria é um trabalho de design à parte.
  - _João, confira._
- **O Lighthouse roda no build local, e não na Vercel.** As telas são logadas, e o preview da Vercel tem a proteção de deploy. O build local é o mesmo código, e a medida se repete.
- **O roteiro do iPhone fica com você.** Eu não tenho um iPhone. O critério do computador fecha nesta task, e o do iPhone fica registrado no documento quando você executar.
- **O axe entra no e2e** para a acessibilidade não regredir depois da v1. O Lighthouse é só uma medida pontual.

## Fora do escopo

- Funcionalidades novas.
- Uma marca ou identidade visual própria.
- Um botão de tema.
- Tradução para outro idioma.
