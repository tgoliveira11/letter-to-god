import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithTestApplicationState as render } from "@/test/helpers/application-state";
import { SecureAuthUIProvider } from "@tgoliveira/secure-auth/react";
import LoginPage from "@/app/(auth)/login/page";
import RegisterPage from "@/app/(auth)/register/page";
import ForgotPasswordPage from "@/app/(auth)/forgot-password/page";
import { SiteShell } from "@/components/layout/site-shell";
import { SECURE_AUTH_ATTRIBUTION_URL } from "@/components/layout/site-footer";
import { authPageMessages } from "@/lib/auth/auth-page-messages";
import { testSecureAuthUiConfig } from "@/test/helpers/secure-auth-ui-config";

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({ data: null, status: "unauthenticated" })),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() })),
  usePathname: vi.fn(() => "/login"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

vi.mock("@tgoliveira/secure-auth/react/client", () => ({
  signInWithPasskey: vi.fn(),
  isPasskeyLoginSupported: vi.fn(() => false),
  getPasskeyLoginUnsupportedMessage: () => "This browser does not support passkey sign-in.",
}));

function withSecureAuthUi(children: React.ReactNode) {
  return <SecureAuthUIProvider config={testSecureAuthUiConfig}>{children}</SecureAuthUIProvider>;
}

describe("auth page copy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("login page shows welcome back and account-focused subtitle", () => {
    render(withSecureAuthUi(<LoginPage />));
    expect(screen.getByRole("heading", { name: authPageMessages.loginTitle })).toBeTruthy();
    expect(screen.getByText(authPageMessages.loginDescription)).toBeTruthy();
  });

  it("login page does not show letter-editor privacy disclaimer", () => {
    render(withSecureAuthUi(<LoginPage />));
    expect(screen.queryByText(/your letter is protected on this device before it is saved/i)).toBeNull();
    expect(screen.queryByText(/protected on this device/i)).toBeNull();
  });

  it("register page uses product register copy without device privacy disclaimer", () => {
    render(withSecureAuthUi(<RegisterPage />));
    expect(screen.getByRole("heading", { name: authPageMessages.registerTitle })).toBeTruthy();
    expect(screen.getByText(authPageMessages.registerDescription)).toBeTruthy();
    expect(screen.queryByText(/protected on this device/i)).toBeNull();
  });

  it("forgot password page uses reset-focused copy", () => {
    render(withSecureAuthUi(<ForgotPasswordPage />));
    expect(screen.getByRole("heading", { name: authPageMessages.forgotPasswordTitle })).toBeTruthy();
    expect(screen.getByText(authPageMessages.forgotPasswordDescription)).toBeTruthy();
    expect(screen.queryByText(/your letter is protected/i)).toBeNull();
  });

  it("register page uses updated product description copy", () => {
    render(withSecureAuthUi(<RegisterPage />));
    expect(screen.getByText("Start writing private notes in a protected space.")).toBeTruthy();
  });

  it("login page inside site shell still renders header and footer attribution", () => {
    render(
      <SiteShell>
        {withSecureAuthUi(<LoginPage />)}
      </SiteShell>
    );

    expect(screen.getByRole("banner")).toBeTruthy();
    const link = screen.getByRole("link", { name: /powered by @tgoliveira\/secure-auth/i });
    expect(link.getAttribute("href")).toBe(SECURE_AUTH_ATTRIBUTION_URL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });
});
