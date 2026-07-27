import { clearNoteBodyCache } from "@/features/notes/eager-decrypt-notes";
import { clearVaultSessionOwnerState } from "@/lib/crypto-client/vault-session";

const cleanupHandlers = new Set<() => void>();

export function registerPrivateStateCleanup(handler: () => void): () => void {
  cleanupHandlers.add(handler);
  return () => cleanupHandlers.delete(handler);
}

/** Synchronous account boundary: no prior-owner plaintext may survive the next paint. */
export function clearPrivateApplicationState(): void {
  try {
    clearNoteBodyCache();
    for (const handler of cleanupHandlers) {
      try {
        handler();
      } catch {
        // Continue synchronously: one consumer must not prevent fail-closed cleanup.
      }
    }
  } finally {
    clearVaultSessionOwnerState();
  }
}
