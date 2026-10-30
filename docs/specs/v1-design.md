# Finanças — design da v1

> Spec de produto e fonte da verdade do projeto. Aprovado em 2026-10-29. Mudanças de escopo passam por aqui antes de virar código.

## Contexto

O João tem dificuldade de saber o que cada lançamento dos cartões e contas representa. O extrato mostra valor e CNPJ/CPF ("PAG*JOSE SILVA 12.345.678/0001-90"), e no fim do dia ele já esqueceu o que comprou ou de quem recebeu. O problema não é falta de dado, é **perda de contexto** entre o gasto e o registro.

O app captura o contexto **no momento do gasto** (celular, rápido) e transforma os registros em uma visão clara do mês (web), inspirado em Mobills, Organizze, YNAB, Monarch e Copilot.

- **Usuário:** o João (dev full-stack; React, Next.js, NestJS). Ele usa iPhone.
- **Contas:** Santander (recebe o salário) e Inter. Cada conta aceita qualquer forma de pagamento: Pix, débito, crédito e, raramente, dinheiro.
- **Construção:** Claude (Claude Code) escreve o código e o João acompanha, revisa e faz o merge.

## Metas

1. Registrar um gasto em poucos segundos no iPhone, com a memória fresca.
2. Responder no fim do mês: como fechei, com o que mais gastei, quanto já está comprometido e onde posso economizar.
3. Nunca perder um lançamento: lembrete diário e conferência de saldo com o banco.

## Não-metas (v1)

- Importação automática (Open Finance/Pluggy, OFX/CSV). O registro é manual.
- Limites/orçamento por categoria (fase 3; a média real vai sugerir os limites).
- Espaço compartilhado com a parceira (fase 2). Mas a estrutura de dados já nasce pronta pra isso.
- App nativo/App Store.

## Anti-metas (o que faz o João largar o app)

- **Registrar demorar.** Só o valor é obrigatório e o resto vem preenchido com padrões inteligentes.
- **Esquecer de registrar.** Lembrete diário por push e conferência de saldo.
- **Dashboard confuso.** Poucos números no topo e o detalhe só quando ele pedir.
- **Lento ou instável no celular.** O app abre instantâneo e salva offline.

## Decisões do João

- **Plataforma:** PWA instalado na tela inicial do iPhone + web no desktop, com uma única base de código.
- **Captura:** manual na v1.
- **Memória por estabelecimento/CNPJ/CPF:** depois de descrever um CNPJ uma vez, o app sugere descrição e categoria nas próximas.
- **Crédito:** nos indicadores, o gasto conta no **mês da compra**. Uma **tela de faturas** separada mostra o que cai em cada vencimento. Uma compra parcelada gera N parcelas, cada uma contando no seu mês e na sua fatura. O pagamento da fatura **não** é gasto.
- **Assinaturas** recorrentes e **parcelamentos** têm tratamento próprio.
- **Saldo por conta:** saldo inicial + lançamentos. Transferências entre contas próprias não contam como gasto. A conferência de saldo com o banco existe pra revelar o que ficou sem registro.
- **Categorias:** lista padrão brasileira com subcategorias, editável.
- **Hospedagem:** nuvem gratuita.
- **Fase 2 (compartilhado):** João + parceira, no modelo "um paga e divide" (estilo Splitwise). As métricas podem ser vistas individualmente (a parte de cada um), do casal (total da casa) e pelo saldo entre os dois.
- **Tela de registro:** tela única. Teclado numérico aberto, botões com as categorias mais usadas, conta e forma de pagamento lembradas do último uso, e caixas "Parcelado" e "Assinatura".
- **Dashboard web:** resumo + insights. No topo 4 KPIs (sobra, taxa de poupança, projeção do mês, comprometido no futuro), depois 2–3 insights em linguagem simples, depois categorias vs média e evolução de 6 meses, e por fim os atalhos para top estabelecimentos, faturas e assinaturas.

## Escolhas técnicas (decisão do Claude; o João valida)

- **Next.js 16 (App Router) + TypeScript**, um único app para web e PWA. Mutations em Server Actions e um Route Handler `/api/sync` para a fila offline. Motivos: o João já conhece Next, roda de graça na Vercel e evita manter API e front separados.
- **Postgres na Neon** (Vercel Marketplace, plano free) + **Prisma 7** com driver adapter da Neon. Instalar com `@7`: a tag `latest` aponta para o Prisma 8 RC.
- **Better Auth** com e-mail/senha e sessões no banco. O plugin de organizations pode servir de base para os espaços compartilhados na fase 2.
- **Tailwind + shadcn/ui**, com gráficos do shadcn/Recharts. Seguir a skill `dataviz` para cores e gráficos.
- **PWA:** Serwist (service worker), manifest e ícones. Fila offline de lançamentos no IndexedDB (Dexie), sincronizada ao reconectar. Cada lançamento tem um `clientId` (UUID) para o sync ser idempotente.
- **Lembrete:** Web Push (VAPID, lib `web-push`; funciona no iOS 16.4+ com o PWA instalado), disparado por Vercel Cron diário (o plano Hobby permite 1 execução por dia) às 21h de Brasília.
- **Validação:** Zod. **Testes:** Vitest (regras de domínio) + Playwright (fluxos principais).
- **Dinheiro em centavos** (`Int`). Datas em `America/Sao_Paulo`. Locale pt-BR em tudo.
- **Repositório:** `limajpp/financas` (público). Este design fica em `docs/specs/v1-design.md`; as specs de cada task em `docs/specs/tasks/`.

## Modelo de dados (v1, preparado para a fase 2)

- `User`
- `Space` (`PERSONAL` | `SHARED`) + `SpaceMember`. Na v1, o espaço pessoal é criado automaticamente no cadastro. Todo dado pertence a um `spaceId`.
- `Account`: nome, cor, saldo inicial, dono.
- `Card`: cartão de crédito ligado a uma `Account`, com `closingDay`, `dueDay` e limite opcional.
- `Category`: árvore de dois níveis (`parentId`), tipo despesa/receita, ícone e cor. Vem com a lista padrão.
- `Counterparty`: a memória. Guarda nome, documento CPF/CNPJ opcional, descrição padrão e categoria padrão.
- `Transaction`:
  - `type`: `EXPENSE` | `INCOME` | `TRANSFER` | `CARD_PAYMENT`
  - `amountCents`, `date` (data da compra/competência), descrição, categoria, counterparty, conta
  - `method`: `PIX` | `DEBIT` | `CREDIT` | `CASH` | `BOLETO` | `TED`
  - `cardId?` e `invoiceDueDate?` (calculado a partir do `closingDay`)
  - `installmentGroupId?`, `installmentNumber/Total`, `recurringRuleId?`, `toAccountId?` (transferência), `clientId`, `createdById`
  - Na fase 2: `paidById` + tabela `Split` (quanto é de cada membro).
- `RecurringRule`: assinatura. Guarda valor, dia, conta/cartão e categoria. Gera o lançamento do mês. Se o valor de um lançamento gerado é editado, o app pergunta se a regra deve ser atualizada, e isso alimenta o insight "assinatura mudou de valor".
- `PushSubscription` e preferências de lembrete.

## Regras de domínio que eu decidi (o João confere)

- **Parcelas:** a parcela *i* conta nos indicadores no mês da compra + (i−1) e cai na fatura correspondente. Por exemplo, uma compra de 10x de R$ 100 em 28/10 conta R$ 100 por mês de outubro a julho. Se a divisão deixar centavos sobrando, eles vão para a 1ª parcela.
- **Ciclo da fatura:** compras **no dia do fechamento ou depois** caem na fatura seguinte, e o vencimento é o `dueDay` depois do fechamento. Qualquer lançamento pode ter a fatura trocada manualmente. Mudar o `closingDay` só afeta lançamentos futuros.
- **Memória (Counterparty):** guarda o nome que o João digita ("Padaria do bairro") e, opcionalmente, **apelidos** (o nome que aparece no extrato/Pix, o CPF/CNPJ). O autocomplete procura nos dois. O campo de apelido fica escondido em "mais detalhes" para não deixar o registro mais lento. A conferência de saldo na v1 só mostra a diferença; casar linha a linha com o extrato fica para a fase de importação.
- **Primeiro uso (onboarding):** um assistente curto pede contas com o saldo de hoje (que vira a data inicial), cartões com fechamento, vencimento e valor da fatura aberta, **parcelamentos em andamento** ("parcela 3 de 10, R$ 150") e assinaturas ativas. Assim, os indicadores de comprometido futuro e de faturas já saem certos no primeiro dia. As médias de 3 meses ficam ocultas até existir histórico suficiente.
- **Fixos × variáveis:** fixo = assinaturas + parcelas + categorias marcadas como fixas (`Category.isFixed`, por exemplo Aluguel e Contas da casa).
- **Preparação para a fase 2:** contas e cartões pertencem ao espaço pessoal do dono. Um gasto compartilhado continua no espaço de quem pagou (e mexe no saldo dessa conta), e um `Split` liga esse gasto ao espaço do casal com a parte de cada um. Na v1 isso só significa não amarrar `Transaction` a um único espaço de visualização. A tabela `Split` entra na fase 2.

## Telas

**Celular (PWA)**
- **Início:** gasto de hoje e do mês, sobra do mês, fatura atual de cada cartão, últimos lançamentos e o botão grande "+".
- **Registro (tela única):** despesa/receita/transferência, valor, "O que foi?" com autocomplete pela memória, botões de categoria, conta·forma de pagamento, data, parcelado (Nx) e assinatura. Funciona offline.
- **Lançamentos:** lista por dia, com busca e edição.

**Web (desktop)**
- Dashboard (layout escolhido acima).
- Lançamentos: tabela com filtros (período, conta, forma de pagamento, categoria, estabelecimento) e edição em massa de categoria.
- Faturas: por cartão e por vencimento, com as parcelas futuras.
- Assinaturas: lista, total por mês e por ano, e mudanças de valor.
- Estabelecimentos: top por valor e por frequência; aqui também se edita a memória.
- Contas: saldos e o botão **"Conferir saldo"**. Você informa o saldo do banco, o app mostra a diferença e oferece registrar o que falta ou criar um ajuste.
- Configurações: contas, cartões, categorias, lembrete.

## Indicadores e insights (v1, por regras)

- **KPIs:** sobra (entradas − saídas, sem transferências e sem pagamento de fatura), taxa de poupança (%), projeção do mês (ritmo diário dos gastos variáveis + fixos que ainda vão cair), comprometido futuro (parcelas + assinaturas dos próximos meses).
- **Categoria vs média dos últimos 3 meses** (destaca variações acima de ~25% que passem de R$ 50).
- **Top estabelecimentos** por valor e frequência. **Gastos pequenos recorrentes** (muitas compras de até ~R$ 30 no mesmo lugar ou categoria).
- **Assinaturas anualizadas** e alerta de mudança de valor.
- **Fixos × variáveis.**
- Os limites dos insights são constantes num único módulo, fáceis de ajustar.

## Roteiro

1. **Fundação:** projeto Next, Neon + Prisma, Better Auth, espaço pessoal, seed de categorias, deploy na Vercel.
2. **Contas e cartões:** CRUD, saldo inicial, regra de ciclo da fatura (`closingDay` → vencimento).
3. **Registro rápido:** tela única, memória por counterparty, transferência, pagamento de fatura, parcelado, assinatura. Lista e edição de lançamentos.
4. **PWA:** manifest, Serwist, fila offline com Dexie + `/api/sync` idempotente, push com lembrete diário via Cron.
5. **Visões:** faturas, assinaturas, estabelecimentos, conferência de saldo.
6. **Dashboard:** KPIs, insights, categorias vs média, evolução, com os módulos de métricas testados.
7. **Fase 2 (depois):** espaço compartilhado com a parceira, split e acerto de contas, métricas individual/casal.
8. **Fase 3+ (depois):** limites por categoria sugeridos pela média, metas, reserva de emergência, importação OFX/Open Finance, insights com IA.

## Forma de trabalho (spec-driven, task por task)

**Kickoff (primeira coisa após aprovar):**
1. Criar `/home/secretjoe/Documents/Projects/Pessoal/financas`, `git init`, branch `main`.
2. Escrever os documentos base:
   - `docs/specs/v1-design.md`: este design, que é a spec de produto e a fonte da verdade.
   - `docs/specs/README.md`: como funciona o ciclo spec → testes → código → review.
   - `CLAUDE.md`: stack, convenções (centavos, fuso, pt-BR), o fluxo de cada task e a regra de que nenhum dado financeiro real entra no repo.
   - `README.md` detalhado em pt-BR: problema, funcionalidades da v1, roadmap por fases, stack e o porquê de cada escolha, arquitetura e modelo de dados resumidos, como rodar local, como funciona o desenvolvimento orientado a spec, status.
   - `LICENSE` MIT, `.gitignore` (inclui `.env*`), templates de issue (task) e de PR (com checklist de critérios de aceite).
3. `gh repo create financas --public` com descrição e topics (nextjs, pwa, personal-finance, prisma, typescript), e push do commit inicial.
4. Criar labels (`etapa:1`…`etapa:6`, `domínio`, `ui`, `infra`), a milestone **v1** e **uma issue por task do backlog abaixo**. Cada issue tem contexto, comportamento esperado, critérios de aceite testáveis, o que fica fora do escopo e o link pra seção do design. As issues são o backlog. Um quadro no GitHub Projects pode vir depois: o token do `gh` hoje não tem o escopo `project` (`gh auth refresh -s project`).

**Ciclo de cada task:**
1. Pegar a próxima issue (em ordem, salvo se o João escolher outra).
2. **Spec da task:** escrever `docs/specs/tasks/NN-slug.md` (comportamento, critérios de aceite, casos de borda, decisões). O João lê no chat e aprova ou ajusta.
3. Criar a branch `task/NN-slug`, escrever os testes a partir dos critérios de aceite (TDD) e só então a implementação.
4. Verificar: lint, testes e build verdes. Nas tasks de UI, abrir o app e conferir o fluxo.
5. **Revisor:** um subagente com contexto limpo recebe a spec da task e o diff. Ele procura bugs, desvios da spec e testes fracos. Eu corrijo o que fizer sentido e reporto o que descartei e por quê.
6. Abrir o PR (`Closes #NN`) com resumo, critérios marcados e o resultado do review. **O João faz o merge** (ou autoriza no chat). Depois disso, a próxima task.

## Backlog v1 (vira issues)

**Etapa 1 – Fundação**
1. Scaffold: Next.js 16 + TS + Tailwind + shadcn/ui + Vitest + Playwright + lint/format + CI no GitHub Actions (lint, test, build).
2. Banco: Postgres local via Docker Compose (dev/testes) + Prisma 7 + schema inicial (`User`, `Space`, `SpaceMember`) + migrations.
3. Auth: Better Auth (e-mail/senha), cadastro cria o espaço pessoal, rotas protegidas, layout base (navegação inferior no mobile, sidebar no desktop).
4. Deploy e CD: GitHub Actions faz migrations + deploy na Vercel (produção na `main`, preview nos PRs), Neon via Marketplace, variáveis de ambiente.

**Etapa 2 – Cadastros**
5. Categorias: modelo de dois níveis, seed padrão, `isFixed`, gestão nas configurações.
6. Contas: CRUD, saldo inicial com data.
7. Cartões: CRUD com `closingDay`/`dueDay` + **módulo de domínio do ciclo da fatura** (puro, muito testado).

**Etapa 3 – Lançamentos**
8. `Transaction` + `Counterparty`: criar, editar e excluir despesa/receita; **módulo de saldo da conta**.
9. Tela única de registro (mobile-first): teclado numérico, botões das categorias mais usadas, última conta/forma de pagamento lembrada.
10. Memória por estabelecimento: autocomplete, sugestão de descrição/categoria, apelidos (nome no extrato, CPF/CNPJ).
11. Transferência entre contas e pagamento de fatura (nenhum dos dois conta como gasto).
12. Compras parceladas: geração de parcelas (centavos que sobram vão para a 1ª), edição/exclusão do grupo.
13. Assinaturas: `RecurringRule`, geração mensal idempotente, pergunta "atualizar a regra?" quando o valor muda.
14. Lista de lançamentos: no mobile agrupada por dia; na web, tabela com filtros, busca e categorização em massa.

**Etapa 4 – PWA**
15. Manifest, ícones, Serwist, app shell que abre instantâneo, instruções de instalação no iOS.
16. Fila offline (Dexie) + `/api/sync` idempotente por `clientId`.
17. Web Push: inscrição, preferências, Vercel Cron diário às 21h, lembrete "registrou tudo hoje?".

**Etapa 5 – Visões**
18. Faturas por cartão e vencimento, com as parcelas futuras.
19. Assinaturas: lista, total por mês e por ano, mudanças de valor.
20. Estabelecimentos: top por valor e frequência, edição da memória.
21. Conferir saldo: diferença com o banco, registrar o que falta ou criar ajuste.
22. Onboarding: contas + saldo atual, cartões + fatura aberta, parcelamentos em andamento, assinaturas ativas.

**Etapa 6 – Dashboard**
23. **Módulo de métricas:** sobra, taxa de poupança, projeção, comprometido futuro, fixos × variáveis (com testes sobre dados fixos).
24. **Motor de insights por regras:** categoria vs média de 3 meses, gastos pequenos recorrentes, assinaturas anualizadas (com testes).
25. Dashboard web (layout aprovado) + tela inicial do mobile.
26. Polimento da v1: estados vazios, dark mode, acessibilidade, desempenho no iPhone, verificação manual completa.

Fases 2 e 3 (compartilhado, limites, importação) ficam como issues sem milestone, com a label `futuro`.

## Deixado para quem constrói

- Lista exata de categorias padrão e ícones.
- Detalhes visuais (paleta, tipografia), seguindo `frontend-design`/`dataviz`.
- Estrutura de pastas e organização dos módulos de domínio.

## Verificação

- **Vitest** para as regras críticas: em qual fatura cai uma compra (antes/depois do fechamento, viradas de mês e de ano, meses curtos), geração de parcelas (incluindo centavos que sobram da divisão), saldo da conta (transferências e pagamento de fatura não viram gasto), KPIs e insights com dados fixos.
- **Playwright:** registrar um gasto pela tela única, registrar offline (modo offline do navegador) e ver sincronizar, conferir saldo com diferença.
- **Manual no iPhone** (deploy de preview na Vercel): instalar na tela inicial, registrar em modo avião, ativar o lembrete e receber o push de teste.
- `npm run build`, lint e testes verdes antes de cada etapa ser dada como pronta.
