import { Suspense } from "react";

import { InstallHint } from "@/components/pwa/install-hint";
import { generateRecurringSafely } from "@/server/recurring";
import { getCurrentSpace, getCurrentUser } from "@/server/session";

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-10">
      <Suspense fallback={<h1 className="text-2xl font-semibold tracking-tight">Olá</h1>}>
        <Greeting />
      </Suspense>
      <p className="mt-2 text-muted-foreground">Em breve, o resumo do seu mês aparece aqui.</p>
      <InstallHint />
    </div>
  );
}

async function Greeting() {
  const [user, space] = await Promise.all([getCurrentUser(), getCurrentSpace()]);
  // Opening the app charges the subscriptions due up to today (task 13).
  await generateRecurringSafely(space.id);
  return <h1 className="text-2xl font-semibold tracking-tight">Olá, {user.name}</h1>;
}
