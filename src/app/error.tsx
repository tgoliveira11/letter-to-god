"use client";

import { ErrorState } from "@/components/ui/error-state";
import { PageLayout } from "@/components/layout/page-layout";

export default function ApplicationError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageLayout width="medium" className="flex min-h-[60vh] items-center justify-center">
      <ErrorState
        message="SelahKeep could not open this state safely. Your private content was not exposed."
        onRetry={reset}
      />
    </PageLayout>
  );
}
