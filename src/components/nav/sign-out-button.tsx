import { LogOut } from "lucide-react";

import { signOutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";

export function SignOutButton({ className }: { className?: string }) {
  return (
    <form action={signOutAction} className={className}>
      <Button type="submit" variant="ghost" className="w-full justify-start gap-2">
        <LogOut aria-hidden className="size-4" />
        Sair
      </Button>
    </form>
  );
}
