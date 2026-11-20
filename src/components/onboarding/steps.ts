/** The onboarding's steps (task 22), in order. Pure: no server or React imports. */
export const ONBOARDING_STEPS = [
  { title: "Contas", question: "Quais contas você usa? Informe o saldo de hoje de cada uma." },
  { title: "Cartões e faturas", question: "Quais cartões de crédito você usa?" },
  {
    title: "Parcelamentos em andamento",
    question: "Tem compras parceladas que ainda não acabaram?",
  },
  { title: "Assinaturas ativas", question: "Quais assinaturas você paga todo mês?" },
] as const;

/** The step in the URL (`?passo=1..4`); anything else is the first one. */
export function parseStep(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= ONBOARDING_STEPS.length ? n : 1;
}
