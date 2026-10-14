import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { checkSheet, family, parseEntry, parseSheet } from "../plugins/pstack/skills/setup-pstack/scripts/t3-sheet.mjs";

const root = join(import.meta.dir, "..");
const models = JSON.parse(readFileSync(join(root, "plugins/pstack/models.json"), "utf8"));
const roles = models.roles;
const catalog = JSON.parse(readFileSync(join(root, "tests/fixtures/t3-sheet-catalog.json"), "utf8"));
const allowList = {
  instances: {
    "instance-alpha": { layers: ["pstack", "org"], gate: true },
    "instance-beta": { layers: ["pstack"], gate: true },
    "instance-locked": { layers: ["pstack"], gate: true },
  },
};
const PANEL = "arena runners";
const check = (text, options = {}) => checkSheet(parseSheet(text), { roles, catalog, ...options });

describe("T3 model sheet parsing", () => {
  test("accepts comments, blank lines, known roles, inheritance, and session hook settings", () => {
    expect(parseSheet("# local choices\n\nfeature, refactoring: auto\nsession hook: off\n")).toEqual([
      { line: 3, key: "feature, refactoring", value: "auto", raw: "feature, refactoring: auto" },
      { line: 4, key: "session hook", value: "off", raw: "session hook: off" },
    ]);
    expect(check("# local choices\n\nfeature, refactoring: inherit-parent\nsession hook: on")).toEqual([]);
  });

  test("splits the target at its first slash and maps option tokens", () => {
    expect(parseEntry("instance-beta/route-z/familyc-model effort=high")).toEqual({
      providerInstanceId: "instance-beta",
      model: "route-z/familyc-model",
      options: { effort: "high" },
      text: "instance-beta/route-z/familyc-model effort=high",
    });
    expect(family("route-z/familyc-model")).toBe("familyc");
    expect(check("bug-fix: instance-beta/route-z/familyc-model")).toEqual([]);
  });

  test("accepts a validated option and a panel with two model families", () => {
    expect(check(`${PANEL}: instance-alpha/familya-main effort=high, instance-alpha/familyb-review`, { allowList })).toEqual([]);
  });

  test("an unset panel is valid", () => {
    expect(check("session hook: on", { allowList })).toEqual([]);
  });

  test("an unknown role names its entry", () => {
    expect(check("unknown role: instance-alpha/familya-main")).toEqual([
      'unknown role: entry "instance-alpha/familya-main": unknown pstack role',
    ]);
  });

  test("an unknown provider instance names its role and entry", () => {
    expect(check("bug-fix: instance-missing/familya-main")).toContain(
      'bug-fix: entry "instance-missing/familya-main": provider instance "instance-missing" is not in the catalog',
    );
  });

  test("a provider that cannot run a child task is rejected", () => {
    expect(check("bug-fix: instance-locked/familyd-model")).toContain(
      'bug-fix: entry "instance-locked/familyd-model": provider instance "instance-locked" does not have canRunChildTask: true',
    );
  });

  test("an unknown model is rejected", () => {
    expect(check("bug-fix: instance-alpha/familyx-missing")).toContain(
      'bug-fix: entry "instance-alpha/familyx-missing": model "familyx-missing" is not listed under "instance-alpha"',
    );
  });

  test("an unknown option is rejected", () => {
    expect(check("bug-fix: instance-alpha/familya-main unknown=high")).toContain(
      'bug-fix: entry "instance-alpha/familya-main unknown=high": option "unknown" is not listed for "familya-main" (available: effort, mode)',
    );
  });

  test("an option value outside its catalog list is rejected", () => {
    expect(check("bug-fix: instance-alpha/familya-main effort=extreme")).toContain(
      'bug-fix: entry "instance-alpha/familya-main effort=extreme": option value effort=extreme is not listed (available: low, high)',
    );
  });

  test("default effort is rejected with a direct explanation", () => {
    expect(check("default effort: high")).toEqual([
      'default effort: entry "high": this line is not allowed; T3 effort belongs in entry options',
    ]);
  });

  test("@level is rejected as native-only syntax", () => {
    expect(check("bug-fix: instance-alpha/familya-main @high")).toEqual([
      'bug-fix: entry "instance-alpha/familya-main @high": @<level> is native-only; use a listed option=value token',
    ]);
  });

  test("a panel with one explicit target is rejected", () => {
    expect(check(`${PANEL}: instance-alpha/familya-main`)).toContain(
      `${PANEL}: entry "instance-alpha/familya-main": a panel cannot have a single explicit target`,
    );
  });

  test("a panel whose targets belong to one family is rejected", () => {
    expect(check(`${PANEL}: instance-alpha/familya-main, instance-alpha/familya-alt`)).toContain(
      `${PANEL}: entry "instance-alpha/familya-main, instance-alpha/familya-alt": a panel needs at least two model families among its explicit targets`,
    );
  });

  test("an allow-list missing the provider instance is rejected", () => {
    const restricted = { instances: { "instance-alpha": allowList.instances["instance-alpha"] } };
    expect(check("bug-fix: instance-beta/route-z/familyc-model", { allowList: restricted })).toContain(
      'bug-fix: entry "instance-beta/route-z/familyc-model": allow-list has no instance "instance-beta"',
    );
  });

  test("an allow-list without the pstack layer is rejected", () => {
    const noLayer = { instances: { "instance-alpha": { layers: ["org"], gate: true } } };
    expect(check("bug-fix: instance-alpha/familya-main", { allowList: noLayer })).toContain(
      'bug-fix: entry "instance-alpha/familya-main": allow-list is missing layer "pstack"',
    );
  });

  test("an allow-list without the access gate is rejected", () => {
    const noGate = { instances: { "instance-alpha": { layers: ["pstack"], gate: false } } };
    expect(check("bug-fix: instance-alpha/familya-main", { allowList: noGate })).toContain(
      'bug-fix: entry "instance-alpha/familya-main": allow-list is missing gate "true"',
    );
  });
});

describe("T3 model defaults", () => {
  test("the reference has none of t3-pstack's shipped provider or model defaults", () => {
    const reference = readFileSync(join(root, "plugins/pstack/skills/poteto-mode/references/t3-tools.md"), "utf8");
    const t3ModelBlock = JSON.stringify(models.t3 ?? {});
    const shippedDefaults = [
      "claudeAgent",
      "codex/",
      "grok/",
      "claude-opus-5-5",
      "claude-fable-5-1",
      "gpt-6.1-sol",
      "grok-4.7",
    ];
    for (const value of shippedDefaults) {
      expect(reference).not.toContain(value);
      expect(t3ModelBlock).not.toContain(value);
    }
    expect(reference).not.toContain("t3-pstack-models.md");
    expect(reference).not.toContain("Read every `pstack:<name>` as");
  });
});

describe("t3-sheet.mjs command line", () => {
  test("prints one warning when no allow-list is supplied and still accepts a valid sheet", () => {
    const result = runFixture("t3-sheet-valid.md");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("ok\n");
    expect(result.stderr).toBe(
      "warning: no allow-list was supplied; children may run without the pstack layer or access gate\n",
    );
  });

  test("prints one role-and-entry problem and exits 1 for an invalid sheet", () => {
    const result = runFixture("t3-sheet-invalid.md");
    expect(result.status).toBe(1);
    expect(result.stdout).toBe(
      'bug-fix: entry "instance-alpha/familya-main @high": @<level> is native-only; use a listed option=value token\n',
    );
    expect(result.stderr).toContain("warning: no allow-list was supplied");
  });

  function runFixture(sheetName) {
    return spawnSync(
      process.execPath,
      [
        join(root, "plugins/pstack/skills/setup-pstack/scripts/t3-sheet.mjs"),
        join(root, "tests/fixtures", sheetName),
        join(root, "tests/fixtures/t3-sheet-catalog.json"),
      ],
      { encoding: "utf8" },
    );
  }
});
