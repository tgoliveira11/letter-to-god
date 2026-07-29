import { describe, expect, it, vi, afterEach } from "vitest";
import {
  applyContentSecurityPolicy,
  buildContentSecurityPolicy,
  createContentSecurityPolicyNonce,
  getPortableVaultBrokerConnectSource,
} from "@/lib/security/content-security-policy";

describe("content-security-policy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates a base64 nonce", () => {
    const nonce = createContentSecurityPolicyNonce();
    expect(nonce.length).toBeGreaterThan(10);
    expect(nonce).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it("uses nonce and strict-dynamic for production scripts", () => {
    vi.stubEnv("NODE_ENV", "production");
    const policy = buildContentSecurityPolicy("test-nonce");
    expect(policy).toContain("script-src 'self' 'nonce-test-nonce' 'strict-dynamic'");
    expect(policy).toContain("'wasm-unsafe-eval'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("upgrade-insecure-requests");
    expect(policy).toContain("worker-src 'self' blob:");
    expect(policy).toContain("img-src 'self' data: blob:");
    expect(policy).toContain("frame-src 'self' blob:");
    expect(policy).toContain("media-src 'self' blob:");
  });

  it("allows the on-device voice model origins in connect-src by default", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_VOICE_NOTES_ENABLED", "");
    vi.stubEnv("NEXT_PUBLIC_VOICE_MODEL_HOST", "");
    const policy = buildContentSecurityPolicy("n");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("https://huggingface.co");
    expect(policy).toContain("https://cdn.jsdelivr.net");
  });

  it("restricts connect-src to the self-hosted model host when configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_VOICE_MODEL_HOST", "https://models.example.com");
    const policy = buildContentSecurityPolicy("n");
    expect(policy).toContain("connect-src 'self' https://models.example.com");
    expect(policy).not.toContain("huggingface.co");
  });

  it("omits voice origins from connect-src when voice is disabled", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_VOICE_NOTES_ENABLED", "false");
    const policy = buildContentSecurityPolicy("n");
    expect(policy).not.toContain("huggingface.co");
  });

  it("allows only the configured exact HTTPS portable broker origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VAULT_PORTABLE_BROKER_ENABLED", "true");
    vi.stubEnv(
      "VAULT_PORTABLE_BROKER_URL",
      "https://vault-broker-green.vercel.app/"
    );

    expect(getPortableVaultBrokerConnectSource()).toBe(
      "https://vault-broker-green.vercel.app"
    );
    expect(buildContentSecurityPolicy("n")).toContain(
      "connect-src 'self' https://huggingface.co https://*.hf.co https://cdn.jsdelivr.net https://vault-broker-green.vercel.app"
    );
  });

  it.each([
    "http://vault-broker.example.com",
    "https://user:secret@vault-broker.example.com",
    "https://vault-broker.example.com/api",
    "https://vault-broker.example.com?tenant=selahkeep",
    "https://vault-broker.example.com#fragment",
    "https://*.example.com",
    "not-a-url",
  ])("fails closed for unsafe portable broker CSP source %s", (brokerUrl) => {
    vi.stubEnv("VAULT_PORTABLE_BROKER_ENABLED", "true");
    vi.stubEnv("VAULT_PORTABLE_BROKER_URL", brokerUrl);

    expect(getPortableVaultBrokerConnectSource()).toBeUndefined();
    expect(buildContentSecurityPolicy("n")).not.toContain(brokerUrl);
  });

  it("omits the portable broker origin when the feature is disabled", () => {
    vi.stubEnv("VAULT_PORTABLE_BROKER_ENABLED", "false");
    vi.stubEnv("VAULT_PORTABLE_BROKER_URL", "https://vault-broker.example.com");

    expect(getPortableVaultBrokerConnectSource()).toBeUndefined();
    expect(buildContentSecurityPolicy("n")).not.toContain(
      "https://vault-broker.example.com"
    );
  });

  it("allows dev eval and inline scripts", () => {
    vi.stubEnv("NODE_ENV", "development");
    const policy = buildContentSecurityPolicy("ignored");
    expect(policy).toContain("script-src 'self' 'unsafe-eval' 'unsafe-inline'");
    expect(policy).toContain("connect-src 'self' ws:");
  });

  it("sets request and response CSP headers", () => {
    vi.stubEnv("NODE_ENV", "production");
    const requestHeaders = new Headers();
    const response = new Response(null, { headers: new Headers() });
    applyContentSecurityPolicy(requestHeaders, response, "abc123");
    expect(requestHeaders.get("x-nonce")).toBe("abc123");
    expect(requestHeaders.get("Content-Security-Policy")).toContain("'nonce-abc123'");
    expect(response.headers.get("Content-Security-Policy")).toContain("'nonce-abc123'");
  });
});
