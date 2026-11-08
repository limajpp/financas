# 15 — PWA: manifest, ícones, Serwist e instalação no iOS

Issue: #15 · Design: [Escolhas técnicas](../v1-design.md#escolhas-técnicas-decisão-do-claude-o-joão-valida) · [Anti-metas](../v1-design.md#anti-metas-o-que-faz-o-joão-largar-o-app)

## Objetivo

Instalar o app na tela inicial do iPhone. Ele passa a abrir em tela cheia, como um app, e na hora: o que já foi carregado vem do aparelho, e sem rede ele ainda abre, mostrando a última versão de cada tela ou um aviso de sem conexão. Esta task prepara a base que a fila offline (task 16) e o push (task 17) vão usar.

## Comportamento

### Manifest e ícones

- **`app/manifest.ts`** (rota de metadados do Next):
  - nome "Finanças" e nome curto "Finanças";
  - `start_url: "/"`, `display: "standalone"` e `orientation: "portrait"`;
  - `lang: "pt-BR"`, com a cor do tema e do fundo seguindo o tema claro;
  - ícones de 192 e 512 px, comuns e `maskable`, com margem segura;
  - um atalho "Registrar" para `/registrar`, que aparece ao tocar e segurar no ícone, onde o sistema oferece isso.
- **`apple-touch-icon`** de 180 px (`app/apple-icon.png`) e `favicon`.
- **Metadados do iOS** (`appleWebApp`): app capaz de tela cheia, título "Finanças" e a barra de status no estilo padrão. O conteúdo não fica por baixo do relógio.
- **O ícone:** um desenho simples e original (um "F" estilizado sobre uma cor sólida), gerado a partir de um SVG do próprio repositório. Os PNGs são gerados por um script (`scripts/icons.mjs`) e commitados.

### Service worker (Serwist)

- **`@serwist/turbopack`,** a variante para o Turbopack, que é o bundler padrão do Next 16:
  - o service worker é servido por uma rota (`/serwist/sw.js`);
  - o código-fonte fica em `app/sw.ts`;
  - o registro é feito pelo `SerwistProvider` no layout raiz.
- **Precache:** os arquivos estáticos do build (JS, CSS, fontes e ícones) e a página `/~offline`. A rota `/serwist/sw.js` é gerada inteira no build e nunca expira.
- **Em tempo de execução** (`defaultCache` do Serwist):
  - as páginas usam "rede primeiro, cache depois": com rede, sempre a versão nova; sem rede, a última versão daquela tela;
  - os arquivos estáticos usam "cache primeiro".
- **Sem rede e sem versão guardada daquela tela:** a página `/~offline` diz "Você está sem conexão. O que já foi aberto continua disponível." e tem um botão "Tentar de novo".
- **Ações do servidor não vão para o cache.** Salvar sem rede continua dando o erro de conexão da task 9. A fila offline é a task 16.
- **Atualização:** um service worker novo assume assim que é baixado (`skipWaiting` e `clientsClaim`), o que acontece ao abrir o app depois de um deploy.
- **Sair da conta apaga os caches do app.** As páginas guardadas têm dados financeiros, e o próximo a usar o aparelho não deve vê-las. Quem apaga é o service worker: uma tela que ainda estava carregando quando "Sair" foi tocado não é guardada depois. Os registros de validade, que guardam os endereços (com termos de busca), também são apagados. Fontes, scripts e estilos ficam.
- **O proxy de autenticação** deixa passar `/serwist/*`, o manifest e os ícones, para o navegador conseguir instalá-los sem sessão.
- **Em desenvolvimento** (`next dev`), o service worker fica desligado, para não servir código velho enquanto se programa. Ele só existe no build de produção. Os e2e que dependem dele rodam no CI, que testa o build de produção; localmente, com `npm run build` e `CI=1`.

### Instruções de instalação no iOS

- No Safari do iPhone, fora do modo instalado, a tela inicial mostra um cartão: "Instale o app: toque em Compartilhar e depois em Adicionar à Tela de Início".
- Ele tem um "Agora não", que esconde o cartão por 30 dias, guardado no aparelho.
- Instalado, ou em outro navegador, o cartão não aparece.
- Em Configurações, uma seção "Instalar no iPhone" repete as instruções, com os passos numerados.

### Safe areas

- A barra inferior já respeita a área de baixo. O topo, o lado (no iPhone deitado) e as folhas de baixo passam a respeitar as áreas seguras também. O conteúdo nunca fica atrás do notch, da ilha dinâmica ou da barra de gestos.

## Critérios de aceite

- [ ] CA1 — E2E (Chromium): o app é instalável. O manifest é válido, o service worker está ativo, e o Chromium não aponta erros de instalação (`Page.getInstallabilityErrors` vazio, o equivalente atual do selo "instalável" do Lighthouse, que saiu da versão 12).
- [ ] CA2 — E2E (Chromium e iPhone/WebKit), em modo offline: depois de abrir o app com rede, com a rede cortada a tela inicial abre a partir do cache. Uma tela nunca aberta mostra a página de sem conexão.
- [ ] CA3 — E2E: sair da conta apaga os caches do app.
- [ ] CA4 — Unitário e e2e: o cartão de instalação aparece só no Safari do iPhone fora do modo instalado e some por 30 dias com "Agora não".
- [ ] CA5 — Integração do proxy: `/manifest.webmanifest`, `/serwist/sw.js` e os ícones respondem sem sessão.
- [ ] CA6 — Verificação manual no iPhone, pelo preview e depois pela produção: instala, abre em tela cheia com o ícone certo e, em modo avião, abre as telas já visitadas. Este critério é do João, e o PR pede que ele confira.
- [ ] CA7 — Lint, format, test, build, `test:e2e:docker` e CI verdes.

## Casos de borda

- **Primeira abertura já sem rede** (o app nunca foi aberto): não há cache, e o navegador mostra o erro dele. Só a partir da segunda abertura existe versão guardada.
- **Sessão expirada e o app aberto sem rede:** aparece a última versão guardada da tela. Ao voltar a rede, ir para outra tela leva ao login, como hoje.
- **Deploy novo:** com o app aberto, o Next recarrega a página na próxima navegação. As telas guardadas antes do deploy apontam para os arquivos do build anterior, que o service worker novo apaga: sem rede, elas só abrem completas se o navegador ainda tiver esses arquivos no cache dele. Com rede, a próxima visita guarda a versão nova.
- **Instalado pelo Chrome no Android ou no desktop:** funciona pelo manifest, e as instruções do iOS não aparecem.

## Decisões

- **`@serwist/turbopack` e não `@serwist/next`.** O `@serwist/next` depende do webpack, e o projeto usa o Turbopack padrão do Next 16. A variante para o Turbopack gera o service worker com esbuild, numa rota.
- **"Rede primeiro" para as páginas.** O saldo e a lista mudam a cada lançamento. Mostrar primeiro o cache deixaria números velhos na tela mesmo com rede. O cache é só para quando não houver conexão.
- **Apagar os caches ao sair da conta.** É a contrapartida de guardar páginas com dados financeiros no aparelho.
- **Service worker desligado no `next dev`.** Um service worker ativo em desenvolvimento serve arquivos velhos e confunde. Os e2e dele rodam contra o build de produção.
- **A rota do service worker é prerenderizada.** Na Vercel, os arquivos estáticos do build ficam na CDN, não ao lado da função. Por isso, a lista do precache e o próprio `sw.js` são gerados no build, com `use cache`, já que o Cache Components não aceita as opções de rota que o Serwist traz.
- **Cada tela é guardada uma vez por abertura do app.** O Serwist pode guardar a página a cada navegação, mas isso faria o servidor renderizar tudo de novo a cada clique, e a cada filtro da lista. Aqui, a tela é guardada na primeira visita depois de abrir o app, e só pelo caminho, sem os filtros.
- **Voltar a rede não recarrega a página.** O recarregamento automático do Serwist apagaria um lançamento pela metade.
- **Ícone gerado de um SVG no repositório.** Sem dependência de ferramenta externa, e fácil de trocar depois.

## Revisão

O revisor (Opus, effort high) pediu mudanças por dois problemas graves, já corrigidos.

- **`/serwist/sw.js` seria refeito a cada 30 dias, e o refazer falharia na Vercel.** O `cacheLife("max")` expira, e a função não tem o código do service worker nem os arquivos do build. Agora o cache nunca expira, e a rota é estática de verdade (`revalidate: false` no build). Ela também virou um segmento fixo (`serwist/sw.js`), sem parâmetro, e o Serwist só é criado dentro da função em cache: nada de build roda no servidor.
- **Sair podia deixar uma tela guardada.** Uma tela que ainda carregava quando "Sair" foi tocado voltava para o cache depois da limpeza. A limpeza passou para o service worker, que numera cada saída e descarta as respostas de pedidos feitos antes dela.
- **Também corrigido:**
  - a cor do tema escura saiu, porque o app ainda não tem modo escuro;
  - as fontes entraram no precache, e a limpeza apaga só os caches que podem ter dados (telas, API e os genéricos), não fontes, scripts e estilos;
  - sem o tempo limite de 8 s nas telas: com rede, sempre a versão nova, mesmo com o servidor lento;
  - a tela é marcada como guardada só depois de guardada, é tentada de novo se a conexão era só aparente, e a primeira tela da abertura não é pedida duas vezes;
  - o id do precache da página offline muda a cada build;
  - as folhas de baixo respeitam as laterais do iPhone deitado;
  - o ícone de compartilhar é anunciado pelo leitor de tela.
- **Segunda rodada: aprovado com nits, todos aplicados.**
  - A proteção da limpeza fica só nos caches de telas e API. Nos de arquivos estáticos ela desligava a regra que guarda só respostas 200.
  - A limpeza apaga só os caches com dados, e também os registros de validade de cada um deles.
  - As folhas voltam ao espaçamento lateral de antes, com a área segura só onde ela é maior.
  - A página também apaga os caches, caso a mensagem chegue a um service worker recém-substituído.
- **Aceito e documentado:** depois de um deploy, uma tela guardada antes pode abrir sem estilo quando não há rede (ver casos de borda). Guardar de novo todas as telas a cada deploy custaria uma renderização por tela.

## Fora do escopo

- A fila offline de lançamentos (task 16).
- Push e lembretes (task 17).
- Ícone desenhado por um designer, ou a tela de abertura do iOS (`apple-touch-startup-image`).
- Sincronização em segundo plano.
