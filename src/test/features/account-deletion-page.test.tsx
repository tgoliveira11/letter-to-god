import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithTestApplicationState as render } from "@/test/helpers/application-state";
import AccountSettingsPage from "@/app/(vault)/settings/account/page";
import { ACCOUNT_DELETION_VAULT_NOTE } from "@/lib/account-auth-messages";

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({
    status: "authenticated",
    data: { user: { id: "user-1", email: "user@test.local" } },
  })),
}));

vi.mock("@tgoliveira/secure-auth/react/client", () => ({
  defaultSignOutAccount: vi.fn(async () => undefined),
}));

vi.mock("@tgoliveira/secure-auth/react", () => ({
  AccountSettingsPage: () => (
    <div>
      <p>user@test.local</p>
      <button type="button">Delete my account permanently</button>
    </div>
  ),
  SecuritySettingsPage: () => (
    <div>
      <h3>Passkeys</h3>
      <h3>Two-factor authentication</h3>
    </div>
  ),
}));

vi.mock("@/lib/crypto-client/vault", () => ({
  clearVaultClientState: vi.fn(async () => undefined),
}));

describe("account settings page wrapper", () => {
  it("groups account, security, and vault protection in compact sections", () => {
    render(<AccountSettingsPage />);
    expect(screen.getByRole("heading", { name: /account settings/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /^account$/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /^security$/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /vault protection/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /open vault settings/i })).toHaveAttribute(
      "href",
      "/vault/settings"
    );
    expect(screen.queryByText(/passkey vault unlock setup/i)).toBeNull();
  });

  it("warns that account deletion removes vault and notes near delete action", () => {
    render(<AccountSettingsPage />);
    const accountSection = screen.getByRole("heading", { name: /^account$/i }).closest("section");
    expect(accountSection?.textContent).toMatch(ACCOUNT_DELETION_VAULT_NOTE);
    expect(screen.getByRole("button", { name: /delete my account permanently/i })).toBeTruthy();
  });

  it("keeps delete account action accessible", () => {
    render(<AccountSettingsPage />);
    expect(screen.getByRole("button", { name: /delete my account permanently/i })).toBeTruthy();
  });
});
