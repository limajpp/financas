import {
  CreditCard,
  House,
  LayoutDashboard,
  type LucideIcon,
  Plus,
  ReceiptText,
  Repeat,
  Settings,
  Store,
  Wallet,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };

export const sidebarItems: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/lancamentos", label: "Lançamentos", icon: ReceiptText },
  { href: "/faturas", label: "Faturas", icon: CreditCard },
  { href: "/assinaturas", label: "Assinaturas", icon: Repeat },
  { href: "/estabelecimentos", label: "Estabelecimentos", icon: Store },
  { href: "/contas", label: "Contas", icon: Wallet },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];

export const bottomItems: NavItem[] = [
  { href: "/", label: "Início", icon: House },
  { href: "/lancamentos", label: "Lançamentos", icon: ReceiptText },
  { href: "/registrar", label: "Registrar", icon: Plus },
  { href: "/contas", label: "Contas", icon: Wallet },
  { href: "/configuracoes", label: "Ajustes", icon: Settings },
];

/** "/" matches only itself; other items also match their sub-pages. */
export function isActive(href: string, pathname: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
