"use client";

import { useLayoutEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { LoadingState } from "@/components/ui/loading-state";
import { clearPrivateApplicationState } from "@/lib/application-state/private-state-cleanup";
import { isFullyAuthenticatedSession } from "@/lib/auth/session-state";

/**
 * Persistent layouts must never keep rendering owner A after NextAuth resolves
 * owner B (or guest). Cleanup happens before paint and the server tree is refreshed.
 */
export function AppBootstrapBoundary({
  initialOwnerId,
  children,
}: {
  initialOwnerId: string | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { data: session, status } = useSession();
  const activeOwnerId = isFullyAuthenticatedSession(session) ? (session?.user?.id ?? null) : null;
  const sessionResolved = status !== "loading";
  const snapshotMatchesSession = sessionResolved && initialOwnerId === activeOwnerId;

  useLayoutEffect(() => {
    if (!sessionResolved || snapshotMatchesSession) return;
    clearPrivateApplicationState();
    router.refresh();
  }, [router, sessionResolved, snapshotMatchesSession]);

  if (!snapshotMatchesSession) {
    return <LoadingState label="Refreshing your private space" />;
  }

  return children;
}
