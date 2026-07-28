import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

const ACTIVE_ROOT_FILES = ["README.md", "ARCHITECTURE.md", "SECURITY.md", "AGENTS.md"];

function collectMarkdownFiles(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "archive" || name === "node_modules" || name === ".next") continue;
      collectMarkdownFiles(path, files);
    } else if (/\.(md|mdc)$/.test(name)) {
      files.push(path);
    }
  }
  return files;
}

function activeDocPaths(): string[] {
  const paths = ACTIVE_ROOT_FILES.map((f) => join(ROOT, f));
  paths.push(...collectMarkdownFiles(join(ROOT, "docs")));
  paths.push(...collectMarkdownFiles(join(ROOT, ".cursor/rules")));
  return paths;
}

function isAllowedContext(line: string): boolean {
  return (
    /reintroduc|removed|deprecat|rename\/replace|→|must not|do not|no active|no competing|forbidden|guard test|complete\)|✅ Pass|competing local auth/i.test(
      line
    ) || line.includes("**Removed:**") || line.includes("historical")
  );
}

type ForbiddenRule = {
  name: string;
  pattern: RegExp;
  allow?: (line: string) => boolean;
};

const FORBIDDEN: ForbiddenRule[] = [
  {
    name: "active letters app route path",
    pattern: /src\/app\/\(vault\)\/letters/,
  },
  {
    name: "active letters API route",
    pattern: /\/api\/letters/,
    allow: (line) =>
      line.includes("Removed") ||
      line.includes("removed") ||
      line.includes("no active") ||
      line.includes("do not") ||
      line.includes("Phase 3"),
  },
  {
    name: "letters module path",
    pattern: /src\/modules\/letters/,
    allow: (line) => line.includes("removed") || line.includes("Removed") || line.includes("no active"),
  },
  {
    name: "letter service",
    pattern: /letter-service/,
    allow: (line) => line.includes("removed") || line.includes("Removed"),
  },
  {
    name: "letters table export",
    pattern: /export const letters\b/,
  },
  {
    name: "legacy green envelope brand color",
    pattern: /#4a6741/,
  },
  {
    name: "legacy sage green primary branding",
    pattern: /sage green primary/i,
  },
  {
    name: "PBKDF2 fallback for vault password KDF",
    pattern: /PBKDF2.*vault password|vault password.*PBKDF2/i,
    allow: (line) =>
      line.includes("legacy") ||
      line.includes("recovery_code") ||
      line.includes("no PBKDF2") ||
      line.includes("Argon2id only"),
  },
  {
    name: "local auth owns account login",
    pattern: /local auth.*owns|owns.*local auth|competing local auth(?!.*secure-auth)/i,
    allow: (line) =>
      line.includes("no competing") ||
      line.includes("do not") ||
      line.includes("removed") ||
      line.includes("not") ||
      line.includes("guard"),
  },
];

function findViolations(filePath: string): string[] {
  const rel = relative(ROOT, filePath);
  if (rel === "docs/LTG_VAULT_IMPLEMENTATION_PLAN.md") return [];
  const lines = readFileSync(filePath, "utf8").split("\n");
  const violations: string[] = [];

  for (const rule of FORBIDDEN) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!rule.pattern.test(line)) continue;
      if (rule.allow?.(line)) continue;
      if (isAllowedContext(line)) continue;
      violations.push(`${rel}:${i + 1} — ${rule.name}: ${line.trim().slice(0, 120)}`);
    }
  }

  return violations;
}

describe("documentation current state", () => {
  it("active docs do not describe removed letters routes/APIs as current", () => {
    const violations: string[] = [];
    for (const file of activeDocPaths()) {
      violations.push(...findViolations(file));
    }
    expect(violations).toEqual([]);
  });

  it("metadata title is SelahKeep", async () => {
    const layout = await import("@/app/layout");
    expect(String(layout.metadata.title)).toMatch(/SelahKeep/i);
  });

  it("favicon is purple SK monogram without green envelope palette", () => {
    const icon = readFileSync(join(ROOT, "src/app/icon.svg"), "utf8");
    expect(icon).toContain("SK");
    expect(icon).toContain("#5b3a8c");
    expect(icon).not.toContain("#4a6741");
  });

  it("docs index points to active source-of-truth files", () => {
    const index = readFileSync(join(ROOT, "docs/README.md"), "utf8");
    expect(index).toContain("TDR_LTG_Vault_MVP.md");
    expect(index).toContain("ADR-005");
    expect(index).not.toContain("docs/ADR-001_");
  });
});
