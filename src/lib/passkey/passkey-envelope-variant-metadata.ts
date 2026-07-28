export const AUTHENTICATION_CONFIRMED_PRF_CEREMONY = "authentication";

export function isAuthenticationConfirmedPasskeyVariant(variant: {
  publicMetadata?: unknown;
}): boolean {
  const metadata = variant.publicMetadata;
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    (metadata as Record<string, unknown>).prfCeremony ===
      AUTHENTICATION_CONFIRMED_PRF_CEREMONY
  );
}
