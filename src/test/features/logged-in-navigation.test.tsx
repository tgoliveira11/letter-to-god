import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within, fireEvent } from "@testing-library/react";
import { renderWithTestApplicationState as render } from "@/test/helpers/application-state";
import { SiteShell } from "@/components/layout/site-shell";
import HomePage from "@/app/(public)/page";
import {
  isLoggedInNavLinkActive,
  LOGGED_IN_NAV_LINKS,
} from "@/lib/navigation/logged-in-nav";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/marketing/brand";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  configureSelahkeepVaultSession,
  lockVaultSession,
  resetVaultSessionStoreForTests,
} from "@/lib/crypto-client/vault-session";

vi.mock("@/features/passkey/use-vault-passkey-unlock-prefetch", () => ({
  useVaultPasskeyUnlockPrefetch: vi.fn(() => ({
    options: null,
    refresh: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock("@/features/vault/vault-dock-passkey-availability", () => ({
  useVaultDockPasskeyAvailable: vi.fn(() => ({
    hasEnvelope: false,
    showPasskey: false,
    prfExplicitlyUnsupported: false,
  })),
}));

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({ data: null, status: "unauthenticated" })),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() })),
  usePathname: vi.fn(() => "/notes"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

vi.mock("@/features/vault/use-vault-client-status", () => ({
  useVaultClientStatus: vi.fn(() => ({
    status: "ready",
    clientStatus: "locked",
    setupPhase: "complete",
    serverStatus: {
      initialized: true,
      setupPhase: "complete",
      setupComplete: true,
      vaultVersion: "vault-v2",
      ltgSetupComplete: true,
      hasVaultPassword: true,
      availableUnlockMethods: { password: true, recoveryPhrase: true, passkey: false },
    },
    recheck: vi.fn(),
  })),
}));

vi.mock("@/features/vault/use-vault", () => ({
  useVault: vi.fn(() => ({
    loading: false,
    error: null,
    unlockFromPasskey: vi.fn(),
    unlockFromRecoveryCode: vi.fn(),
    unlockFromVaultPassword: vi.fn(),
    unlockFromRecoveryPhrase: vi.fn(),
    lockVault: vi.fn(),
  })),
}));

describe("logged-in navigation", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetVaultSessionStoreForTests();
    configureSelahkeepVaultSession();
    lockVaultSession();
  });

  it("defines Notes, Vault, and Account primary links without Letters", () => {
    const labels = LOGGED_IN_NAV_LINKS.map((link) => link.label);
    expect(labels).toContain("Notes");
    expect(labels).toContain("Vault");
    expect(labels).toContain("Account");
    expect(labels.some((label) => /letter/i.test(label))).toBe(false);
    expect(LOGGED_IN_NAV_LINKS.some((link) => link.href.includes("/letters"))).toBe(false);
  });

  it("marks Notes active for note detail and new routes", () => {
    expect(isLoggedInNavLinkActive("/notes", "/notes")).toBe(true);
    expect(isLoggedInNavLinkActive("/notes/new", "/notes")).toBe(true);
    expect(isLoggedInNavLinkActive("/notes/abc", "/notes")).toBe(true);
  });

  it("marks Vault active for vault unlock and setup routes", () => {
    expect(isLoggedInNavLinkActive("/vault/settings", "/vault/settings")).toBe(true);
    expect(isLoggedInNavLinkActive("/vault/security", "/vault/settings")).toBe(true);
    expect(isLoggedInNavLinkActive("/vault/unlock", "/vault/settings")).toBe(true);
    expect(isLoggedInNavLinkActive("/vault/setup", "/vault/settings")).toBe(true);
  });

  it("places search and vault dock in the same header toolbar row on notes", async () => {
    const { useSession } = await import("next-auth/react");
    const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
    vi.mocked(useSession).mockReturnValue({
      data: { user: { id: "user-1", email: "user@example.com" } },
      status: "authenticated",
      update: vi.fn(),
    });
    vi.mocked(useVaultClientStatus).mockReturnValue({
      status: "ready",
      clientStatus: "unlocked",
      setupPhase: "complete",
      serverStatus: {
        initialized: true,
        setupPhase: "complete",
        setupComplete: true,
        vaultVersion: "vault-v2",
        ltgSetupComplete: true,
        hasVaultPassword: true,
        availableUnlockMethods: { password: true, recoveryPhrase: true, passkey: false },
      },
      recheck: vi.fn(),
    } as ReturnType<typeof useVaultClientStatus>);

    render(
      <SiteShell>
        <HomePage />
      </SiteShell>
    );

    const toolbar = screen.getByTestId("header-toolbar-row");
    expect(within(toolbar).getByTestId("header-search")).toBeTruthy();
    expect(within(toolbar).getByTestId("vault-status-dock-handle")).toBeTruthy();
  });

  it("shows primary destinations in the desktop sidebar when signed in", async () => {
    const { useSession } = await import("next-auth/react");
    vi.mocked(useSession).mockReturnValue({
      data: { user: { id: "user-1", email: "user@example.com" } },
      status: "authenticated",
      update: vi.fn(),
    });
    // The sidebar shows only when the vault is unlocked.
    const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
    vi.mocked(useVaultClientStatus).mockReturnValue({
      status: "ready",
      clientStatus: "unlocked",
      setupPhase: "complete",
      serverStatus: {
        initialized: true,
        setupPhase: "complete",
        setupComplete: true,
        vaultVersion: "vault-v2",
        ltgSetupComplete: true,
        hasVaultPassword: true,
        availableUnlockMethods: { password: true, recoveryPhrase: true, passkey: false },
      },
      recheck: vi.fn(),
    } as ReturnType<typeof useVaultClientStatus>);

    render(
      <SiteShell>
        <HomePage />
      </SiteShell>
    );

    // Primary nav lives in the desktop sidebar (md+); the header keeps the dock.
    const sidebar = screen.getByTestId("app-sidebar");
    expect(within(sidebar).getByRole("link", { name: "All notes" })).toBeTruthy();
    expect(within(sidebar).getByRole("link", { name: "Vault" })).toBeTruthy();
    expect(within(sidebar).getByRole("link", { name: "Account" })).toBeTruthy();
    expect(within(sidebar).getByRole("link", { name: /new note/i })).toBeTruthy();
    expect(within(sidebar).queryByRole("link", { name: /letters/i })).toBeNull();
  });

  it("shows vault status dock in header toolbar when signed in and locked", async () => {
    const { useSession } = await import("next-auth/react");
    const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
    vi.mocked(useSession).mockReturnValue({
      data: { user: { id: "user-1", email: "user@example.com" } },
      status: "authenticated",
      update: vi.fn(),
    });
    vi.mocked(useVaultClientStatus).mockReturnValue({
      status: "ready",
      clientStatus: "locked",
      setupPhase: "complete",
      serverStatus: {
        initialized: true,
        setupPhase: "complete",
        setupComplete: true,
        vaultVersion: "vault-v2",
        ltgSetupComplete: true,
        hasVaultPassword: true,
        availableUnlockMethods: { password: true, recoveryPhrase: true, passkey: false },
      },
      recheck: vi.fn(),
    });

    render(
      <SiteShell>
        <HomePage />
      </SiteShell>
    );

    const header = screen.getByRole("banner");
    const toolbar = within(header).getByTestId("header-toolbar-row");
    const handle = within(toolbar).getByTestId("vault-status-dock-handle");
    expect(within(header).queryByRole("link", { name: /unlock vault/i })).toBeNull();
    expect(within(handle).getByText("Vault locked")).toBeTruthy();
    // The dock also renders in the mobile header row now, so scope the click
    // to the desktop toolbar's copy.
    fireEvent.click(within(toolbar).getByRole("button", { name: /expand vault status/i }));
    const dock = within(toolbar).getByTestId("vault-status-dock");
    expect(within(dock).getByLabelText(/vault password/i)).toBeTruthy();
  });

  it("does not show vault lock controls in header when signed in", async () => {
    const { useSession } = await import("next-auth/react");
    const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
    vi.mocked(useSession).mockReturnValue({
      data: { user: { id: "user-1", email: "user@example.com" } },
      status: "authenticated",
      update: vi.fn(),
    });
    vi.mocked(useVaultClientStatus).mockReturnValue({
      status: "ready",
      clientStatus: "locked",
      setupPhase: "complete",
      serverStatus: {
        initialized: true,
        setupPhase: "complete",
        setupComplete: true,
        vaultVersion: "vault-v2",
        ltgSetupComplete: true,
        hasVaultPassword: true,
        availableUnlockMethods: { password: true, recoveryPhrase: true, passkey: false },
      },
      recheck: vi.fn(),
    });

    render(
      <SiteShell>
        <HomePage />
      </SiteShell>
    );

    const header = screen.getByRole("banner");
    expect(within(header).queryByRole("link", { name: /unlock vault/i })).toBeNull();
    expect(within(header).queryByRole("button", { name: /^lock vault$/i })).toBeNull();
    // Dock handle may show compact status copy; standalone lock/unlock controls stay out of the bar.
    // The dock renders once in the desktop toolbar and once in the mobile
    // header row, so this asserts on at least one, not a single unique match.
    expect(within(header).getAllByTestId("vault-status-dock-handle").length).toBeGreaterThan(0);
    expect(within(header).queryByText(/vault unlocked/i)).toBeNull();
    expect(within(header).queryByText(/vault not set up/i)).toBeNull();
    expect(within(header).queryByText(/setup incomplete/i)).toBeNull();
  });

  it("keeps vault dock in header toolbar when vault is unlocked", async () => {
    const { useSession } = await import("next-auth/react");
    const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
    vi.mocked(useSession).mockReturnValue({
      data: { user: { id: "user-1", email: "user@example.com" } },
      status: "authenticated",
      update: vi.fn(),
    });
    vi.mocked(useVaultClientStatus).mockReturnValue({
      status: "ready",
      clientStatus: "unlocked",
      setupPhase: "complete",
      serverStatus: {
        initialized: true,
        setupPhase: "complete",
        setupComplete: true,
        vaultVersion: "vault-v2",
        ltgSetupComplete: true,
        hasVaultPassword: true,
        availableUnlockMethods: { password: true, recoveryPhrase: true, passkey: false },
      },
      recheck: vi.fn(),
    });

    render(
      <SiteShell>
        <HomePage />
      </SiteShell>
    );

    const toolbar = screen.getByTestId("header-toolbar-row");
    expect(within(toolbar).getByTestId("vault-status-dock-handle")).toBeTruthy();
    expect(within(screen.getByRole("banner")).queryByRole("button", { name: /^lock vault$/i })).toBeNull();
  });

  it("does not show vault lock controls in header when vault is unlocked", async () => {
    const { useSession } = await import("next-auth/react");
    const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
    vi.mocked(useSession).mockReturnValue({
      data: { user: { id: "user-1", email: "user@example.com" } },
      status: "authenticated",
      update: vi.fn(),
    });
    vi.mocked(useVaultClientStatus).mockReturnValue({
      status: "ready",
      clientStatus: "unlocked",
      setupPhase: "complete",
      serverStatus: {
        initialized: true,
        setupPhase: "complete",
        setupComplete: true,
        vaultVersion: "vault-v2",
        ltgSetupComplete: true,
        hasVaultPassword: true,
        availableUnlockMethods: { password: true, recoveryPhrase: true, passkey: false },
      },
      recheck: vi.fn(),
    });

    render(
      <SiteShell>
        <HomePage />
      </SiteShell>
    );

    const header = screen.getByRole("banner");
    expect(within(header).queryByRole("button", { name: /^lock vault$/i })).toBeNull();
    expect(within(header).queryByText(/vault unlocked/i)).toBeNull();
  });

  it("mobile menu includes Notes, Vault, Account, and Sign out", async () => {
    const { useSession } = await import("next-auth/react");
    vi.mocked(useSession).mockReturnValue({
      data: { user: { id: "user-1", email: "user@example.com" } },
      status: "authenticated",
      update: vi.fn(),
    });

    render(
      <SiteShell>
        <HomePage />
      </SiteShell>
    );

    fireEvent.click(screen.getByRole("button", { name: /open menu/i }));

    const mobileNav = screen.getByRole("navigation", { name: /mobile navigation/i });
    expect(within(mobileNav).getByRole("link", { name: "Notes" })).toBeTruthy();
    expect(within(mobileNav).getByRole("link", { name: "Vault" })).toBeTruthy();
    expect(within(mobileNav).getByRole("link", { name: "Account" })).toBeTruthy();
    expect(within(mobileNav).getByRole("button", { name: /sign out/i })).toBeTruthy();
  });

  it("public navigation still offers sign in when signed out", async () => {
    const { useSession } = await import("next-auth/react");
    vi.mocked(useSession).mockReturnValue({
      data: null,
      status: "unauthenticated",
      update: vi.fn(),
    });

    render(
      <SiteShell>
        <HomePage />
      </SiteShell>
    );

    expect(screen.getAllByRole("link", { name: /sign in/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: "Notes" })).toBeNull();
  });
});

describe("SelahKeep metadata and icon", () => {
  it("layout metadata uses SelahKeep title and tagline", async () => {
    const layout = await import("@/app/layout");
    expect(layout.metadata.title).toBe(PRODUCT_NAME);
    expect(layout.metadata.description).toBe(PRODUCT_TAGLINE);
  });

  it("favicon uses purple SK monogram without green envelope colors", () => {
    const icon = readFileSync(join(process.cwd(), "src/app/icon.svg"), "utf8");
    expect(icon).toContain("#5b3a8c");
    expect(icon).toContain("SK");
    expect(icon).not.toContain("#4a6741");
    expect(icon).not.toContain("M6 11.75");
  });

  it("AppMark primitive does not use legacy green envelope palette", () => {
    const source = readFileSync(
      join(process.cwd(), "src/modules/ui/primitives/app-mark.tsx"),
      "utf8"
    );
    expect(source).toContain("BRAND_MARK_SVG");
    expect(source).not.toContain("#4a6741");
  });
});
