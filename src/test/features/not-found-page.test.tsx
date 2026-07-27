import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithTestApplicationState as render } from "@/test/helpers/application-state";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import NotFound from "@/app/not-found";
import NoteRouteNotFound from "@/app/(vault)/notes/[id]/not-found";
import { AppNotFoundPage, NoteNotFoundPanel } from "@/components/layout/app-not-found";
import { NotFoundState } from "@/components/ui/not-found-state";
import { SiteShell } from "@/components/layout/site-shell";
import { SecureAuthUIProvider } from "@tgoliveira/secure-auth/react";
import { testSecureAuthUiConfig } from "@/test/helpers/secure-auth-ui-config";
import { PRODUCT_NAME } from "@/lib/marketing/brand";

const useSession = vi.fn(() => ({ data: null, status: "unauthenticated" }));

vi.mock("next-auth/react", () => ({
  useSession: (...args: unknown[]) => useSession(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() })),
  usePathname: vi.fn(() => "/missing-page"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

vi.mock("@/features/vault/use-vault-session-unlocked", () => ({
  useVaultSessionUnlocked: vi.fn(() => false),
}));

function withProviders(children: React.ReactNode) {
  return (
    <SecureAuthUIProvider config={testSecureAuthUiConfig}>{children}</SecureAuthUIProvider>
  );
}

describe("NotFoundState", () => {
  it("renders calm page-not-found copy", () => {
    render(<NotFoundState variant="page" actions={<span>Actions</span>} />);
    expect(screen.getByTestId("not-found-state")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /page not found/i })).toBeTruthy();
    expect(screen.getByText(/your vault and private notes are safe/i)).toBeTruthy();
    expect(screen.getByText("404")).toBeTruthy();
    expect(screen.queryByText(/stack trace/i)).toBeNull();
  });

  it("renders note-not-found copy without private metadata", () => {
    render(<NotFoundState variant="note" />);
    expect(screen.getByRole("heading", { name: /note not found/i })).toBeTruthy();
    expect(screen.getByText(/may not exist in this vault/i)).toBeTruthy();
    expect(screen.queryByText(/SENTINEL/i)).toBeNull();
  });
});

describe("global not-found page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSession.mockReturnValue({ data: null, status: "unauthenticated" });
  });

  it("renders custom SelahKeep not-found via app route", () => {
    render(withProviders(<NotFound />));
    expect(screen.getByRole("heading", { name: /page not found/i })).toBeTruthy();
    const notFound = screen.getByTestId("not-found-state");
    expect(within(notFound).getByRole("link", { name: /go home/i })).toBeTruthy();
    expect(within(notFound).getByRole("link", { name: /sign in/i })).toBeTruthy();
    expect(screen.queryByText(/Something went wrong/i)).toBeNull();
  });

  it("shows product name in header", () => {
    render(withProviders(<NotFound />));
    expect(screen.getByRole("link", { name: new RegExp(PRODUCT_NAME, "i") })).toBeTruthy();
  });

  it("signed-out 404 does not show vault status dock", () => {
    render(withProviders(<NotFound />));
    expect(screen.queryByTestId("vault-status-dock-handle")).toBeNull();
    expect(screen.queryByTestId("vault-status-dock")).toBeNull();
  });

  it("signed-out 404 does not show authenticated nav links", () => {
    render(withProviders(<NotFound />));
    expect(screen.queryByRole("link", { name: /^notes$/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /^vault$/i })).toBeNull();
  });

  it("signed-in 404 offers Go to notes", () => {
    useSession.mockReturnValue({
      data: { user: { id: "u1" }, twoFactorPending: false, twoFactorVerified: true },
      status: "authenticated",
    });
    render(withProviders(<AppNotFoundPage />));
    expect(screen.getByRole("link", { name: /go to notes/i }).getAttribute("href")).toBe("/notes");
    expect(screen.getByRole("link", { name: /go home/i }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: /open vault settings/i }).getAttribute("href")).toBe(
      "/vault/settings"
    );
  });

  it("pending 2FA is not treated as fully authenticated", () => {
    useSession.mockReturnValue({
      data: { user: { id: "u1" }, twoFactorPending: true, twoFactorVerified: false },
      status: "authenticated",
    });
    render(withProviders(<AppNotFoundPage />));
    expect(screen.getByRole("link", { name: /go home/i })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /go to notes/i })).toBeNull();
    expect(screen.queryByTestId("vault-status-dock-handle")).toBeNull();
  });
});

describe("note route not-found", () => {
  beforeEach(() => {
    useSession.mockReturnValue({
      data: { user: { id: "u1" }, twoFactorPending: false, twoFactorVerified: true },
      status: "authenticated",
    });
  });

  it("renders safe note-not-found state", () => {
    render(
      withProviders(
        <SiteShell>
          <NoteRouteNotFound />
        </SiteShell>
      )
    );
    expect(screen.getByRole("heading", { name: /note not found/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /back to notes/i }).getAttribute("href")).toBe("/notes");
  });

  it("note panel does not expose private metadata", () => {
    render(withProviders(<NoteNotFoundPanel />));
    expect(screen.queryByText(/encrypted/i)).toBeNull();
    expect(screen.queryByText(/decrypt/i)).toBeNull();
  });
});

describe("not-found branding guard", () => {
  it("not-found source avoids outdated product copy", () => {
    const files = [
      "src/modules/ui/components/not-found-state.tsx",
      "src/components/layout/app-not-found.tsx",
      "src/app/not-found.tsx",
    ];
    const forbidden = [
      /LTG\s+Vault/i,
      /Letters\s+to\s+God/i,
      /private\s+letters/i,
      /Trusted\s+Devices/i,
    ];
    for (const file of files) {
      const content = readFileSync(resolve(process.cwd(), file), "utf8");
      for (const pattern of forbidden) {
        expect(content).not.toMatch(pattern);
      }
    }
  });
});

describe("not-found security regression", () => {
  beforeEach(() => {
    useSession.mockReturnValue({ data: null, status: "unauthenticated" });
  });

  it("does not render private note content placeholders", () => {
    render(withProviders(<NotFound />));
    const state = screen.getByTestId("not-found-state");
    expect(within(state).queryByText(/body/i)).toBeNull();
    expect(within(state).queryByText(/category/i)).toBeNull();
  });
});
