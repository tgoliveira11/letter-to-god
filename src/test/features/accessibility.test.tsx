import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithTestApplicationState as render } from "@/test/helpers/application-state";
import { axe } from "jest-axe";
import { SecureAuthUIProvider } from "@tgoliveira/secure-auth/react";
import HomePage from "@/app/(public)/page";
import LoginPage from "@/app/(auth)/login/page";
import RegisterPage from "@/app/(auth)/register/page";
import AccountDeletedPage from "@/app/(public)/account-deleted/page";
import { SkipLink } from "@/components/layout/skip-link";
import { SiteShell } from "@/components/layout/site-shell";
import { MAIN_CONTENT_ID } from "@/lib/ui/main-content";
import { testSecureAuthUiConfig } from "@/test/helpers/secure-auth-ui-config";

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({ data: null, status: "unauthenticated" })),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() })),
  usePathname: vi.fn(() => "/"),
  useParams: vi.fn(() => ({})),
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

describe("accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("landing page has no obvious axe violations", async () => {
    const { container } = render(
      <SiteShell>
        <HomePage />
      </SiteShell>
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("login page has no obvious axe violations", async () => {
    const { container } = render(withSecureAuthUi(<LoginPage />));
    expect(await axe(container)).toHaveNoViolations();
  });

  it("register page has no obvious axe violations", async () => {
    const { container } = render(withSecureAuthUi(<RegisterPage />));
    expect(await axe(container)).toHaveNoViolations();
  });

  it("account deleted page has no obvious axe violations", async () => {
    const { container } = render(<AccountDeletedPage />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("renders a skip link targeting main content", () => {
    render(<SkipLink />);
    const link = document.querySelector(".skip-link");
    expect(link?.getAttribute("href")).toBe(`#${MAIN_CONTENT_ID}`);
    expect(link?.textContent).toMatch(/skip to content/i);
  });
});
