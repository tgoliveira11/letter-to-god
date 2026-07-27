"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAccount, signOutWithRedirect } from "@/lib/auth/sign-out-client";
import { isFullyAuthenticatedSession } from "@/lib/auth/session-state";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { AppMark } from "@/components/ui/app-mark";
import { clearVaultClientState } from "@/lib/crypto-client/vault";
import { lockVaultSession } from "@/lib/crypto-client/vault-session";
import {
  getLoggedInNavLinks,
  isLoggedInNavLinkActive,
} from "@/lib/navigation/logged-in-nav";
import { cn } from "@/lib/ui/cn";
import { PRODUCT_NAME } from "@/lib/marketing/brand";
import { VaultStatusDock } from "@/features/vault/vault-status-dock";
import { HeaderSearch } from "@/components/layout/header-search";
import { useApplicationState } from "@/components/application-state-provider";

export function Nav() {
  const { session } = useApplicationState();
  const authenticated = isFullyAuthenticatedSession(session);
  const pathname = usePathname();
  const menuId = useId();
  const [menuOpen, setMenuOpen] = useState(false);

  function closeMenu() {
    setMenuOpen(false);
  }

  async function handleSignOut() {
    const userId = session?.user?.id;
    if (userId) {
      try {
        lockVaultSession();
        await clearVaultClientState(userId);
      } catch {
        // Continue sign-out even if local cleanup fails.
      }
    }
    await signOutAccount();
    signOutWithRedirect("/");
  }

  return (
    <header
      className={cn(
        // Authenticated: the top bar (search + vault dock) with a divider below,
        // matching the mockup. Solid background so content scrolls cleanly under
        // the sticky header. Logged-out marketing keeps its card header.
        authenticated
          ? "authenticated-header border-b border-[var(--border)] bg-[var(--background)]"
          : "bg-[var(--card)] border-b border-[var(--border)]"
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-3 px-4",
          authenticated ? "h-16 md:px-6 lg:px-8" : "mx-auto max-w-4xl py-3"
        )}
      >
        <Link
          href={authenticated ? "/notes" : "/"}
          className={cn(
            "flex items-center gap-2 text-lg font-semibold text-[var(--primary)]",
            // On desktop the sidebar carries the brand for authenticated users.
            authenticated && "md:hidden"
          )}
        >
          <AppMark size={28} />
          <span>{PRODUCT_NAME}</span>
        </Link>

        {/* Desktop: search (left) and vault dock (right) share one toolbar row. */}
        {authenticated ? (
          <div
            className="hidden min-w-0 flex-1 items-center gap-3 md:flex"
            data-testid="header-toolbar-row"
          >
            <div className="min-w-0 flex-1">
              <HeaderSearch />
            </div>
            <div className="vc-status-dock-host shrink-0">
              <VaultStatusDock />
            </div>
          </div>
        ) : null}

        {authenticated ? (
          <div className="flex items-center gap-2 md:hidden">
            {/* Mobile: the desktop toolbar row above is hidden here, so the
                vault dock gets its own compact spot next to the menu button. */}
            <div className="vc-status-dock-host shrink-0">
              <VaultStatusDock />
            </div>
            {/* Primary nav + sign out live in the desktop sidebar (md+); on
                mobile they are in the menu below. */}
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-[var(--radius)] border border-[var(--border)] px-3 text-sm font-medium"
              aria-expanded={menuOpen}
              aria-controls={menuId}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              onClick={() => setMenuOpen((open) => !open)}
            >
              Menu
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Link
              href="/register"
              className="hidden text-sm text-[var(--muted)] hover:text-[var(--foreground)] sm:inline"
            >
              Create account
            </Link>
            <Link href="/login">
              <Button variant="secondary">Sign in</Button>
            </Link>
          </div>
        )}
      </div>

      {authenticated && menuOpen && (
        <nav
          id={menuId}
          aria-label="Mobile navigation"
          className="border-t border-[var(--border)] bg-[var(--card)] px-4 py-3 md:hidden"
        >
          <p className="px-3 pb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
            Workspace
          </p>
          <ul className="space-y-1">
            {getLoggedInNavLinks().filter((link) => link.group === "core").map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={closeMenu}
                  className={cn(
                    "block rounded-[var(--radius)] px-3 py-3 text-sm",
                    isLoggedInNavLinkActive(pathname, link.href)
                      ? "bg-[var(--card-muted)] font-medium text-[var(--primary)]"
                      : ""
                  )}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>

          <p className="mt-4 px-3 pb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
            Vault protection
          </p>
          <ul className="space-y-1">
            {getLoggedInNavLinks().filter((link) => link.group === "vault").map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={closeMenu}
                  className={cn(
                    "block rounded-[var(--radius)] px-3 py-3 text-sm",
                    isLoggedInNavLinkActive(pathname, link.href)
                      ? "bg-[var(--card-muted)] font-medium text-[var(--primary)]"
                      : ""
                  )}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>

          <p className="mt-4 px-3 pb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
            Account security
          </p>
          <ul className="space-y-1">
            {getLoggedInNavLinks().filter((link) => link.group === "account").map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={closeMenu}
                  className={cn(
                    "block rounded-[var(--radius)] px-3 py-3 text-sm",
                    isLoggedInNavLinkActive(pathname, link.href)
                      ? "bg-[var(--card-muted)] font-medium text-[var(--primary)]"
                      : ""
                  )}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="mt-4 border-t border-[var(--border)] pt-4">
            <Button variant="secondary" className="w-full" onClick={handleSignOut}>
              Sign out
            </Button>
          </div>
        </nav>
      )}
    </header>
  );
}
