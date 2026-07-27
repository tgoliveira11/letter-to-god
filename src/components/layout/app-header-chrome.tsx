"use client";

import { Nav } from "@/components/layout/nav";
import { isFullyAuthenticatedSession } from "@/lib/auth/session-state";
import { VaultLockOverlayExclude } from "@/features/vault/vault-protected-shell";
import { cn } from "@/lib/ui/cn";
import { useApplicationState } from "@/components/application-state-provider";

/**
 * Authenticated header chrome. Vault dock handle lives inside `Nav`.
 * The toolbar row uses `.authenticated-header` (sticky) so content scrolls beneath it;
 * `VaultLockOverlayExclude` wraps the header so the dock stays above the lock overlay.
 */
export function AppHeaderChrome() {
  const { session } = useApplicationState();
  const signedIn = isFullyAuthenticatedSession(session);

  if (signedIn) {
    return (
      <VaultLockOverlayExclude className="overflow-visible">
        <Nav />
      </VaultLockOverlayExclude>
    );
  }

  return (
    <div className={cn("sticky top-0 z-40 shadow-[var(--shadow-sm)]")}>
      <Nav />
    </div>
  );
}
