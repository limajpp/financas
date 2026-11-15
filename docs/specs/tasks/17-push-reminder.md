# 17 — Web Push: lembrete diário às 21h

Issue: #17 · Design: [Escolhas técnicas](../v1-design.md#escolhas-técnicas-decisão-do-claude-o-joão-valida) · [Anti-metas](../v1-design.md#anti-metas-o-que-faz-o-joão-largar-o-app)

## Objetivo

Esquecer de registrar é uma das anti-metas. Todo dia, por volta das 21h, o iPhone recebe uma notificação perguntando se tudo foi registrado. Tocar nela abre a tela de registro. O mesmo cron diário também gera as cobranças de assinatura do dia, sem depender de alguém abrir o app.

## Comportamento

### Ativar o lembrete (Configurações)

- Uma seção "Lembrete diário" em Configurações, com um interruptor "Lembrar às 21h neste aparelho".
- **O lembrete é por aparelho:** cada aparelho ligado vira uma inscrição de push, e quem tem o app no iPhone e no computador escolhe em quais receber. Não há horário configurável: o plano Hobby da Vercel permite um cron por dia.
- **Ligar:**
  1. pede a permissão de notificação do sistema (só pode ser pedida a partir de um toque);
  2. cria a inscrição no navegador (`pushManager.subscribe`) com a chave pública VAPID;
  3. salva no servidor, por uma Server Action com Zod.
- **Desligar:** cancela a inscrição no navegador e apaga a linha no servidor.
- **O estado do interruptor vem do aparelho:** ligado se o navegador tem uma inscrição e ela está salva para o usuário logado.
- **Quando não dá para ligar,** o interruptor fica desativado com o motivo:
  - **iPhone fora do app instalado:** "No iPhone, o lembrete só funciona com o app instalado na Tela de Início." (o push no iOS exige o PWA instalado, iOS 16.4+);
  - **permissão negada:** "As notificações estão bloqueadas. Libere em Ajustes › Notificações › Finanças." (no iPhone) ou "nas configurações do navegador" (nos outros);
  - **navegador sem push:** "Este navegador não recebe notificações.";
  - **servidor sem chaves VAPID** (ambiente de desenvolvimento sem configuração): "Lembretes indisponíveis neste ambiente."
- **Botão "Enviar notificação de teste"** (com o lembrete ligado): manda na hora, só para este aparelho, "Teste do Finanças: as notificações estão funcionando." Se a inscrição tiver expirado, ela é apagada e o interruptor volta a desligado, com o aviso "A inscrição deste aparelho expirou. Ligue de novo."

### O cron diário

- **`vercel.json`:** um cron em `/api/cron/daily` com `0 0 * * *` (meia-noite UTC, 21h de Brasília).
  - No plano Hobby, a Vercel dispara em algum momento dentro dessa hora, então o lembrete chega entre 21h e 21h59.
- **Proteção da rota:** só aceita `Authorization: Bearer <CRON_SECRET>`, que a Vercel envia sozinha quando a variável existe.
  - A comparação do segredo é em tempo constante.
  - Sem o cabeçalho, ou com outro valor, a rota responde `401`.
  - Sem `CRON_SECRET` configurado, também `401`: nunca fica aberta por falta de configuração.
  - O proxy deixa `/api/cron` passar, para a rota responder em vez de redirecionar ao login.
- **O que o cron faz, nesta ordem:**
  1. **Gera as cobranças de assinatura** de todos os espaços (`generateRecurring`, da task 13). A falha de um espaço é registrada no log e não impede os outros.
  2. **Envia os lembretes** a todas as inscrições.
- **Resposta:** JSON com contagens (espaços gerados, enviados, removidos, falhas), sem dados pessoais. O log da Vercel serve para conferir.

### O lembrete

- **Título:** "Registrou tudo hoje?"
- **Texto:** depende do que o usuário registrou no dia, pela hora de registro (`createdAt`) no fuso de São Paulo. Não contam as cobranças de assinatura que o próprio cron gera, e uma compra parcelada conta uma vez, não uma por parcela:
  - nada registrado hoje: "Nenhum lançamento hoje. Teve algum gasto?";
  - 1 lançamento: "Você registrou 1 lançamento hoje. Faltou algum?";
  - N lançamentos: "Você registrou N lançamentos hoje. Faltou algum?".
- **Sempre envia,** mesmo com lançamentos no dia: o lembrete é para conferir, não só para quem esqueceu tudo. É o "lembrete inteligente" simples que a issue permite.
- **A notificação:**
  - leva o ícone do app;
  - usa uma `tag` fixa (`daily-reminder`), para um lembrete novo substituir o anterior em vez de acumular;
  - abre `/registrar` ao ser tocada.
- **Sem dados financeiros na notificação:** só a contagem, nunca valores ou nomes. A tela de bloqueio é visível para qualquer um.
- **Um usuário com vários aparelhos** recebe em cada um, e o texto é o mesmo.

### Envio e inscrições expiradas

- **Biblioteca:** `web-push`, com as chaves VAPID das variáveis de ambiente. O `subject` é a URL pública do app, sem e-mail: na Vercel, o domínio de produção ou a URL do preview (as mesmas variáveis do Better Auth, task 4); fora dela, `VAPID_SUBJECT`. Precisa ser `https` e não pode ser `localhost`, que a Apple recusa: sem isso, o lembrete fica indisponível em vez de falhar toda noite.
- **Envio:** em paralelo, com limite de 10 por vez, limite de 10 s por envio e TTL de 12 h. Se o aparelho ficar desligado até de manhã, o lembrete da noite não chega atrasado.
- **Resposta do serviço de push, por inscrição:**
  - `404` ou `410`: a inscrição expirou e é apagada;
  - outros erros (`429`, `5xx`, rede): ficam no log, a inscrição continua e o próximo dia tenta de novo.
- As regras puras ficam em `src/domain/reminder.ts` (o texto do lembrete, o que fazer com cada status). O envio fica em `src/server/push.ts`, e o `web-push` é chamado só ali.

### Service worker

- **Evento `push`:** mostra a notificação com o título, o texto e a URL que vierem no payload. Um payload vazio ou inválido vira o lembrete padrão, porque o iOS cancela a inscrição de quem recebe push sem mostrar notificação.
- **Evento `notificationclick`:** fecha a notificação. Se o app já estiver aberto, foca a janela e navega para a URL; senão, abre uma janela nova nela.

### Aparelho trocado de mãos

- **Ao sair da conta,** o botão "Sair" cancela a inscrição de push deste aparelho antes de encerrar a sessão: apaga a linha no servidor e cancela no navegador, com limite de 3 s para não travar a saída. Se falhar, o servidor apaga a linha no próximo envio, ao receber o `410`. Uma sessão que só expirou não cancela nada.
- **Ao salvar uma inscrição** cujo `endpoint` já existe para outro usuário, ela passa para quem está logado.

### Dados

- **Modelo `PushSubscription`:**
  - `id`;
  - `userId` (cascade ao apagar o usuário);
  - `endpoint` (único);
  - `p256dh` e `auth` (as chaves da inscrição);
  - `userAgent` (para o log);
  - `createdAt` e `lastSentAt`.
- **Sem `spaceId`:** a inscrição é do usuário e do aparelho, não do espaço. O texto do lembrete conta os lançamentos de `createdById` = usuário.
- **Endpoint só de serviços de push conhecidos** (Apple, Google, Mozilla, Microsoft), em `https`. O servidor faz um POST nesse endereço todo dia, então ele não pode ser um endereço qualquer, como um interno.
- **Variáveis novas no `.env.example`:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `CRON_SECRET`.
  - A chave pública chega ao navegador como prop de um componente do servidor, sem `NEXT_PUBLIC_`.

### O que o João configura na Vercel

As chaves e o segredo são gerados e cadastrados por você, no seu terminal. Eles não passam pelo chat.

1. `npx web-push generate-vapid-keys`.
2. `vercel env add VAPID_PUBLIC_KEY`, `vercel env add VAPID_PRIVATE_KEY` e `vercel env add CRON_SECRET` (este gerado com `openssl rand -base64 32`), em Production e Preview.

O PR traz esses passos. Sem eles, o app funciona normalmente: a seção mostra "Lembretes indisponíveis neste ambiente" e o cron responde `401`.

## Critérios de aceite

- [ ] CA1 — Integração: a rota do cron responde `401` sem o cabeçalho, com um segredo errado e com `CRON_SECRET` vazio, e roda com o segredo certo.
- [ ] CA2 — Integração com `web-push` mockado: a inscrição que recebe `410` (e a que recebe `404`) é apagada, a que recebe `500` continua, e uma falha não impede as outras.
- [ ] CA3 — Unitário: o texto do lembrete com 0, 1 e N lançamentos no dia de São Paulo (uma virada de dia perto da meia-noite UTC incluída), e a decisão por status.
- [ ] CA4 — Integração: o cron gera as cobranças de assinatura vencidas de dois espaços, e a falha de um não impede o outro.
- [ ] CA5 — Integração: salvar uma inscrição valida com Zod, faz upsert por `endpoint` e reatribui ao usuário logado. Apagar só remove a do próprio usuário. O teste de envio só usa uma inscrição do usuário logado.
- [ ] CA6 — E2E: a seção "Lembrete diário" mostra o motivo certo quando não dá para ligar (no Safari do iPhone fora do app instalado, e sem chaves VAPID).
- [ ] CA7 — Verificação manual no iPhone, pelo preview com as chaves configuradas: ligar o lembrete no app instalado, receber a notificação de teste e, ao tocar nela, abrir o registro. Fica com o João. O lembrete das 21h em si só pode ser conferido em produção, depois da release.
- [ ] CA8 — Lint, format, test, build, `test:e2e:docker` e CI verdes.

## Casos de borda

- **O cron roda duas vezes no mesmo dia** (a Vercel pode repetir): o lembrete chega de novo e substitui o anterior pela `tag`. A geração de assinaturas é idempotente (task 13).
- **Aparelho desligado às 21h:** o serviço de push guarda a mensagem por até 12 h.
- **Permissão revogada depois** (Ajustes do iPhone): o serviço passa a responder `410` e a inscrição é apagada no próximo envio. A seção mostra o motivo.
- **Reinstalar o app no iPhone:** cria outra inscrição. A antiga expira e é apagada no envio seguinte.
- **Sessão expirada:** o lembrete continua chegando, porque a inscrição é do aparelho. Tocar nele leva ao login e depois ao registro (o `next` da task 3).

## Decisões

- **Lembrete por aparelho, sem horário configurável.** O plano Hobby limita a um cron por dia, e um interruptor por aparelho resolve a escolha de onde receber, sem tabela de preferências.
- **O cron também gera as assinaturas.** É o "caminho limpo" previsto na task 13. A geração ao abrir as telas continua como garantia.
- **Sempre enviar, com o texto conforme o dia.** É simples, e não deixa de lembrar quem registrou só parte dos gastos.
- **TTL de 12 h.** Um lembrete das 21h que chegasse ao meio-dia seguinte confundiria mais do que ajudaria.
- **`subject` VAPID com a URL do app.** O serviço de push aceita URL ou e-mail, e a URL evita colocar um e-mail pessoal na configuração.

## Revisão

O revisor (Opus, effort high) pediu mudanças. Tudo foi corrigido.

- **Bloqueio: na Vercel, o remetente seria `https://localhost`, e a Apple recusaria todos os envios.** O `BETTER_AUTH_URL` não existe na Vercel (task 4). Agora o remetente vem das mesmas variáveis do Better Auth, e sem um `https` válido o lembrete fica indisponível.
- **Grave: a lista de serviços de push podia ser contornada com `%2E` no endereço.** O `web-push` entende a URL de outro jeito que o `new URL`, e o servidor faria POST para qualquer host. Agora o host escrito tem que ser igual ao interpretado, sem porta, e a URL é gravada normalizada. Os casos entraram nos testes.
- **Grave: o lembrete contava o que o usuário não registrou.** Entravam a cobrança de assinatura que o cron gera segundos antes e cada parcela de uma compra. Agora elas ficam de fora, com teste de integração.
- **Também corrigido:**
  - cada envio tem limite de 10 s, para um serviço parado não segurar o cron;
  - uma falha ao apagar ou atualizar uma inscrição não derruba os outros envios;
  - ao ligar, uma inscrição feita com uma chave antiga é refeita;
  - "Sair" manda a inscrição junto com a própria saída, numa action só, em vez de uma segunda action que ficaria na fila;
  - o endereço aberto pela notificação recusa barra invertida e espaço, e o service worker confere a origem;
  - o ícone colorido saiu do `badge`;
  - as funções do cliente usadas no "Sair" ganharam testes.
- **Anterior a esta task (task 3), corrigido aqui:** antes de a página hidratar, o login e o cadastro enviavam por GET, e a senha ia para a URL (histórico, logs da Vercel). Agora os formulários usam `method="post"`. O e2e espera a hidratação, o que resolvia a corrida do CA9 da task 16 sob carga.
- **Aceito:** um endpoint conhecido por outra pessoa poderia ser reatribuído a ela, mas endpoints não são adivinháveis nem aparecem em lugar nenhum. Também não há limite de inscrições por usuário, porque o cadastro em produção é fechado.

## Fora do escopo

- Horário do lembrete configurável, ou mais de um lembrete por dia (o plano Hobby limita o cron).
- Outros avisos por push: fatura fechando, assinatura cobrada, saldo divergente.
- Mostrar no app o histórico de notificações enviadas.
