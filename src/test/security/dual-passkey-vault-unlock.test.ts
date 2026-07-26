import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

describe("dual passkey vault unlock credential filtering", () => {
  it("server scopes vault unlock options via device binding when cookie present", () => {
    const source = readSource("src/server/services/passkey-service.ts");
    expect(source).toContain('purpose === "vault_unlock"');
    expect(source).toContain("credential.vaultUnlockEnabled");
    expect(source).toContain("buildVaultUnlockAuthenticationOptions");
    expect(source).toContain("deviceBindingId");
    expect(source).toContain("vaultPasskeyDeviceBindingRepository");
    expect(source).toContain("requestedCredentialId");
    expect(source).toContain("selectedEnvelopeVariantId");
    expect(source).not.toContain("passkeyPrfAuthExtensions");
    expect(source).toContain("PASSKEY_VAULT_UNLOCK_NOT_CONFIGURED_MESSAGE");
    expect(source).toContain("PASSKEY_ACCOUNT_ONLY_FOR_SIGN_IN_MESSAGE");
  });

  it("client unlock uses vault_unlock purpose via shared helper", () => {
    const unlock = readSource("src/features/passkey/unlock-with-passkey.ts");
    const helper = readSource("src/lib/passkey/vault-unlock-authenticate.ts");
    expect(unlock).toContain("runVaultUnlockAuthenticationCeremony");
    expect(unlock).toContain("verifyVaultUnlockAuthentication");
    expect(helper).toContain('purpose: VAULT_UNLOCK_AUTHENTICATE_PURPOSE');
    expect(helper).not.toMatch(/allowCredentials.*account/i);
  });

  it("settings test and unlock share vault unlock authenticate helper", () => {
    const setup = readSource("src/features/passkey/passkey-vault-unlock-setup.tsx");
    const unlock = readSource("src/features/passkey/unlock-with-passkey.ts");
    expect(setup).toContain("runVaultUnlockAuthenticationCeremony");
    expect(unlock).toContain("runVaultUnlockAuthenticationCeremony");
  });

  it("vault unlock does not send PRF output to server", () => {
    const unlock = readSource("src/features/passkey/unlock-with-passkey.ts");
    expect(unlock).not.toMatch(/prfOutput.*apiClient\.post/s);
    expect(unlock).toMatch(/verifyVaultUnlockAuthentication\(assertion\)/);
  });

  it("vault unlock verify rejects null envelope for vault_unlock purpose", () => {
    const source = readSource("src/server/services/passkey-service.ts");
    expect(source).toMatch(
      /purpose === "vault_unlock"[\s\S]*PASSKEY_NOT_LINKED_TO_VAULT_UNLOCK_MESSAGE/
    );
  });

  it("vault-core credential selection preserves server transports", () => {
    const helper = readSource("src/lib/passkey/vault-unlock-authenticate.ts");
    expect(helper).toContain("credentialSelection");
    expect(helper).toContain('transportPolicy: "preserve"');
    expect(helper).not.toContain('transports: ["internal"]');
    expect(helper).toContain("PASSKEY_NOT_AVAILABLE_FOR_VAULT_UNLOCK_MESSAGE");
  });

  it("server replays stored transports in allowCredentials", () => {
    const source = readSource("src/server/services/passkey-service.ts");
    expect(source).toContain("toAllowCredentialDescriptor");
  });

  it("vault-only registration prefers platform authenticator", () => {
    const source = readSource("src/server/services/passkey-service.ts");
    expect(source).toContain('authenticatorAttachment: "platform"');
    expect(source).toContain("vaultRegistrationExcludeCredentials");
  });

  it("vault-only disable revokes credential when signInEnabled is false", () => {
    const source = readSource("src/server/services/passkey-vault-envelope-service.ts");
    expect(source).toMatch(/!credential\.signInEnabled[\s\S]*passkeyRepository\.revoke/);
  });

  it("dual-purpose disable keeps sign-in credential", () => {
    const source = readSource("src/server/services/passkey-vault-envelope-service.ts");
    expect(source).toMatch(/credential\.signInEnabled[\s\S]*updateCredentialFlags/);
  });

  it("device binding cookie is HttpOnly and stores binding id only", () => {
    const cookie = readSource("src/lib/passkey/vault-device-binding-cookie.ts");
    expect(cookie).toContain('VAULT_DEVICE_BINDING_COOKIE = "selahkeep_vault_device"');
    expect(cookie).toContain("httpOnly: true");
    expect(cookie).not.toMatch(/localStorage/);
  });

  it("passkey unlock does not depend on vault status envelope fetch", () => {
    const unlock = readSource("src/features/passkey/unlock-with-passkey.ts");
    expect(unlock).not.toContain("/api/vault/status");
    expect(unlock).not.toContain("vaultApi.status");
  });
});
