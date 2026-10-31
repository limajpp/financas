import { Suspense } from "react";

import { getCurrentUser } from "@/server/session";

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-10">
      <Suspense fallback={<h1 className="text-2xl font-semibold tracking-tight">Olá</h1>}>
        <Greeting />
      </Suspense>
      <p className="mt-2 text-muted-foreground">Em breve, o resumo do seu mês aparece aqui.</p>
    </div>
  );
}

async function Greeting() {
  const user = await getCurrentUser();
  return <h1 className="text-2xl font-semibold tracking-tight">Olá, {user.name}</h1>;
}
