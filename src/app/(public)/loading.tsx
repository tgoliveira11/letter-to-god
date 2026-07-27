import { PageLayout } from "@/components/layout/page-layout";
import { LoadingState } from "@/components/ui/loading-state";

export default function PublicRouteLoading() {
  return (
    <PageLayout>
      <LoadingState label="Opening SelahKeep" />
    </PageLayout>
  );
}
