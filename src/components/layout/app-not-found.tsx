"use client";

import Link from "next/link";
import { SiteShell } from "@/components/layout/site-shell";
import { PageLayout } from "@/components/layout/page-layout";
import { AuthenticatedPage } from "@/components/layout/authenticated-page";
import { NotFoundState } from "@/components/ui/not-found-state";
import { Button } from "@/components/ui/button";
import {
  isFullyAuthenticatedSession,
  isPendingTwoFactorSession,
} from "@/lib/auth/session-state";
import { useApplicationState } from "@/components/application-state-provider";

function NotFoundActions({ variant }: { variant: "page" | "note" }) {
  const { session } = useApplicationState();
  const fullyAuthenticated = isFullyAuthenticatedSession(session);
  const pendingTwoFactor = isPendingTwoFactorSession(session);

  if (fullyAuthenticated) {
    if (variant === "note") {
      return (
        <Link href="/notes" className="inline-flex">
          <Button type="button">Back to notes</Button>
        </Link>
      );
    }

    return (
      <>
        <Link href="/notes" className="inline-flex">
          <Button type="button">Go to notes</Button>
        </Link>
        <Link href="/" className="inline-flex">
          <Button type="button" variant="secondary">
            Go home
          </Button>
        </Link>
        <Link href="/vault/settings" className="inline-flex">
          <Button type="button" variant="secondary">
            Open vault settings
          </Button>
        </Link>
      </>
    );
  }

  return (
    <>
      <Link href="/" className="inline-flex">
        <Button type="button">Go home</Button>
      </Link>
      {!pendingTwoFactor ? (
        <Link href="/login" className="inline-flex">
          <Button type="button" variant="secondary">
            Sign in
          </Button>
        </Link>
      ) : null}
    </>
  );
}

/** Global 404 — includes SiteShell because root not-found is outside route-group layouts. */
export function AppNotFoundPage() {
  return (
    <SiteShell>
      <PageLayout width="medium" className="flex min-h-[50vh] items-center justify-center">
        <NotFoundState variant="page" actions={<NotFoundActions variant="page" />} />
      </PageLayout>
    </SiteShell>
  );
}

/** Missing note panel — used inside vault routes that already render SiteShell. */
export function NoteNotFoundPanel() {
  return (
    <AuthenticatedPage width="editor" className="flex min-h-[40vh] items-center justify-center">
      <NotFoundState variant="note" actions={<NotFoundActions variant="note" />} />
    </AuthenticatedPage>
  );
}
