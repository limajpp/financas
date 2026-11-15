"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { cn } from "@/lib/utils";

import { isActive } from "./nav-items";

type NavLinkProps = {
  href: string;
  className?: string;
  activeClassName?: string;
  children: React.ReactNode;
};

/**
 * A navigation link marked as current on its page and sub-pages. The pathname of a page with a
 * dynamic segment (an invoice, task 18) is only known at request time: there the link first
 * renders unmarked, so the rest of the layout still prerenders.
 */
export function NavLink(props: NavLinkProps) {
  return (
    <Suspense fallback={<NavAnchor {...props} active={false} />}>
      <CurrentNavLink {...props} />
    </Suspense>
  );
}

function CurrentNavLink(props: NavLinkProps) {
  return <NavAnchor {...props} active={isActive(props.href, usePathname())} />;
}

function NavAnchor({
  href,
  className,
  activeClassName,
  children,
  active,
}: NavLinkProps & { active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(className, active && activeClassName)}
    >
      {children}
    </Link>
  );
}
