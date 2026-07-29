import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccountPasskeySecuritySettings } from "@/features/passkey/account-passkey-security-settings";
import { USER_ID } from "@/test/helpers/fixtures";

const securitySettingsPage = vi.fn(() => <div>Account passkey settings</div>);

vi.mock("@tgoliveira/secure-auth/react", () => ({
  SecuritySettingsPage: (props: unknown) => securitySettingsPage(props),
}));

describe("AccountPasskeySecuritySettings", () => {
  it("delegates account passkeys without vault registration hooks", () => {
    render(<AccountPasskeySecuritySettings userId={USER_ID} />);

    expect(screen.getByText("Account passkey settings")).toBeTruthy();
    expect(securitySettingsPage).toHaveBeenCalledWith({});
  });
});
