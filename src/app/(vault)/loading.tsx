import { PageLayout } from "@/components/layout/page-layout";
import { LoadingState } from "@/components/ui/loading-state";

export default function VaultRouteLoading() {
  return (
    <PageLayout>
      <LoadingState label="Opening your private space" />
    </PageLayout>
  );
}
