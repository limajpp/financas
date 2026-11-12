# 16 — Fila offline (Dexie) e `/api/sync` idempotente

Issue: #16 · Design: [Escolhas técnicas](../v1-design.md#escolhas-técnicas-decisão-do-claude-o-joão-valida) · [Verificação](../v1-design.md#verificação)

## Objetivo

Registrar no metrô ou em modo avião funciona: o lançamento fica guardado no aparelho e é enviado sozinho quando a conexão volta, sem falhar e sem duplicar.

## Comportamento

### Salvar sem rede

- Vale para o que a tela de registro cria: despesa, receita e transferência, inclusive compra parcelada e assinatura.
- **Com rede, nada muda:** o registro continua indo direto pela Server Action, com os erros no campo e o "Desfazer".
- **O lançamento vai para a fila quando:**
  - o aparelho está sem rede (`navigator.onLine` falso): nem tenta enviar;
  - o envio falha por rede ou erro do servidor (a action lança);
  - o envio não responde em 8 s (rede "fantasma").
- Antes de entrar na fila, os dados passam pelo mesmo schema Zod do servidor (`entrySchema` / `transferSchema`). Um erro de preenchimento aparece na hora, no campo, como hoje.
- O item da fila guarda o `clientId` que a tela já gerou. Se o primeiro envio chegou ao servidor mesmo sem resposta, o reenvio devolve o lançamento que já existe.
- Ao entrar na fila, aparece o aviso "Despesa de R$ 0,00 salva no aparelho. Ela será enviada quando a conexão voltar.", com "Desfazer" (tira o item da fila). O formulário volta em branco e **a tela continua no registro**, pronta para o próximo lançamento.

### A fila (Dexie)

- Banco `financas` no IndexedDB, tabela `outbox`, com um registro por lançamento:
  - `clientId` (chave), `userId`, `kind` (`ENTRY` | `TRANSFER`), `data` (o que o formulário enviaria), `createdAt`;
  - `status`: `PENDING` ou `REJECTED`, e no rejeitado a mensagem de erro e os erros por campo.
- Cada item pertence ao usuário que o criou (`userId`). Só os itens do usuário logado aparecem e são enviados.
- As regras da fila são funções puras em `src/domain/outbox.ts` (o que enviar, como aplicar a resposta do servidor, quando tentar de novo). O Dexie fica em `src/lib/outbox-db.ts`.

### Envio

- **Quando:** ao abrir o app, quando a conexão volta (`online`), quando o app volta para a frente (`visibilitychange`) e logo depois de um item entrar na fila.
- **Como:** `POST /api/sync` com os itens pendentes, em ordem de criação, em lotes de até 50.
- Só uma aba envia por vez (`navigator.locks`). Mesmo sem isso não duplicaria, por causa do `clientId`.
- **Resposta por item:**
  - `SYNCED`: sai da fila;
  - `REJECTED`: fica na fila como rejeitado, com a mensagem. Não é reenviado sozinho e não impede os outros.
- **Falha do lote inteiro** (rede, 5xx, 401): os itens continuam pendentes. Nova tentativa nos gatilhos acima e com espera crescente (5 s, 15 s, 1 min, 5 min).
- **Sessão expirada (401):** o indicador passa a dizer "Entre de novo para enviar N lançamentos". Depois do login, o envio acontece sozinho.
- Depois de enviar, aparece "N lançamentos sincronizados" e a tela atual é atualizada (`router.refresh()`).

### `/api/sync`

- `POST`, JSON `{ items: [{ clientId, kind, data }] }`, de 1 a 50 itens. Responde `{ results: [{ clientId, status, id?, error?, fieldErrors? }] }`, na mesma ordem.
- Exige sessão: sem ela, `401` em JSON (o proxy deixa `/api/sync` passar, para a rota responder em vez de redirecionar para o login).
- O espaço e o usuário vêm **só da sessão**. Nada no corpo escolhe o espaço.
- Recusa pedidos de outra origem (cabeçalho `Origin`) e corpo que não seja JSON.
- O envelope é validado com Zod: um corpo malformado dá `400`. Cada item é validado em separado, e um item inválido vira `REJECTED` sem derrubar o lote.
- Os itens são processados em sequência, pelas mesmas funções das actions (`createTransaction`, `createTransfer`). Daí vem a idempotência por `clientId` e as regras de domínio.
- Um erro inesperado em um item (exceção) não vira `REJECTED`: o item volta como `RETRY` e continua pendente no aparelho.
- A lógica fica em `src/server/sync.ts` (`syncItems(spaceId, userId, items)`), e a rota só cuida de sessão, origem e JSON.

### Indicador e itens com erro

- No app inteiro, um aviso discreto quando a fila do usuário não está vazia: "1 lançamento aguardando sincronização" / "N lançamentos aguardando sincronização". É uma faixa fina no topo da tela, no celular e no desktop.
- Com itens rejeitados, o aviso muda de cor e diz "N lançamentos com erro".
- Tocar no aviso abre uma folha com a lista: tipo, valor, o que foi, data e, nos rejeitados, o motivo.
  - **Pendente:** "Enviar agora" (para todos) e "Descartar".
  - **Rejeitado:** "Corrigir" e "Descartar".
- **"Corrigir"** abre a tela de registro preenchida com os dados do item. Salvar envia de novo (ou devolve o item à fila como pendente, se ainda sem rede), com o mesmo `clientId`.
- "Descartar" pede confirmação.

### Sair da conta

- Com a fila vazia, nada muda.
- Sem rede, "Sair" avisa que não é possível sair agora (a sessão é encerrada no servidor).
- Com itens na fila, "Sair" primeiro tenta enviar. Se sobrar algo, pergunta: "Há N lançamentos que ainda não foram enviados. Sair vai apagá-los deste aparelho." com "Cancelar" e "Sair e apagar".
- Sair sempre apaga a fila do usuário, junto com os caches (task 15).

## Critérios de aceite

- [ ] CA1 — E2E (Chromium e iPhone/WebKit): com o navegador offline, registrar uma despesa mostra o aviso de "salva no aparelho" e o indicador com 1 item. Ao voltar a rede, o indicador some e o lançamento aparece em Lançamentos, uma vez só. No build de produção, o mesmo com o app aberto já sem rede, pelo service worker.
- [ ] CA2 — Integração: enviar o mesmo lote duas vezes para `/api/sync`, em sequência e em paralelo, resulta em um lançamento por `clientId`, e as duas respostas trazem `SYNCED` com o mesmo `id`.
- [ ] CA3 — Integração: num lote com um item inválido no meio (schema ou regra de domínio), os outros são criados e o inválido volta `REJECTED` com a mensagem em pt-BR.
- [ ] CA4 — Integração: um item que aponta para conta, cartão ou categoria de outro espaço é `REJECTED` e nada é criado em nenhum dos dois espaços. O mesmo `clientId` usado em outro espaço não devolve o lançamento de lá.
- [ ] CA5 — Integração: `/api/sync` sem sessão responde `401`; de outra origem, `403`; corpo malformado ou com mais de 50 itens, `400`.
- [ ] CA6 — Unitário (`domain/outbox.ts`): aplicar a resposta do servidor tira os `SYNCED`, marca os `REJECTED` e mantém os `RETRY`; itens de outro usuário não entram no lote; a espera entre tentativas cresce e volta ao início depois de um envio que deu certo.
- [ ] CA7 — Unitário (Dexie com `fake-indexeddb`): adicionar, listar por usuário, descartar, substituir (corrigir) e apagar a fila do usuário.
- [ ] CA8 — E2E: um item rejeitado aparece na folha com o motivo; "Corrigir" abre o registro preenchido, e salvar com rede cria o lançamento e esvazia a fila.
- [ ] CA9 — E2E: sair com item pendente e sem conseguir enviar pede confirmação, e confirmar apaga a fila.
- [ ] CA10 — E2E: a compra parcelada e a transferência feitas offline sincronizam (as parcelas todas, uma vez).
- [ ] CA11 — Lint, format, test, build, `test:e2e:docker` e CI verdes.

## Casos de borda

- **O primeiro envio chegou, mas a resposta não.** O item vai para a fila, e o reenvio recebe `SYNCED` com o lançamento que já existia.
- **A conta, o cartão ou a categoria foi arquivada entre o registro e o envio.** O item é rejeitado com a mensagem da regra, e "Corrigir" deixa escolher outra.
- **Data.** O lançamento leva a data escolhida no registro, não a do envio. Registrado ontem e enviado hoje, fica em ontem. A fatura de uma compra no crédito é calculada no servidor, na hora do envio, a partir dessa data.
- **Tela de registro vinda do cache** (aberta sem rede): as contas, os cartões e a memória de estabelecimentos são os da última visita com rede. A data inicial vem do relógio do aparelho, não do HTML guardado.
- **Estabelecimento novo digitado offline:** é criado no envio, como no registro normal. Só entra no autocomplete depois de sincronizar.
- **Duas abas ou o app e o Safari abertos:** a fila é a mesma (mesmo IndexedDB), e o indicador das duas se atualiza (`liveQuery` do Dexie).
- **Outro usuário entra no mesmo aparelho** (só acontece se a fila não foi apagada, por exemplo com a sessão expirada): não vê nem envia os itens do primeiro.
- **IndexedDB indisponível** (navegação privada antiga, armazenamento cheio): o registro sem rede mostra o erro de conexão de hoje, com tudo preenchido.
- **O iOS apaga o armazenamento de um site sem uso por semanas** quando ele não está instalado. Instalado na tela inicial, não. Fica documentado, sem tratamento.

## Decisões

- **Com rede, o caminho continua sendo a Server Action.** Passar tudo pela fila tiraria os erros no campo e o "Desfazer" com o lançamento já criado. A fila é só o plano B.
- **Tempo limite de 8 s no envio direto.** Com sinal fraco, a action fica pendurada. Como o `clientId` evita duplicar, é seguro desistir, guardar na fila e deixar o envio original chegar se chegar.
- **Um erro do servidor também vai para a fila,** não só a falta de rede. A fila tenta de novo com espera crescente, e nada digitado se perde.
- **Rejeitado não trava e não some.** Fica visível até ser corrigido ou descartado.
- **`RETRY` separado de `REJECTED`.** Um erro inesperado do servidor não é culpa do item, e não deve pedir correção.
- **Sair apaga a fila, depois de tentar enviar e de avisar.** É a mesma regra dos caches: nenhum dado financeiro fica no aparelho depois de sair. A alternativa (guardar para o próximo login) deixaria lançamentos legíveis no IndexedDB.
- **O espaço vem da sessão, nunca do corpo.** É isso que faz a rota "recusar itens de outro espaço": referências de fora simplesmente não existem para ela.
- **Sem rede, a tela fica no registro depois de salvar.** Ir para a tela inicial depende da rede (ou de uma cópia guardada dela), e o aviso de "salva no aparelho" se perderia num recarregamento. De quebra, registrar vários gastos seguidos no metrô fica mais rápido.
- **O aviso é uma faixa no topo, não um botão flutuante.** Flutuando acima da barra inferior, ele cobria o botão "Salvar" do registro no celular (pego pelo e2e do iPhone).
- **`E2E_PORT` no `playwright.config.ts`.** Para rodar o e2e numa máquina em que a porta 3000 já está ocupada. Sem a variável, nada muda.
- **Sem Background Sync.** O Safari não tem. O envio acontece com o app aberto.
- **Só a tela de registro entra na fila.** O pagamento de fatura (em Contas) depende de valores da fatura que precisam de rede.

## Fora do escopo

- Editar e excluir offline (v1: só criação).
- Pagamento de fatura offline.
- Ler dados novos offline: as telas mostram a última versão guardada (task 15).
- Push (task 17).
