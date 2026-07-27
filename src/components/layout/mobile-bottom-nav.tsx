"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isFullyAuthenticatedSession } from "@/lib/auth/session-state";
import {
  getLoggedInNavLinks,
  isLoggedInNavLinkActive,
} from "@/lib/navigation/logged-in-nav";
import { cn } from "@/lib/ui/cn";
import { VaultLockOverlayExclude } from "@/features/vault/vault-protected-shell";
import { useApplicationState } from "@/components/application-state-provider";

/** SVG glyphs for the three primary destinations, matching the design mockup. */
const NAV_ICONS: Record<string, React.ReactNode> = {
  "/notes": (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
      <path d="M8 9h7M8 13h7M8 17h4" />
    </svg>
  ),
  "/kanban": (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="5" width="4" height="14" rx="1.2" />
      <rect x="10" y="5" width="4" height="14" rx="1.2" />
      <rect x="16" y="5" width="4" height="14" rx="1.2" />
      <path d="M5.5 9h1M11.5 13h1M17.5 8h1" />
    </svg>
  ),
  "/vault/settings": (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="10" width="16" height="11" rx="2.4" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  ),
  "/settings/account": (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  ),
};

/**
 * Mobile-only bottom navigation (Stillness design system). Shows the three
 * primary destinations — Notes, Vault, Account — as a fixed tab bar on small
 * screens. Hidden on `md+` (the header nav / desktop sidebar takes over) and
 * only rendered for fully authenticated sessions.
 * See `docs/design/SelahKeep-hero-screens.dc.html` (bottom nav).
 */
export function MobileBottomNav() {
  const { session } = useApplicationState();
  const pathname = usePathname();

  if (!isFullyAuthenticatedSession(session)) return null;

  return (
    <VaultLockOverlayExclude>
    <nav
      aria-label="Primary"
      data-testid="mobile-bottom-nav"
      className="fixed inset-x-0 bottom-0 z-40 flex h-[72px] items-start justify-around border-t border-[var(--border)] bg-[var(--card)] px-6 pt-[11px] md:hidden"
    >
      {getLoggedInNavLinks().map((link) => {
        const active = isLoggedInNavLinkActive(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-col items-center gap-1 transition-colors",
              active ? "text-[var(--primary)]" : "text-[var(--muted)]"
            )}
          >
            {NAV_ICONS[link.href]}
            <span className={cn("text-[11px]", active ? "font-semibold" : "font-medium")}>
              {link.label}
            </span>
          </Link>
        );
      })}
    </nav>
    </VaultLockOverlayExclude>
  );
}
