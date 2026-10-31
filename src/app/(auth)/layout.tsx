export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">Finanças</h1>
          <p className="mt-1 text-muted-foreground">
            Registre cada gasto na hora e entenda o seu mês.
          </p>
        </div>
        {children}
      </div>
    </main>
  );
}
