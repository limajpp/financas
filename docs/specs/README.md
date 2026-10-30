# Specs

Este projeto é desenvolvido orientado a spec: nada vira código sem antes estar escrito e aprovado.

## Níveis

| Documento                      | O que define                                                                      | Quem aprova                    |
| ------------------------------ | --------------------------------------------------------------------------------- | ------------------------------ |
| [`v1-design.md`](v1-design.md) | O produto: problema, metas, regras de domínio, telas, indicadores, backlog        | João                           |
| `tasks/NN-slug.md`             | Uma task do backlog: comportamento, critérios de aceite, casos de borda, decisões | João, no chat, antes do código |
| Issue no GitHub                | O item do backlog (resumo + critérios) e o link para a spec da task               | —                              |

Se uma task revelar que o design está errado ou incompleto, o design é atualizado **no mesmo PR**, e a mudança é apontada na descrição.

## Ciclo de uma task

```
issue ──► spec da task ──► aprovação ──► testes (vermelho) ──► código (verde) ──► lint/test/build ──► revisor ──► PR → develop ──► merge
```

1. **Issue.** Pega a próxima issue da milestone v1 (em ordem, salvo se o João escolher outra).
2. **Spec.** Escreve `docs/specs/tasks/NN-slug.md` usando o modelo abaixo. O João aprova ou ajusta no chat.
3. **Branch.** `task/NN-slug`, a partir da `develop`.
4. **TDD.** Cada critério de aceite vira pelo menos um teste antes da implementação: Vitest para domínio e server, Playwright para fluxos.
5. **Verificação.** `npm run lint`, `npm test` e `npm run build` verdes. Nas tasks de UI, o fluxo é conferido no navegador (e no iPhone quando fizer sentido).
6. **Revisor.** Um subagente com contexto limpo recebe a spec e o diff. Procura bugs, desvios da spec e testes fracos. O que for aceito é corrigido; o que for descartado vai para o PR com o motivo.
7. **PR para a `develop`.** `Closes #N`, critérios marcados, resultado da revisão. Com o revisor aprovando e o CI verde, o Claude faz o squash merge e a branch é apagada.

Quando um conjunto de tasks estiver pronto, um PR `develop → main` gera a release (e o deploy de produção).

## Commits

Mensagens e títulos de PR em **inglês**, no formato `<gitmoji> <type>(<scope>)?: <description>`. Exemplo: `✨ feat(cards): add invoice cycle module`. O hook `.githooks/commit-msg` faz a validação.

## Modelo de spec de task

```markdown
# NN — Título

Issue: #N · Design: [seção](../v1-design.md#ancora)

## Objetivo

Uma ou duas frases: o que muda para o usuário (ou para o código) quando isso estiver pronto.

## Comportamento

O que acontece, passo a passo ou por regra.

## Critérios de aceite

- [ ] CA1 — verificável por teste
- [ ] CA2 — ...

## Casos de borda

- ...

## Decisões

- Decisão — motivo.

## Fora do escopo

- ...
```
