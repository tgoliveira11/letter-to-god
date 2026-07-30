"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppMark } from "@/components/ui/app-mark";
import { signOutAccount, signOutWithRedirect, useAfterLogoutPath } from "@/lib/auth/sign-out-client";
import { isFullyAuthenticatedSession } from "@/lib/auth/session-state";
import { useVaultClientStatus } from "@/features/vault/use-vault-client-status";
import { useApplicationState } from "@/components/application-state-provider";
import { clearVaultClientState } from "@/lib/crypto-client/vault";
import { lockVaultSession } from "@/lib/crypto-client/vault-session";
import { PRODUCT_NAME } from "@/lib/marketing/brand";
import { isKanbanEnabled } from "@/lib/notes/kanban-config";
import {
  readSidebarCollapsedPreference,
  writeSidebarCollapsedPreference,
} from "@/lib/navigation/sidebar-preference";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { SidebarAccountPopover } from "@/components/layout/sidebar-account-popover";
import { cn } from "@/lib/ui/cn";
import { VaultLockOverlayExclude } from "@/features/vault/vault-protected-shell";

/** Library destinations (filtered views of the notes list), matching the mockup. */
const LIBRARY: { href: string; view: string | null; label: string; icon: React.ReactNode }[] = [
  {
    href: "/notes",
    view: null,
    label: "All notes",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
        <path d="M8 9h7M8 13h7" />
      </svg>
    ),
  },
  {
    href: "/kanban",
    view: "kanban",
    label: "Boards",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="4" y="5" width="4" height="14" rx="1.2" />
        <rect x="10" y="5" width="4" height="14" rx="1.2" />
        <rect x="16" y="5" width="4" height="14" rx="1.2" />
      </svg>
    ),
  },
  {
    href: "/notes?view=pinned",
    view: "pinned",
    label: "Pinned",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" aria-hidden="true">
        <path d="M9 3h6l-1 6 4 3v2h-5v7l-1 0-1 0v-7H5v-2l4-3z" />
      </svg>
    ),
  },
  {
    href: "/notes?view=resolved",
    view: "resolved",
    label: "Resolved",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    ),
  },
  {
    href: "/notes?view=archived",
    view: "archived",
    label: "Archive",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" />
      </svg>
    ),
  },
];

function NavItem({
  href,
  active,
  label,
  icon,
  collapsed,
}: {
  href: string;
  active: boolean;
  label: string;
  icon: React.ReactNode;
  collapsed: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        "flex items-center rounded-lg py-2 text-[13.5px] transition-colors",
        collapsed ? "justify-center px-2" : "gap-2.5 px-2.5",
        active
          ? "bg-[var(--lilac)] font-semibold text-[var(--primary)]"
          : "text-[var(--fg-2)] hover:bg-[var(--card-2)]"
      )}
    >
      {icon}
      {!collapsed && <span>{label}</span>}
    </Link>
  );
}

/**
 * Desktop left sidebar (Stillness design system). Replaces the horizontal
 * header nav on `md+` with a full-height rail: brand, a New note CTA, the
 * Library (All notes / Pinned / Resolved / Archive — deep-linked filtered
 * views), and an account footer (Account, Vault, sign out). Authenticated-only
 * and hidden on small screens. See `docs/design/`.
 */
export function AppSidebar() {
  const { session } = useApplicationState();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const vaultClient = useVaultClientStatus();
  const afterLogoutPath = useAfterLogoutPath();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(readSidebarCollapsedPreference());
  }, []);

  if (!isFullyAuthenticatedSession(session)) return null;
  const unlocked = vaultClient.status === "ready" && vaultClient.clientStatus === "unlocked";

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      writeSidebarCollapsedPreference(next);
      return next;
    });
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
    signOutWithRedirect(afterLogoutPath);
  }

  const onNotes = pathname === "/notes";
  const view = searchParams.get("view");
  const initial = (session?.user?.email ?? "?").charAt(0).toUpperCase();

  return (
    <VaultLockOverlayExclude className="hidden md:block md:flex-none">
      <aside
        data-testid="app-sidebar"
        data-collapsed={collapsed ? "true" : "false"}
        className={cn(
          "sticky top-0 flex h-screen flex-col border-r border-[var(--border)] bg-[var(--card)] py-5 transition-[width] duration-200",
          collapsed ? "w-[4.5rem] px-2" : "w-[248px] px-4"
        )}
      >
        <div
          className={cn(
            "mb-[18px] flex items-center",
            collapsed ? "justify-center" : "justify-between gap-2 px-2"
          )}
        >
          <Link
            href="/home"
            className={cn(
              "flex items-center font-semibold tracking-[0.01em] text-[var(--primary)]",
              collapsed ? "justify-center" : "gap-2 text-[17px]"
            )}
            title={collapsed ? PRODUCT_NAME : undefined}
          >
            <AppMark size={28} />
            {!collapsed && <span>{PRODUCT_NAME}</span>}
          </Link>
          {!collapsed && (
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label="Collapse sidebar"
              className="rounded-lg p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--card-2)] hover:text-[var(--foreground)]"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M15 18 9 12l6-6" />
              </svg>
            </button>
          )}
        </div>

        {collapsed && (
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="Expand sidebar"
            className="mb-3 flex justify-center rounded-lg p-2 text-[var(--muted)] transition-colors hover:bg-[var(--card-2)] hover:text-[var(--foreground)]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        )}

        {unlocked && (
          <Link
            href="/notes/new"
            title={collapsed ? "New note" : undefined}
            className={cn(
              "mb-[18px] flex items-center rounded-[9px] bg-[var(--primary-solid)] text-sm font-semibold text-[var(--on-primary)]",
              collapsed ? "justify-center px-2 py-2.5" : "gap-2 px-3 py-2.5"
            )}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {!collapsed && "New note"}
          </Link>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {unlocked && !collapsed && (
            <p className="px-2 pb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
              Library
            </p>
          )}
          <nav aria-label="Library" className="flex flex-col gap-0.5">
            {unlocked &&
              LIBRARY.filter((item) => item.href !== "/kanban" || isKanbanEnabled()).map((item) => {
                const active =
                  item.href === "/kanban"
                    ? pathname.startsWith("/kanban")
                    : onNotes && (item.view ? view === item.view : !view);
                return (
                  <NavItem
                    key={item.label}
                    href={item.href}
                    active={active}
                    label={item.label}
                    icon={item.icon}
                    collapsed={collapsed}
                  />
                );
              })}
            {unlocked && (
              <NavItem
                href="/vault/settings"
                active={pathname.startsWith("/vault")}
                label="Vault"
                collapsed={collapsed}
                icon={
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="4" y="10" width="16" height="11" rx="2.4" />
                    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                  </svg>
                }
              />
            )}
            <NavItem
              href="/settings/account"
              active={pathname.startsWith("/settings")}
              label="Account"
              collapsed={collapsed}
              icon={
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
                </svg>
              }
            />
          </nav>
        </div>

        {!collapsed && (
          <div className="flex items-center justify-between pt-4">
            <span className="text-[11px] font-medium text-[var(--muted)]">Theme</span>
            <ThemeToggle />
          </div>
        )}

        <div
          className={cn(
            "mt-3 flex items-center border-t border-[var(--border)] pt-3",
            collapsed ? "justify-center" : "gap-2.5"
          )}
        >
          {collapsed ? (
            <SidebarAccountPopover
              email={session?.user?.email ?? "Account"}
              initial={initial}
              onSignOut={handleSignOut}
            >
              <span
                className="flex h-[30px] w-[30px] flex-none cursor-default items-center justify-center rounded-full bg-[linear-gradient(150deg,var(--accent),var(--primary-solid))] text-xs font-semibold text-white"
                data-testid="sidebar-account-avatar"
              >
                {initial}
              </span>
            </SidebarAccountPopover>
          ) : (
            <>
              <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-[linear-gradient(150deg,var(--accent),var(--primary-solid))] text-xs font-semibold text-white">
                {initial}
              </span>
              <div className="min-w-0 flex-1 text-[12.5px]">
                <div className="truncate font-medium text-[var(--fg-2)]">
                  {session?.user?.email ?? "Account"}
                </div>
                <div className="text-[11px] text-[var(--muted)]">Signed in</div>
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                aria-label="Sign out"
                className="flex-none rounded-lg p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--card-2)] hover:text-[var(--foreground)]"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
              </button>
            </>
          )}
        </div>
      </aside>
    </VaultLockOverlayExclude>
  );
}
