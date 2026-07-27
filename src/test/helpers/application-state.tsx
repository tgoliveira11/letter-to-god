import { useSession } from "next-auth/react";
import { ApplicationStateProvider, type ApplicationState } from "@/components/application-state-provider";
import { isFullyAuthenticatedSession } from "@/lib/auth/session-state";
import { BrowserCapabilitiesProvider } from "@/components/browser-capabilities-provider";
import {
  render as testingLibraryRender,
  type RenderOptions,
} from "@testing-library/react";

/**
 * Test-only bridge for legacy component tests that already drive NextAuth's
 * mocked session. Production always receives this state from the server
 * bootstrap and never uses this adapter.
 */
export function TestApplicationState({
  children,
  overrides,
}: {
  children: React.ReactNode;
  overrides?: Partial<ApplicationState>;
}) {
  const { data: session, status } = useSession();
  const fullyAuthenticated =
    status === "authenticated" && isFullyAuthenticatedSession(session);
  return (
    <ApplicationStateProvider
      value={{
        ownerId: fullyAuthenticated ? (session?.user?.id ?? null) : null,
        session: status === "loading" ? null : session,
        vaultStatus: null,
        vaultAutoLockUserMinutes: null,
        adminAccess: false,
        features: { preferences: true },
        ...overrides,
      }}
    >
      <BrowserCapabilitiesProvider initialPasskeyPrf={{ status: "unsupported" }}>
        {children}
      </BrowserCapabilitiesProvider>
    </ApplicationStateProvider>
  );
}

export function withTestApplicationState(
  children: React.ReactNode,
  overrides?: Partial<ApplicationState>
) {
  return <TestApplicationState overrides={overrides}>{children}</TestApplicationState>;
}

export function renderWithTestApplicationState(
  ui: React.ReactNode,
  options?: RenderOptions,
  overrides?: Partial<ApplicationState>
) {
  return testingLibraryRender(withTestApplicationState(ui, overrides), options);
}
