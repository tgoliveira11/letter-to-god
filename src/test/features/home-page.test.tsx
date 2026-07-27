import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithTestApplicationState as render } from "@/test/helpers/application-state";
import HomePage from "@/app/(public)/page";
import { SiteShell } from "@/components/layout/site-shell";
import {
  SECURE_AUTH_ATTRIBUTION_URL,
  SiteFooter,
} from "@/components/layout/site-footer";
import { homeCopy } from "@/lib/marketing/home-copy";
import { PRODUCT_NAME } from "@/lib/marketing/brand";

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({ data: null, status: "unauthenticated" })),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() })),
  usePathname: vi.fn(() => "/"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

function renderHomeInShell() {
  return render(
    <SiteShell>
      <HomePage />
    </SiteShell>
  );
}

describe("home page marketing content", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the SelahKeep hero title", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { level: 1, name: PRODUCT_NAME })).toBeTruthy();
    expect(screen.getByText(homeCopy.hero.subtitle)).toBeTruthy();
  });

  it("explains private notes in the hero reassurance", () => {
    render(<HomePage />);
    expect(screen.getByText(homeCopy.hero.reassurance)).toBeTruthy();
  });

  it("explains writing and keeping notes in a vault", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { name: /pause and reflect/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /keep everything in one vault/i })).toBeTruthy();
    expect(screen.getByText(/write prayers, journal entries/i)).toBeTruthy();
    expect(screen.getByText(/categories, tags, attachments/i)).toBeTruthy();
  });

  it("explains marking notes as resolved", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { name: /mark as resolved/i })).toBeTruthy();
  });

  it("explains Kanban boards and on-device dictation", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { name: /organize with kanban boards/i })).toBeTruthy();
    expect(screen.getByText(/edits stay in sync between your note and the board/i)).toBeTruthy();
    expect(screen.getByRole("heading", { name: /dictate on your device/i })).toBeTruthy();
    expect(screen.getByText(/recordings and transcripts are not sent to us/i)).toBeTruthy();
  });

  it("explains vault recovery options", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { name: /recover thoughtfully/i })).toBeTruthy();
    expect(screen.getByText(/vault password, recovery phrase, or vault passkey/i)).toBeTruthy();
  });

  it("separates account sign-in from vault unlock", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { name: homeCopy.security.heading })).toBeTruthy();
    expect(screen.getByText(/passkey, password, or optional two-step verification/i)).toBeTruthy();
    expect(screen.getByText(/signing in does not decrypt your notes/i)).toBeTruthy();
  });

  it("documents deferred features including import/export", () => {
    render(<HomePage />);
    expect(screen.getByText(/coming later/i)).toBeTruthy();
    expect(screen.getByText(/import\/export/i)).toBeTruthy();
    expect(screen.getByText(/not in this mvp/i)).toBeTruthy();
  });

  it("explains account vs vault separation", () => {
    render(<HomePage />);
    const privacySection = screen.getByRole("region", { name: homeCopy.privacy.heading });
    expect(privacySection.textContent).toMatch(/account password signs you in only/i);
    expect(privacySection.textContent).toMatch(/does not unlock your vault/i);
  });

  it("has create account and sign in CTAs", () => {
    render(<HomePage />);
    const createLinks = screen.getAllByRole("link", { name: /create account/i });
    const signInLinks = screen.getAllByRole("link", { name: /sign in/i });
    expect(createLinks.some((link) => link.getAttribute("href") === "/register")).toBe(true);
    expect(signInLinks.some((link) => link.getAttribute("href") === "/login")).toBe(true);
    expect(createLinks.length).toBeGreaterThanOrEqual(2);
    expect(signInLinks.length).toBeGreaterThanOrEqual(2);
  });

  it("avoids crypto jargon in the privacy section", () => {
    render(<HomePage />);
    const privacySection = screen.getByRole("region", { name: homeCopy.privacy.heading });
    const text = privacySection.textContent ?? "";
    expect(text).not.toMatch(/PRF|envelope encryption|IndexedDB/i);
  });
});

describe("home page shared layout", () => {
  it("renders header navigation with SelahKeep branding", () => {
    renderHomeInShell();
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("link", { name: new RegExp(PRODUCT_NAME, "i") })).toBeTruthy();
  });

  it("renders footer secure-auth attribution with safe external link", () => {
    render(<SiteFooter />);
    const link = screen.getByRole("link", { name: /powered by @tgoliveira\/secure-auth/i });
    expect(link.getAttribute("href")).toBe(SECURE_AUTH_ATTRIBUTION_URL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("uses shared site shell on the home page", () => {
    renderHomeInShell();
    expect(screen.getByRole("contentinfo")).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
  });
});
