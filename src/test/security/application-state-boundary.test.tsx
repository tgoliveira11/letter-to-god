/** @vitest-environment happy-dom */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSession } from "next-auth/react";
import { AppBootstrapBoundary } from "@/components/app-bootstrap-boundary";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  clearPrivateApplicationState: vi.fn(),
}));

vi.mock("next-auth/react", () => ({ useSession: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("@/lib/application-state/private-state-cleanup", () => ({
  clearPrivateApplicationState: mocks.clearPrivateApplicationState,
}));

function authenticatedSession(ownerId: string) {
  return {
    data: {
      user: { id: ownerId, name: "Private owner", email: "owner@example.test" },
      expires: "2099-01-01T00:00:00.000Z",
      twoFactorPending: false,
      twoFactorVerified: true,
    },
    status: "authenticated" as const,
  };
}

describe("AppBootstrapBoundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes owner A private DOM before refreshing for owner B", () => {
    vi.mocked(useSession).mockReturnValue(authenticatedSession("owner-a"));
    const view = render(
      <AppBootstrapBoundary initialOwnerId="owner-a">
        <p>OWNER-A-PRIVATE-PLAINTEXT</p>
      </AppBootstrapBoundary>
    );
    expect(screen.getByText("OWNER-A-PRIVATE-PLAINTEXT")).toBeInTheDocument();

    vi.mocked(useSession).mockReturnValue(authenticatedSession("owner-b"));
    view.rerender(
      <AppBootstrapBoundary initialOwnerId="owner-a">
        <p>OWNER-A-PRIVATE-PLAINTEXT</p>
      </AppBootstrapBoundary>
    );

    expect(screen.queryByText("OWNER-A-PRIVATE-PLAINTEXT")).not.toBeInTheDocument();
    expect(screen.getByText(/Refreshing your private space/)).toBeInTheDocument();
    expect(mocks.clearPrivateApplicationState).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("does not expose a server owner while the client session is unresolved", () => {
    vi.mocked(useSession).mockReturnValue({ data: undefined, status: "loading" });

    render(
      <AppBootstrapBoundary initialOwnerId="owner-a">
        <p>OWNER-A-PRIVATE-PLAINTEXT</p>
      </AppBootstrapBoundary>
    );

    expect(screen.queryByText("OWNER-A-PRIVATE-PLAINTEXT")).not.toBeInTheDocument();
    expect(mocks.clearPrivateApplicationState).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
