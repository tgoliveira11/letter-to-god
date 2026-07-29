import { randomUUID } from "node:crypto";
import { getVoiceModelConnectSources } from "@/lib/voice/voice-config";

/** Fresh nonce per request for Next.js inline scripts (production App Router). */
export function createContentSecurityPolicyNonce(): string {
  return Buffer.from(randomUUID()).toString("base64");
}

/**
 * Returns the one exact HTTPS origin that the browser may contact for the
 * portable vault broker. Invalid or over-broad values fail closed.
 */
export function getPortableVaultBrokerConnectSource(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  if (env.VAULT_PORTABLE_BROKER_ENABLED?.trim() !== "true") return undefined;

  const raw = env.VAULT_PORTABLE_BROKER_URL?.trim();
  if (!raw) return undefined;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return undefined;
    if (parsed.username || parsed.password) return undefined;
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) return undefined;
    if (!parsed.hostname || parsed.hostname.includes("*")) return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

export function buildContentSecurityPolicy(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";

  // On-device voice transcription downloads model weights / ONNX-runtime WASM
  // from a (self-hostable) model host. Audio and transcript never leave the
  // device; only these content-free origins need network access.
  const voiceSources = getVoiceModelConnectSources();
  const portableVaultBrokerSource = getPortableVaultBrokerConnectSource();
  const connectSrc = [
    "'self'",
    ...(isDev ? ["ws:"] : []),
    ...voiceSources,
    ...(portableVaultBrokerSource ? [portableVaultBrokerSource] : []),
  ].join(" ");

  const directives = [
    "default-src 'self'",
    isDev
      ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'`,
    isDev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    `connect-src ${connectSrc}`,
    // Encrypted attachment previews decrypt client-side and render via blob: URLs.
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "frame-src 'self' blob:",
    // Voice transcription runs Whisper in a Web Worker; ONNX-runtime may spawn
    // helper workers from blob: URLs for WASM threading.
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];

  if (!isDev) {
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
}

export function applyContentSecurityPolicy(
  requestHeaders: Headers,
  response: Response,
  nonce: string
): void {
  const policy = buildContentSecurityPolicy(nonce);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  response.headers.set("Content-Security-Policy", policy);
}
