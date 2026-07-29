"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { passkeyAccountApi, type AccountPasskey } from "@tgoliveira/secure-auth/client";
import { userVaultKeysEqual } from "@tgoliveira/vault-core";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { vaultApi, type PortableVaultMapping } from "@/lib/api-client/vault";
import {
  enrollPortablePasskey,
  revokePortablePasskey,
  unlockWithPortablePasskey,
} from "@/features/passkey/portable-vault-broker";
import {
  beginVaultOwnerOperation,
  getUserVaultKey,
} from "@/lib/crypto-client/vault-session";

export function PortablePasskeyVaultSetup({
  vaultUnlocked,
  enabled,
  brokerUrl,
  userId,
}: {
  vaultUnlocked: boolean;
  enabled: boolean;
  brokerUrl: string;
  userId: string;
}) {
  const [passkeys, setPasskeys] = useState<AccountPasskey[]>([]);
  const [mappings, setMappings] = useState<PortableVaultMapping[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const [account, portable] = await Promise.all([
      passkeyAccountApi.list(),
      vaultApi.listPortablePasskeys(),
    ]);
    const eligible = account.passkeys.filter((passkey) => passkey.signInEnabled);
    setPasskeys(eligible);
    setMappings(portable.mappings);
    setSelectedId((current) => current || eligible[0]?.id || "");
  }, [enabled]);

  useEffect(() => {
    void refresh().catch((cause) => {
      setError(cause instanceof Error ? cause.message : "Could not load passkeys");
    });
  }, [refresh]);

  const mappedCredentialIds = useMemo(
    () => new Set(mappings.map((mapping) => mapping.credentialDbId)),
    [mappings]
  );
  const available = passkeys.filter((passkey) => !mappedCredentialIds.has(passkey.id));

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      await refresh();
      setMessage(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Portable passkey operation failed");
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) {
    return (
      <p className="text-sm text-[var(--muted)]">
        Portable passkey unlock is not enabled for this environment. Vault password and recovery
        phrase remain available.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--muted)]">
        A single synced account passkey can unlock this vault in another compatible browser. Login
        and vault unlock remain separate actions. The trusted vault broker stores a random unlock
        key protected by its server encryption key; your vault password and recovery phrase remain
        independent recovery methods.
      </p>

      {error ? <Alert variant="danger">{error}</Alert> : null}
      {message ? <Alert variant="success">{message}</Alert> : null}

      {mappings.map((mapping) => (
        <div
          key={mapping.id}
          className="flex flex-col gap-3 rounded-lg border border-[var(--border)] p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p className="font-medium">{mapping.friendlyName}</p>
            <p className="text-xs text-[var(--muted)]">
              {mapping.state === "active" ? "Portable vault unlock enabled" : "Enrollment pending"}
            </p>
          </div>
          {mapping.state === "active" ? (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void run(
                    async () => {
                      const currentVaultKey = getUserVaultKey();
                      if (!currentVaultKey) throw new Error("Unlock the vault before testing");
                      const restored = await unlockWithPortablePasskey({
                        mapping,
                        brokerUrl,
                        operation: beginVaultOwnerOperation(userId),
                      });
                      if (!(await userVaultKeysEqual(currentVaultKey, restored))) {
                        throw new Error("Portable passkey does not unlock this vault");
                      }
                    },
                    "Portable passkey verified successfully."
                  )
                }
              >
                Test
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => revokePortablePasskey({ mapping, brokerUrl }),
                    "Portable passkey vault unlock revoked."
                  )
                }
              >
                Revoke
              </Button>
            </div>
          ) : null}
        </div>
      ))}

      {passkeys.length === 0 ? (
        <div className="space-y-2">
          <p className="text-sm">Create an account passkey before enabling portable vault unlock.</p>
          <Link href="/settings/account">
            <Button variant="secondary">Manage account passkeys</Button>
          </Link>
        </div>
      ) : available.length > 0 ? (
        <div className="space-y-3">
          <label className="block text-sm font-medium" htmlFor="portable-passkey-select">
            Account passkey
          </label>
          <select
            id="portable-passkey-select"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {available.map((passkey) => (
              <option key={passkey.id} value={passkey.id}>
                {passkey.friendlyName}
              </option>
            ))}
          </select>
          <Button
            disabled={busy || !vaultUnlocked || !selectedId}
            onClick={() =>
              void run(
                () =>
                  enrollPortablePasskey({
                    credentialDbId: selectedId,
                    brokerUrl,
                    operation: beginVaultOwnerOperation(userId),
                  }),
                "Portable passkey vault unlock enabled."
              )
            }
          >
            Enable portable passkey
          </Button>
          {!vaultUnlocked ? (
            <p className="text-xs text-[var(--muted)]">
              Unlock the vault with your password or recovery phrase before enabling a passkey.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
