import { NavLink } from "./nav-link";
import { sidebarItems } from "./nav-items";
import { SignOutButton } from "./sign-out-button";

export function Sidebar({ user }: { user: React.ReactNode }) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
      <div className="px-5 py-6 text-lg font-semibold tracking-tight">Finanças</div>
      <nav aria-label="Navegação principal" className="flex-1 px-3">
        <ul className="grid gap-1">
          {sidebarItems.map((item) => (
            <li key={item.href}>
              <NavLink
                href={item.href}
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
              >
                <item.icon aria-hidden className="size-4" />
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="grid gap-1 border-t p-3">
        <div className="truncate px-3 py-1 text-sm">{user}</div>
        <SignOutButton />
      </div>
    </aside>
  );
}
