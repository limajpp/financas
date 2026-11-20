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

- [ ] CA1 — O modo escuro segue o sistema em todas as telas, e as barras do navegador e do PWA acompanham. Há screenshots do celular e do computador nos dois temas, mandadas ao João.
- [ ] CA2 — Uma tela de erro e uma página não encontrada, com testes e2e: um endereço inexistente, e um lançamento de outro espaço.
- [ ] CA3 — Os estados vazios de todas as telas da lista, conferidos com uma conta nova (e2e onde ainda não houver).
- [ ] CA4 — Há o link "Pular para o conteúdo" e o foco visível. A conferência de saldo anuncia o resultado, os seletores de ícone e cor andam pelas setas, e arquivar deixa o foco no título da lista. Cada um tem teste.
- [ ] CA5 — O axe no e2e, sobre as telas principais nos dois temas, sem violação séria nem crítica.
- [ ] CA6 — O Lighthouse mobile dá pelo menos 90 em desempenho e acessibilidade nas 5 telas principais. Os números ficam na spec.
- [ ] CA7 — Duas rodadas completas do e2e seguidas, com `--retries=0`, sem falha.
- [ ] CA8 — `docs/verificacao-v1.md` está escrito e a parte do computador foi executada e registrada. A parte do iPhone fica com o João, depois do release.
- [ ] CA9 — O README diz "v1 concluída" e descreve o app de hoje.
- [ ] CA10 — Lint, format, test, build e CI verdes.

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
