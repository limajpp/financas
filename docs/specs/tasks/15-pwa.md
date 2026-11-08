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
- **Precache:** os arquivos estáticos do build (JS, CSS, fontes e ícones) e a página `/~offline`.
- **Em tempo de execução** (`defaultCache` do Serwist):
  - as páginas usam "rede primeiro, cache depois": com rede, sempre a versão nova; sem rede, a última versão daquela tela;
  - os arquivos estáticos usam "cache primeiro".
- **Sem rede e sem versão guardada daquela tela:** a página `/~offline` diz "Você está sem conexão. O que já foi aberto continua disponível." e tem um botão "Tentar de novo".
- **Ações do servidor não vão para o cache.** Salvar sem rede continua dando o erro de conexão da task 9. A fila offline é a task 16.
- **Atualização:** um service worker novo assume na próxima abertura (`skipWaiting` e `clientsClaim`).
- **Sair da conta apaga os caches do app.** As páginas guardadas têm dados financeiros, e o próximo a usar o aparelho não deve vê-las.
- **O proxy de autenticação** deixa passar `/serwist/*`, o manifest e os ícones, para o navegador conseguir instalá-los sem sessão.
- **Em desenvolvimento** (`next dev`), o service worker fica desligado, para não servir código velho enquanto se programa. Ele liga no build de produção e no e2e, por uma variável de ambiente.

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
- **Deploy novo:** quem já tem o app aberto continua na versão antiga até fechar e abrir de novo.
- **Instalado pelo Chrome no Android ou no desktop:** funciona pelo manifest, e as instruções do iOS não aparecem.

## Decisões

- **`@serwist/turbopack` e não `@serwist/next`.** O `@serwist/next` depende do webpack, e o projeto usa o Turbopack padrão do Next 16. A variante para o Turbopack gera o service worker com esbuild, numa rota.
- **"Rede primeiro" para as páginas.** O saldo e a lista mudam a cada lançamento. Mostrar primeiro o cache deixaria números velhos na tela mesmo com rede. O cache é só para quando não houver conexão.
- **Apagar os caches ao sair da conta.** É a contrapartida de guardar páginas com dados financeiros no aparelho.
- **Service worker desligado no `next dev`.** Um service worker ativo em desenvolvimento serve arquivos velhos e confunde. O e2e liga ele por variável de ambiente para testar o comportamento real.
- **Ícone gerado de um SVG no repositório.** Sem dependência de ferramenta externa, e fácil de trocar depois.

## Fora do escopo

- A fila offline de lançamentos (task 16).
- Push e lembretes (task 17).
- Ícone desenhado por um designer, ou a tela de abertura do iOS (`apple-touch-startup-image`).
- Sincronização em segundo plano.
