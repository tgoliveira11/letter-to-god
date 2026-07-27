"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { isPrfExtensionSupported } from "@tgoliveira/vault-core/browser";

export type BrowserCapabilityState =
  | { status: "checking" }
  | { status: "supported" }
  | { status: "unsupported" };

type BrowserCapabilities = {
  passkeyPrf: BrowserCapabilityState;
  refresh: () => void;
};

const BrowserCapabilitiesContext = createContext<BrowserCapabilities>({
  passkeyPrf: { status: "checking" },
  refresh: () => undefined,
});

export function BrowserCapabilitiesProvider({
  children,
  initialPasskeyPrf,
}: {
  children: React.ReactNode;
  /** Test/story seed only. Production deliberately starts in checking. */
  initialPasskeyPrf?: BrowserCapabilityState;
}) {
  const [passkeyPrf, setPasskeyPrf] = useState<BrowserCapabilityState>(
    initialPasskeyPrf ?? { status: "checking" }
  );

  const refresh = useCallback(() => {
    setPasskeyPrf({ status: isPrfExtensionSupported() ? "supported" : "unsupported" });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(refresh, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => document.removeEventListener("visibilitychange", refreshWhenVisible);
  }, [refresh]);

  const value = useMemo(() => ({ passkeyPrf, refresh }), [passkeyPrf, refresh]);
  return (
    <BrowserCapabilitiesContext.Provider value={value}>
      {children}
    </BrowserCapabilitiesContext.Provider>
  );
}

export function useBrowserCapabilities(): BrowserCapabilities {
  return useContext(BrowserCapabilitiesContext);
}
