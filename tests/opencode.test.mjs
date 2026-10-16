// The OpenCode build: its RUNTIMES row, its packaging validator, and the files
// it ships. The validator runs on an in-memory build here and on the real tree
// below, so a broken shipped file fails this file as well as the generator.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadModels } from "../tools/generate.mjs";
import { routingInstruction } from "../plugins/pstack/opencode/routing.ts";
import { OPENCODE_AGENTS, opencodeModelNamesSection, RUNTIMES, validateOpencodePackage } from "../tools/runtimes.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const OPENCODE = "plugins/pstack/opencode";
const MAPPING = "plugins/pstack/skills/poteto-mode/references/opencode-tools.md";
const row = RUNTIMES.find((runtime) => runtime.name === "OpenCode");
const models = loadModels(repoRoot);

const readRepo = (rel) => readFileSync(join(repoRoot, rel), "utf8");
const repoExists = (rel) => existsSync(join(repoRoot, rel));

// A build held in memory: each path the validator reads, with overrides applied.
function build({ files = {}, delete: removed = [], manifest = {} } = {}) {
  const entries = new Map([
    [`${OPENCODE}/index.ts`, "export default {};\n"],
    [`${OPENCODE}/load.ts`, "export {};\n"],
    [`${OPENCODE}/routing.ts`, "export {};\n"],
    ...OPENCODE_AGENTS.map((agent) => [`${OPENCODE}/agents/${agent}.md`, "---\ndescription: a profile\nmode: subagent\n---\n\nBody.\n"]),
    [MAPPING, OPENCODE_AGENTS.map((agent) => `\`${agent}\``).join("\n")],
    ...Object.entries(files),
  ]);
  for (const path of removed) entries.delete(path);
  return {
    manifest: { name: "pstack-opencode", main: "index.ts", dependencies: { "@opencode/plugin": "2.0.18" }, ...manifest },
    read: (rel) => {
      if (!entries.has(rel)) throw new Error(`unexpected read of ${rel}`);
      return entries.get(rel);
    },
    pathExists: (rel) => entries.has(rel),
  };
}

const check = (overrides) => {
  const memory = build(overrides);
  return () => validateOpencodePackage(memory.manifest, memory);
};

describe("the OpenCode runtime row", () => {
  test("uses the mapping file, the package manifest, and no models.json block, preamble, or prompt stubs", () => {
    expect(row.mapping).toBe("opencode-tools.md");
    expect(row.tools).toBe(MAPPING);
    expect(row.manifest).toBe(`${OPENCODE}/package.json`);
    expect(row.notesHeader).toBe("| Skill | On OpenCode |");
    expect(row.key).toBeUndefined();
    expect(row.prompts).toBeUndefined();
    expect(row.preamble).toBeNull();
  });

  test("its Model names section ships no Claude model ID and says subagents take the session model", () => {
    const text = opencodeModelNamesSection(models);
    expect(text).not.toMatch(/claude-[a-z]/);
    expect(text).toContain("runs on the session's current model");
    expect(text).toContain("none of them resolves on OpenCode");
  });

  test("the stamped mapping file carries exactly that section", () => {
    expect(readRepo(MAPPING).replace(/\r\n/g, "\n")).toContain(opencodeModelNamesSection(models));
  });
});

describe("OpenCode routing context", () => {
  test("reminds the session to check T3 tools before dispatch", () => {
    const text = routingInstruction("/plugin/skills/poteto-mode/references/opencode-tools.md");
    expect(text).toContain("Before a pstack dispatch, check the live tool list for the T3 tools and read `t3-tools.md` if they are present.");
    expect(text).not.toMatch(/(?:claude-|gpt-|openai|anthropic|gemini|grok|instance[-/])/i);
  });
});

describe("validateOpencodePackage", () => {
  test("accepts a complete build", () => {
    expect(check({})).not.toThrow();
  });

  test("names each file the entry needs that is missing", () => {
    expect(check({ delete: [`${OPENCODE}/routing.ts`] })).toThrow(`${OPENCODE}/routing.ts is missing; the entry imports it`);
  });

  test("names each agent profile that is missing", () => {
    expect(check({ delete: [`${OPENCODE}/agents/pstack-reviewer.md`] })).toThrow(`${OPENCODE}/agents/pstack-reviewer.md is missing`);
  });

  test("rejects a profile whose frontmatter sets a model", () => {
    const text = "---\ndescription: a profile\nmode: subagent\nmodel: anthropic/claude-sonnet-5-5\n---\n";
    expect(check({ files: { [`${OPENCODE}/agents/pstack-agent.md`]: text } })).toThrow('frontmatter sets "model"');
  });

  test("rejects a profile that is not a subagent, or has no description", () => {
    const primary = "---\ndescription: a profile\nmode: primary\n---\n";
    expect(check({ files: { [`${OPENCODE}/agents/pstack-agent.md`]: primary } })).toThrow('mode must be "subagent", found "primary"');
    const bare = "---\nmode: subagent\n---\n";
    expect(check({ files: { [`${OPENCODE}/agents/pstack-agent.md`]: bare } })).toThrow("needs a description");
  });

  test("rejects a profile with no frontmatter block", () => {
    expect(check({ files: { [`${OPENCODE}/agents/pstack-agent.md`]: "Body only.\n" } })).toThrow("no frontmatter block");
  });

  test("rejects an entry other than index.ts", () => {
    expect(check({ manifest: { main: "src/index.ts" } })).toThrow('main is "src/index.ts", not the entry "index.ts"');
  });

  test("requires the plugin dependency pinned to one exact version", () => {
    for (const pin of ["^2.0.18", "2.0", "latest", undefined]) {
      const dependencies = pin === undefined ? {} : { "@opencode/plugin": pin };
      expect(check({ manifest: { dependencies } })).toThrow('must pin "@opencode/plugin" to one exact version');
    }
  });

  test("requires the mapping file to name every profile it dispatches", () => {
    expect(check({ files: { [MAPPING]: "`pstack-agent` only\n" } })).toThrow(`${MAPPING} does not name the agent \`pstack-reviewer\``);
  });
});

describe("the shipped OpenCode build", () => {
  test("passes the validator on the real tree", () => {
    const manifest = JSON.parse(readRepo(row.manifest));
    expect(() => validateOpencodePackage(manifest, { read: readRepo, pathExists: repoExists })).not.toThrow();
  });

  test("every shipped profile is a subagent with no model key", () => {
    for (const agent of OPENCODE_AGENTS) {
      const block = readRepo(`${OPENCODE}/agents/${agent}.md`).match(/^---\r?\n([\s\S]*?)\r?\n---/)[1];
      const data = Bun.YAML.parse(block);
      expect(Object.hasOwn(data, "model")).toBe(false);
      expect(data.mode).toBe("subagent");
    }
  });

  test("the mapping file names each shipped profile and keeps the notes table header the generator reads", () => {
    const mapping = readRepo(MAPPING);
    for (const agent of OPENCODE_AGENTS) expect(mapping).toContain(`\`${agent}\``);
    expect(mapping).toContain("| Skill | On OpenCode |");
  });
});
