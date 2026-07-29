import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runSerializableTransaction } from "../../../scripts/lib/postgres-transaction.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("runSerializableTransaction", () => {
  it("uses valid PostgreSQL isolation-level syntax and the scoped transaction client", async () => {
    const transactionClient = { scope: "transaction" };
    const work = vi.fn(async (tx: typeof transactionClient) => {
      expect(tx).toBe(transactionClient);
      return "committed";
    });
    const begin = vi.fn(async (options: string, callback: typeof work) => {
      expect(options).toBe("isolation level serializable");
      expect(options).not.toBe("serializable");
      return callback(transactionClient);
    });

    await expect(
      runSerializableTransaction({ begin }, work)
    ).resolves.toBe("committed");
    expect(begin).toHaveBeenCalledOnce();
    expect(work).toHaveBeenCalledOnce();
  });

  it("routes both mutating cleanup paths through the serializable transaction helper", () => {
    const source = readFileSync(join(REPO_ROOT, "scripts/cleanup-passkeys.mjs"), "utf8");

    expect(source).not.toContain('.begin("serializable"');
    expect(source.match(/runSerializableTransaction\(sql,/g)).toHaveLength(2);
  });
});
