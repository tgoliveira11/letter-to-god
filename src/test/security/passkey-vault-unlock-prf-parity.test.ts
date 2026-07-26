import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

describe("passkey vault unlock PRF ceremony parity", () => {
  it("setup, unlock, and test share prepareVaultUnlockAuthenticationOptions", () => {
    const setup = readSource("src/features/passkey/passkey-vault-unlock-setup.tsx");
    const unlock = readSource("src/lib/passkey/vault-unlock-authenticate.ts");
    expect(setup).toContain("runVaultUnlockAuthenticationCeremony");
    expect(unlock).toContain("prepareVaultUnlockAuthenticationOptions");
    expect(unlock).toContain("@tgoliveira/vault-core/browser");
  });

  it("delegates WebAuthn PRF prep to vault-core browser helpers", () => {
    const prepare = readSource("src/lib/passkey/prepare-webauthn-options.ts");
    expect(prepare).toContain("prepareWebAuthnPrfExtensions");
    expect(prepare).toContain("alignPrfExtensionsForCredential");
  });

  it("delegates PRF output extraction to vault-core", () => {
    const browser = readSource("src/lib/crypto-client/vault-passkey-browser.ts");
    expect(browser).toContain("extractPasskeyPrfOutputCore");
    expect(browser).toContain("@tgoliveira/vault-core/browser");
  });

  it("preserves stored transports instead of synthesizing internal transport", () => {
    const service = readSource("src/server/services/passkey-service.ts");
    expect(service).toContain("toAllowCredentialDescriptor");
    expect(service).not.toMatch(/transports: \["internal"\]/);
    expect(service).not.toContain("scopeAuthenticationOptionsToDevice");
  });
});
