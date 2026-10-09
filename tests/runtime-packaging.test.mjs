// Runtime packaging contracts: manifests and hook commands.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateHooks } from "../tools/generate.mjs";
import { validateCodexMarketplace, validateCopilotManifest, validatePiPackage } from "../tools/runtimes.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

describe("validateCodexMarketplace", () => {
  const manifest = (plugins) => JSON.stringify({ plugins });
  test("needs one entry whose name matches and whose path exists", () => {
    const ok = { name: "pstack", source: { path: "./plugins/pstack" } };
    expect(() =>
      validateCodexMarketplace(manifest([ok]), { expectedName: "pstack", pathExists: () => true }),
    ).not.toThrow();
    expect(() => validateCodexMarketplace(manifest([]), { expectedName: "pstack", pathExists: () => true })).toThrow(
      "expected 1 plugin entry, found 0",
    );
    expect(() =>
      validateCodexMarketplace(manifest([{ ...ok, name: "other" }]), { expectedName: "pstack", pathExists: () => true }),
    ).toThrow('plugin name "other" != Codex manifest name "pstack"');
    expect(() => validateCodexMarketplace(manifest([ok]), { expectedName: "pstack", pathExists: () => false })).toThrow(
      "does not resolve to a directory",
    );
  });
});

describe("validateCopilotManifest", () => {
  const claude = { name: "pstack" };
  const ok = { name: "pstack", hooks: "hooks/copilot-hooks.json" };
  test("needs the Claude Code name and a hooks file that exists", () => {
    const pathExists = (rel) => rel === "plugins/pstack/hooks/copilot-hooks.json";
    expect(() => validateCopilotManifest(ok, { claude, pathExists })).not.toThrow();
    expect(() => validateCopilotManifest({ ...ok, name: "other" }, { claude, pathExists })).toThrow(
      'name "other" != Claude Code manifest name "pstack"',
    );
    expect(() => validateCopilotManifest({ ...ok, hooks: "hooks/nope.json" }, { claude, pathExists })).toThrow(
      'hooks "hooks/nope.json" is not a file in the plugin',
    );
    expect(() => validateCopilotManifest({ name: "pstack" }, { claude, pathExists })).toThrow("is not a file in the plugin");
  });
});

describe("manifests", () => {
  const json = (rel) => JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));
  const claude = json("plugins/pstack/.claude-plugin/plugin.json");
  const codex = json("plugins/pstack/.codex-plugin/plugin.json");
  const claudeMarketplace = json(".claude-plugin/marketplace.json");
  const codexMarketplace = json(".agents/plugins/marketplace.json");
  const piPackage = json("package.json");
  const copilot = json("plugins/pstack/.github/plugin/plugin.json");

  test("the plugin and marketplace manifests agree on every fact they repeat", () => {
    const shared = ({ name, author, homepage, repository, license, keywords }) =>
      ({ name, author, homepage, repository, license, keywords });
    expect(Object.values(shared(claude))).not.toContain(undefined);
    expect(shared(codex)).toEqual(shared(claude));
    expect(claudeMarketplace.owner).toEqual(claude.author);
    expect(claudeMarketplace.plugins.map(({ name, source }) => [name, source])).toEqual([[claude.name, "./plugins/pstack"]]);
    expect(shared(piPackage)).toEqual({ ...shared(claude), keywords: ["pi-package", ...claude.keywords] });
    expect(piPackage.version).toBe(claude.version);
    expect({ ...shared(copilot), keywords: claude.keywords }).toEqual(shared(claude));
    expect(copilot.version).toBe(claude.version);
    expect(codexMarketplace.name).toBe(claudeMarketplace.name);
    expect(codexMarketplace.interface.displayName).toBe(codex.interface.displayName);
    expect(codexMarketplace.plugins.map(({ name, source, category }) => [name, source.path, category])).toEqual([
      [codex.name, claudeMarketplace.plugins[0].source, codex.interface.category],
    ]);
  });
});

describe("validatePiPackage", () => {
  const ENTRY = "plugins/pstack/pi/index.ts";
  const manifest = (pi, extra = {}) => JSON.stringify({ name: "pstack", keywords: ["pi-package"], ...extra, pi });
  const good = { skills: ["./plugins/pstack/skills"], extensions: [`./${ENTRY}`] };
  const everything = () => true;

  test("accepts the skills tree and the extension entry when both exist", () => {
    expect(() => validatePiPackage(manifest(good), { pathExists: everything })).not.toThrow();
  });

  test("names each listed path that does not exist", () => {
    const pathExists = (rel) => rel !== "plugins/pstack/skill";
    expect(() =>
      validatePiPackage(manifest({ ...good, skills: ["./plugins/pstack/skill"] }), { pathExists }),
    ).toThrow("package.json: pi.skills names ./plugins/pstack/skill, which does not exist");
  });

  test("requires the skills tree and the extension entry", () => {
    expect(() => validatePiPackage(manifest({ ...good, skills: [] }), { pathExists: everything })).toThrow(
      "package.json: pi.skills must list ./plugins/pstack/skills",
    );
    const { extensions, ...skillsOnly } = good;
    expect(() => validatePiPackage(manifest(skillsOnly), { pathExists: everything })).toThrow(
      `package.json: pi.extensions must list ./${ENTRY}`,
    );
  });

  test("requires the pi-package keyword and no runtime dependencies", () => {
    expect(() => validatePiPackage(manifest(good, { keywords: [] }), { pathExists: everything })).toThrow(
      'package.json: keywords must include "pi-package"',
    );
    expect(() => validatePiPackage(manifest(good, { dependencies: { x: "1" } }), { pathExists: everything })).toThrow(
      "package.json: the Pi package has no runtime dependencies",
    );
  });
});

describe("validateHooks", () => {
  const hooks = (command, commandWindows) =>
    JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command, commandWindows }] }] } });
  const exec = { mode: 0o755 };
  const plain = { mode: 0o644 };

  test("accepts an executable script under the plugin root", () => {
    const statOf = (rel) => (rel === "hooks/session-start.sh" ? exec : null);
    expect(() => validateHooks(hooks('"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh"'), { statOf })).not.toThrow();
  });

  test("checks the script, not the runtime argument after it", () => {
    const cmd = hooks('"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh" codex');
    const statOf = (rel) => (rel === "hooks/session-start.sh" ? exec : null);
    expect(() => validateHooks(cmd, { statOf })).not.toThrow();
    expect(() => validateHooks(cmd, { statOf: () => plain })).toThrow("hooks/session-start.sh is not executable");
    expect(() => validateHooks(cmd, { statOf: () => null, file: "hooks/codex-hooks.json" })).toThrow(
      "hooks/codex-hooks.json:\n  SessionStart: hooks/session-start.sh does not exist",
    );
  });

  test("checks references under the runtime's own root variable", () => {
    const statOf = (rel) => (rel === "hooks/session-start.sh" ? exec : null);
    const copilotCmd = hooks('"${COPILOT_PLUGIN_ROOT}/hooks/session-start.sh" copilot');
    expect(() => validateHooks(copilotCmd, { statOf, root: "COPILOT_PLUGIN_ROOT" })).not.toThrow();
    expect(() => validateHooks(copilotCmd, { statOf })).toThrow("command does not reference ${CLAUDE_PLUGIN_ROOT}");
    expect(() => validateHooks(hooks('"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh"'), { statOf, root: "COPILOT_PLUGIN_ROOT" })).toThrow(
      "command does not reference ${COPILOT_PLUGIN_ROOT}",
    );
  });

  test("names a missing or non-executable target", () => {
    expect(() => validateHooks(hooks('"${CLAUDE_PLUGIN_ROOT}/hooks/nope"'), { statOf: () => null })).toThrow(
      "SessionStart: hooks/nope does not exist",
    );
    expect(() => validateHooks(hooks('"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh"'), { statOf: () => plain })).toThrow(
      "hooks/session-start.sh is not executable",
    );
  });

  test("checks the Windows override path without requiring an executable bit for PowerShell", () => {
    const cmd = hooks(
      '"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh" codex',
      'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.ps1"',
    );
    const statOf = (rel) => rel.endsWith(".sh") ? exec : plain;
    expect(() => validateHooks(cmd, { statOf })).not.toThrow();
    expect(() => validateHooks(cmd, { statOf: (rel) => rel.endsWith(".sh") ? exec : null })).toThrow(
      "SessionStart: hooks/session-start.ps1 does not exist",
    );
  });

  test("names a hook without a command, even when it has a Windows override", () => {
    const windows = 'powershell.exe -File "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.ps1"';
    for (const cmd of [hooks(undefined), hooks(undefined, windows)]) {
      expect(() => validateHooks(cmd, { statOf: () => plain })).toThrow(
        "SessionStart: hook must have required properties command",
      );
    }
  });

  test("faults a Windows override that is not a string and names the file", () => {
    const cmd = hooks('"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh"', 5);
    expect(() => validateHooks(cmd, { statOf: () => exec, file: "hooks/codex-hooks.json" })).toThrow(
      "hooks/codex-hooks.json:\n  SessionStart: commandWindows must be string",
    );
  });

  test("faults a key no hook type documents, so a misspelt override is not dropped", () => {
    const hook = { type: "command", command: '"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh"', commandWindow: "x.ps1" };
    const cmd = JSON.stringify({ hooks: { SessionStart: [{ hooks: [hook] }] } });
    expect(() => validateHooks(cmd, { statOf: () => exec })).toThrow("SessionStart: unknown key commandWindow");
  });

  test("accepts a prompt hook, which carries a prompt instead of a command", () => {
    const stop = (hook) => JSON.stringify({ hooks: { Stop: [{ hooks: [hook] }] } });
    expect(() => validateHooks(stop({ type: "prompt", prompt: "Review $ARGUMENTS" }), { statOf: () => null })).not.toThrow();
    expect(() => validateHooks(stop({ type: "prompt" }), { statOf: () => null })).toThrow(
      "Stop: hook must have required properties prompt",
    );
    expect(() => validateHooks(stop({ type: "webhook", command: "x" }), { statOf: () => null })).toThrow(
      'Stop: hook type "webhook" is not one of command, http, mcp_tool, prompt, agent',
    );
    expect(() => validateHooks(stop({ type: "constructor" }), { statOf: () => null })).toThrow(
      'Stop: hook type "constructor" is not one of command, http, mcp_tool, prompt, agent',
    );
  });

  describe("Copilot's flat file", () => {
    const flat = (hook, event = "sessionStart") => JSON.stringify({ version: 1, hooks: { [event]: [{ type: "command", ...hook }] } });
    const copilot = { format: "copilot", root: "COPILOT_PLUGIN_ROOT", file: "hooks/copilot-hooks.json" };
    const ps1 = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"$env:COPILOT_PLUGIN_ROOT/hooks/session-start-copilot.ps1\"";
    const statOf = (rel) => (rel.endsWith(".sh") ? exec : rel.endsWith(".ps1") ? plain : null);

    test("accepts a bash command, a powershell command, or both, each under its root", () => {
      const bash = '"${COPILOT_PLUGIN_ROOT}/hooks/session-start.sh" copilot';
      expect(() => validateHooks(flat({ bash, timeoutSec: 30 }), { ...copilot, statOf })).not.toThrow();
      expect(() => validateHooks(flat({ powershell: ps1 }), { ...copilot, statOf })).not.toThrow();
      expect(() => validateHooks(flat({ bash, powershell: ps1 }), { ...copilot, statOf })).not.toThrow();
      expect(() => validateHooks(flat({ bash, matcher: "view|task|bash" }, "preToolUse"), { ...copilot, statOf })).not.toThrow();
    });

    test("names a form that does not reference the runtime's root", () => {
      expect(() => validateHooks(flat({ bash: '"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh"' }), { ...copilot, statOf })).toThrow(
        "sessionStart: bash command does not reference ${COPILOT_PLUGIN_ROOT}",
      );
      expect(() => validateHooks(flat({ powershell: '"${COPILOT_PLUGIN_ROOT}/hooks/session-start-copilot.ps1"' }), { ...copilot, statOf })).toThrow(
        "sessionStart: powershell command does not reference $env:COPILOT_PLUGIN_ROOT",
      );
    });

    test("checks each script exists, and only a bash script run directly is executable", () => {
      const bash = '"${COPILOT_PLUGIN_ROOT}/hooks/session-start.sh" copilot';
      expect(() => validateHooks(flat({ bash }), { ...copilot, statOf: () => plain })).toThrow("hooks/session-start.sh is not executable");
      expect(() => validateHooks(flat({ powershell: ps1 }), { ...copilot, statOf: () => null })).toThrow(
        "sessionStart: hooks/session-start-copilot.ps1 does not exist in the plugin",
      );
      expect(() => validateHooks(flat({ powershell: ps1 }), { ...copilot, statOf: () => plain })).not.toThrow();
    });

    test("faults a hook with neither command, and a key no flat hook documents", () => {
      expect(() => validateHooks(flat({}), { ...copilot, statOf })).toThrow("sessionStart: hook needs a bash or a powershell command");
      expect(() => validateHooks(flat({ bash: "x", commandWindows: "y" }), { ...copilot, statOf })).toThrow(
        "sessionStart: unknown key commandWindows",
      );
      expect(() => validateHooks(flat({ command: "x" }), { ...copilot, statOf })).toThrow("sessionStart: unknown key command");
    });

    test("faults a file that is not version 1 with an events object", () => {
      expect(() => validateHooks(JSON.stringify({ version: 2, hooks: {} }), { ...copilot, statOf })).toThrow("hooks/copilot-hooks.json");
      expect(() => validateHooks(JSON.stringify({ hooks: { sessionStart: [] } }), { ...copilot, statOf })).toThrow("hooks/copilot-hooks.json");
      expect(() => validateHooks(JSON.stringify({ version: 1, hooks: { sessionStart: {} } }), { ...copilot, statOf })).toThrow(
        "hooks.sessionStart must be array",
      );
    });

    test("rejects the nested Claude shape where the flat file is required", () => {
      const nested = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: '"${COPILOT_PLUGIN_ROOT}/hooks/session-start.sh"' }] }] } });
      expect(() => validateHooks(nested, { ...copilot, statOf })).toThrow();
    });
  });

  test("faults an event whose value is not a list of matcher groups", () => {
    expect(() => validateHooks(JSON.stringify({ hooks: { SessionStart: {} } }), { statOf: () => exec })).toThrow(
      "hooks/hooks.json:\n  hooks.SessionStart must be array",
    );
  });

  test("a file the command reads only has to exist", () => {
    const cmd = hooks('cat "${CLAUDE_PLUGIN_ROOT}/hooks/session-start-context.md"');
    expect(() => validateHooks(cmd, { statOf: () => plain })).not.toThrow();
    expect(() => validateHooks(cmd, { statOf: () => null })).toThrow(
      "SessionStart: hooks/session-start-context.md does not exist",
    );
  });

  test("rejects a command that does not go through the plugin root", () => {
    expect(() => validateHooks(hooks("cat /etc/motd"), { statOf: () => exec })).toThrow(
      "does not reference ${CLAUDE_PLUGIN_ROOT}",
    );
  });
});

