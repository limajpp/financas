import { NavLink } from "./nav-link";
import { bottomItems } from "./nav-items";

export function BottomNav() {
  return (
    <nav
      aria-label="Navegação inferior"
      className="fixed inset-x-0 bottom-0 z-10 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid h-16 grid-cols-5">
        {bottomItems.map((item) => {
          const primary = item.href === "/registrar";
          return (
            <li key={item.href} className="flex">
              <NavLink
                href={item.href}
                className="flex flex-1 flex-col items-center justify-center gap-1 text-[11px] text-muted-foreground"
                activeClassName="text-foreground font-medium"
              >
                <span
                  className={
                    primary
                      ? "flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground"
                      : undefined
                  }
                >
                  <item.icon aria-hidden className="size-5" />
                </span>
                <span className={primary ? "sr-only" : undefined}>{item.label}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
