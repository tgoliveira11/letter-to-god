import { PageLayout } from "@/components/layout/page-layout";
import { LoadingState } from "@/components/ui/loading-state";

export default function AuthRouteLoading() {
  return (
    <PageLayout width="narrow">
      <LoadingState label="Preparing account access" />
    </PageLayout>
  );
}
