export type AsyncOwnershipScope = Readonly<{
  ownerId: string;
  leaseEpoch: number;
  resourceId: string;
  encryptedKeyFingerprint?: string | null;
}>;

declare const asyncOwnershipBrand: unique symbol;

export type AsyncOwnershipToken = Readonly<{
  scope: AsyncOwnershipScope;
  generation: number;
  [asyncOwnershipBrand]: true;
}>;

export class AsyncOwnershipCancelledError extends Error {
  readonly code = "async_ownership_cancelled";

  constructor() {
    super("The private operation no longer owns the active application state");
    this.name = "AsyncOwnershipCancelledError";
  }
}

function sameScope(left: AsyncOwnershipScope, right: AsyncOwnershipScope): boolean {
  return (
    left.ownerId === right.ownerId &&
    left.leaseEpoch === right.leaseEpoch &&
    left.resourceId === right.resourceId &&
    (left.encryptedKeyFingerprint ?? null) === (right.encryptedKeyFingerprint ?? null)
  );
}

/** Consumer-neutral, monotonic last-request-wins ownership guard. */
export class AsyncOwnershipController {
  #generation = 0;
  #scope: AsyncOwnershipScope | null = null;

  capture(scope: AsyncOwnershipScope): AsyncOwnershipToken {
    this.#generation += 1;
    this.#scope = Object.freeze({ ...scope });
    return Object.freeze({
      scope: this.#scope,
      generation: this.#generation,
    }) as AsyncOwnershipToken;
  }

  isCurrent(token: AsyncOwnershipToken): boolean {
    return (
      token.generation === this.#generation &&
      this.#scope !== null &&
      sameScope(token.scope, this.#scope)
    );
  }

  assertCurrent(token: AsyncOwnershipToken): void {
    if (!this.isCurrent(token)) throw new AsyncOwnershipCancelledError();
  }

  invalidate(): void {
    this.#generation += 1;
    this.#scope = null;
  }
}

export function isAsyncOwnershipCancellation(error: unknown): boolean {
  return error instanceof AsyncOwnershipCancelledError;
}
