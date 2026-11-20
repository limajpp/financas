# Verificação manual da v1

O roteiro do [design](specs/v1-design.md#verificação), de ponta a ponta, para dar a v1 como pronta. Os testes automáticos (Vitest e Playwright, no Chromium e no WebKit do iPhone) cobrem as regras e os fluxos. Este roteiro confere o que só uma pessoa vê: o app instalado, o modo avião, o push de verdade e o uso no dia a dia.

- **No computador:** executado pelo Claude na task 26, no build de produção local, com dados inventados (registro abaixo).
- **No iPhone:** executado pelo João, com o app instalado da produção, depois do release `develop → main`. O que falhar vira uma issue.

Use sempre dados inventados nos testes de verificação, ou a sua conta real só depois de conferir que tudo funciona.

## Roteiro

| #   | Passo                                                                                                                                                                                                | Computador | iPhone |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ |
| 1   | Criar a conta e passar pelo onboarding: uma conta com saldo, o cartão com a fatura aberta, uma compra parcelada em curso e uma assinatura.                                                           | ✅         | ⬜     |
| 2   | Instalar na Tela de Início (Compartilhar → Adicionar à Tela de Início). Abre em tela cheia, com o ícone do app.                                                                                      | —          | ⬜     |
| 3   | Registrar uma despesa só com o valor, em poucos segundos. Ela aparece no início e na lista.                                                                                                          | ✅         | ⬜     |
| 4   | Registrar uma receita, uma transferência entre contas, uma compra parcelada no crédito e uma assinatura.                                                                                             | ✅         | ⬜     |
| 5   | A memória: registrar de novo no mesmo lugar sugere a descrição e a categoria.                                                                                                                        | ✅         | ⬜     |
| 6   | Modo avião: abrir o app, registrar um gasto, ver "na fila"; voltar a conexão e ver sincronizar sozinho.                                                                                              | ✅ ¹       | ⬜     |
| 7   | Pagar uma fatura: o pagamento não conta como gasto, e a fatura fica paga.                                                                                                                            | ✅         | ⬜     |
| 8   | Conferir o saldo de uma conta com diferença: registrar o que falta ou criar o ajuste. O saldo fica igual ao do banco.                                                                                | ✅         | ⬜     |
| 9   | Estabelecimentos: o ranking, editar a memória de um e mesclar dois.                                                                                                                                  | ✅         | ⬜     |
| 10  | Assinaturas: editar o valor (aparece "subiu"), pausar e retomar.                                                                                                                                     | ✅         | ⬜     |
| 11  | Dashboard: os quatro números, os destaques, as categorias e o gráfico. Trocar de mês e voltar.                                                                                                       | ✅         | ⬜     |
| 12  | Lembrete: ligar no app instalado, receber a notificação de teste e, ao tocar nela, abrir o registro.                                                                                                 | — ²        | ⬜     |
| 13  | O lembrete das 21h chega num dia sem registro (produção, com o Cron Job da Vercel ativo).                                                                                                            | —          | ⬜     |
| 14  | Modo escuro: trocar o tema do aparelho; as telas e o teclado do registro acompanham. No iPhone, também a barra de status e a abertura do app (o manifesto tem fundo branco fixo: conferir se pisca). | ✅ ³       | ⬜     |
| 15  | O início abre rápido no app instalado, mesmo depois de dias sem abrir.                                                                                                                               | —          | ⬜     |

³ No computador, as telas nos dois temas; a cor das barras (`theme-color`) o Chrome do computador não mostra, e ela fica para o iPhone.

¹ No computador, o modo offline do navegador (o e2e de offline faz o mesmo no WebKit).
² O navegador do computador assina o push, mas o recebimento de verdade só se confere num aparelho; no e2e, o envio é simulado.

Os passos 2, 6, 12 e 15 fecham os pendentes das tasks 15 (CA6), 17 (CA7) e 25 (CA10).

## Registro

### Computador (Claude, 2026-11-20)

- **Onde:** o build de produção local, com dados inventados.
  - O e2e rodou no Docker com `CI=1`, o que faz o Playwright subir o `npm run start` (o build), e não o servidor de desenvolvimento. Depois de um `npm run build`, o comando foi:
    `docker run --rm --network host --ipc=host --user "$(id -u):$(id -g)" -e HOME=/tmp -e CI=1 -v "$PWD":/work:z -w /work mcr.microsoft.com/playwright:v1.64.1-noble npx playwright test --retries=0`
  - O `--retries=0` é explícito: com `CI=1`, o padrão do projeto é tentar de novo duas vezes.
  - As capturas da auditoria e o Lighthouse também usaram o build.
- **Como:** cada passo do computador é um fluxo do e2e no Chromium, que rodou completo e sem novas tentativas. Além disso, todas as telas foram percorridas com uma conta nova e com uma conta com dados, nos temas claro e escuro, com capturas conferidas uma a uma.
  - Passo 1: `e2e/onboarding.spec.ts`.
  - Passos 3 e 4: `register`, `transfers`, `installments` e `subscriptions`.
  - Passo 5: `counterparties`.
  - Passo 6: `offline`.
  - Passo 7: `invoices`.
  - Passo 8: `reconcile`.
  - Passo 9: `counterparties-screen`.
  - Passo 10: `subscriptions-screen`.
  - Passo 11: `dashboard`.
  - Passo 14: `a11y`, nos dois temas, mais as capturas.
- **Resultado:** todos os passos do computador passaram. O detalhe do que mudou está na spec da task 26.

### iPhone (João)

- **Data:**
- **Versão:** produção, depois do release.
- **Resultado:**
