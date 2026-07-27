import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithTestApplicationState as render } from "@/test/helpers/application-state";
import { SecureAuthUIProvider } from "@tgoliveira/secure-auth/react";
import { LoginTwoFactorPage } from "@tgoliveira/secure-auth/react";
import { SiteShell } from "@/components/layout/site-shell";
import { OAuthTwoFactorChallenge } from "@/features/auth/oauth-two-factor-challenge";
import { testSecureAuthUiConfig } from "@/test/helpers/secure-auth-ui-config";

const mockUpdate = vi.fn();
const mockReplace = vi.fn();
const mockGetSession = vi.fn();
const mockVerifyOAuthTwoFactor = vi.fn();
const mockAssign = vi.fn();

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({
    data: {
      user: { id: "user-1", email: "user@example.com" },
      twoFactorPending: true,
      twoFactorVerified: false,
    },
    status: "authenticated",
    update: mockUpdate,
  })),
  getSession: (...args: unknown[]) => mockGetSession(...args),
  signIn: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: mockReplace, back: vi.fn() })),
  useSearchParams: vi.fn(() => new URLSearchParams("mode=oauth")),
  usePathname: vi.fn(() => "/login/2fa"),
}));

vi.mock("@tgoliveira/secure-auth/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tgoliveira/secure-auth/client")>();
  return {
    ...actual,
    authLoginApi: {
      verifyOAuthTwoFactor: (...args: unknown[]) => mockVerifyOAuthTwoFactor(...args),
    },
  };
});

vi.mock("@/features/vault/use-vault-session-unlocked", () => ({
  useVaultSessionUnlocked: vi.fn(() => false),
}));

function renderTwoFactorPage(search = "mode=credentials") {
  return render(
    <SecureAuthUIProvider config={testSecureAuthUiConfig}>
      <SiteShell>
        <LoginTwoFactorPage initialUsernameEmail="user@example.com" />
      </SiteShell>
    </SecureAuthUIProvider>
  );
}

describe("two-factor challenge page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockResolvedValue(undefined);
    mockGetSession.mockResolvedValue({
      user: { id: "user-1" },
      twoFactorPending: false,
      twoFactorVerified: true,
    });
    mockVerifyOAuthTwoFactor.mockResolvedValue({ upgradeToken: "upgrade-token" });
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { hash: "", assign: mockAssign },
    });
  });

  it("does not render logged-in nav when 2FA is pending", async () => {
    renderTwoFactorPage();
    await screen.findByRole("heading", { name: /two-factor verification/i });
    expect(screen.queryByRole("link", { name: /^notes$/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /^vault$/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /^account$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /sign out/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /expand vault status/i })).toBeNull();
    expect(screen.getAllByRole("link", { name: /sign in/i }).length).toBeGreaterThan(0);
  });

  it("renders credentials form with mobile-friendly TOTP input attributes", async () => {
    const { useSearchParams } = await import("next/navigation");
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams("mode=credentials") as ReturnType<typeof useSearchParams>
    );

    renderTwoFactorPage("mode=credentials");
    await screen.findByRole("heading", { name: /two-factor verification/i });

    const codeInput = screen.getByLabelText("Authenticator code");
    expect(codeInput.getAttribute("inputMode")).toBe("numeric");
    expect(codeInput.getAttribute("autoComplete")).toBe("one-time-code");
    expect(screen.getByRole("button", { name: /continue/i })).toBeTruthy();
  });

  it("posts credentials form to the 2FA page route", async () => {
    const { useSearchParams } = await import("next/navigation");
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams("mode=credentials") as ReturnType<typeof useSearchParams>
    );

    renderTwoFactorPage("mode=credentials");
    await screen.findByRole("heading", { name: /two-factor verification/i });
    const form = screen.getByLabelText("Authenticator code").closest("form");
    expect(form?.getAttribute("action")).toBe("/login/2fa");
    expect(form?.getAttribute("method")).toBe("post");
  });

  it("renders oauth form with mobile-friendly TOTP input attributes", async () => {
    const { useSearchParams } = await import("next/navigation");
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams("mode=oauth") as ReturnType<typeof useSearchParams>
    );

    renderTwoFactorPage("mode=oauth");
    await screen.findByRole("heading", { name: /two-factor verification/i });

    const codeInput = screen.getByLabelText("Authenticator code");
    expect(codeInput.getAttribute("inputMode")).toBe("numeric");
    expect(codeInput.getAttribute("autoComplete")).toBe("one-time-code");
  });
});

describe("OAuthTwoFactorChallenge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockResolvedValue(undefined);
    mockGetSession.mockResolvedValue({
      user: { id: "user-1" },
      twoFactorPending: false,
      twoFactorVerified: true,
    });
    mockVerifyOAuthTwoFactor.mockResolvedValue({ upgradeToken: "upgrade-token" });
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { hash: "", assign: mockAssign },
    });
  });

  it("normalizes spaced TOTP codes before verification", async () => {
    render(<OAuthTwoFactorChallenge afterLoginPath="/notes" />);

    fireEvent.change(screen.getByLabelText("Authenticator code"), {
      target: { value: "123 456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify and continue/i }));

    await waitFor(() => {
      expect(mockVerifyOAuthTwoFactor).toHaveBeenCalledWith({ code: "123456" });
    });
  });

  it("redirects to safe callback after session refresh", async () => {
    render(<OAuthTwoFactorChallenge afterLoginPath="/vault/settings" />);

    fireEvent.change(screen.getByLabelText("Authenticator code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify and continue/i }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith({ twoFactorUpgradeToken: "upgrade-token" });
      expect(mockReplace).toHaveBeenCalledWith("/vault/settings");
    });
    expect(mockAssign).not.toHaveBeenCalled();
  });

  it("falls back to hard navigation when session refresh times out", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1" },
      twoFactorPending: true,
      twoFactorVerified: false,
    });

    render(<OAuthTwoFactorChallenge afterLoginPath="/notes" sessionRefreshTimeoutMs={0} />);

    fireEvent.change(screen.getByLabelText("Authenticator code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify and continue/i }));

    await waitFor(() => {
      expect(mockAssign).toHaveBeenCalledWith("/notes");
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("shows generic error without logging the submitted code", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockVerifyOAuthTwoFactor.mockRejectedValue(new Error("invalid"));

    render(<OAuthTwoFactorChallenge afterLoginPath="/notes" />);

    fireEvent.change(screen.getByLabelText("Authenticator code"), {
      target: { value: "654321" },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify and continue/i }));

    expect(
      await screen.findByRole("alert")
    ).toHaveTextContent(/that code did not work/i);

    for (const call of consoleSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("654321");
    }
    consoleSpy.mockRestore();
  });

  it("shows verifying label while submitting", async () => {
    mockVerifyOAuthTwoFactor.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ upgradeToken: "t" }), 50))
    );

    render(<OAuthTwoFactorChallenge afterLoginPath="/notes" />);
    fireEvent.change(screen.getByLabelText("Authenticator code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify and continue/i }));

    expect(screen.getByRole("button", { name: /verifying/i })).toBeTruthy();
  });
});
