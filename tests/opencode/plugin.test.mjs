// The OpenCode plugin entry. Its frontmatter parser, skill loader, and routing
// text are pure and tested directly. The entry itself runs against a stub
// OpenCode context, and the package import is replaced, so no OpenCode install
// is needed to run these tests.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { agentSkills } from "../../tools/generate.mjs";

mock.module("@opencode/plugin", () => ({ Plugin: { define: (definition) => definition } }));
const { default: plugin, MAPPING_PATH, SKILLS_ROOT } = await import("../../plugins/pstack/opencode/index.ts");
const { loadSkills, splitFrontmatter } = await import("../../plugins/pstack/opencode/load.ts");
const { routingInstruction } = await import("../../plugins/pstack/opencode/routing.ts");

const skillsDir = fileURLToPath(new URL("../../plugins/pstack/skills", import.meta.url));

describe("splitFrontmatter", () => {
  test("reads plain, single-quoted, and double-quoted scalars, keeping a colon inside a value", () => {
    const text = `---\nname: how\ndescription: 'It''s plain: a colon'\nnote: "say \\"hi\\"\\n"\n---\nBody\n`;
    const { fields } = splitFrontmatter(text);
    expect(fields).toEqual({ name: "how", description: "It's plain: a colon", note: 'say "hi"\n' });
  });

  test("returns the text after the closing fence as the body", () => {
    expect(splitFrontmatter("---\nname: x\n---\nBody\n").body).toBe("Body\n");
    expect(splitFrontmatter("---\nname: x\n---").body).toBe("");
  });

  test("treats a file with no closing fence as all body", () => {
    const text = "---\nname: x\n";
    expect(splitFrontmatter(text)).toEqual({ fields: {}, body: text });
  });

  test("reads CRLF text the same as LF text", () => {
    expect(splitFrontmatter("---\r\nname: x\r\n---\r\nBody\r\n").fields).toEqual({ name: "x" });
    expect(splitFrontmatter("---\r\nname: x\r\n---\r\nBody\r\n").body).toBe("Body\n");
  });

  test("keeps the raw text of a double-quoted value that JSON cannot read", () => {
    expect(splitFrontmatter('---\ndescription: "bad \\x"\n---\n').fields.description).toBe("bad \\x");
  });
});

describe("loadSkills", () => {
  let root;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pstack-opencode-skills-"));
    mkdirSync(join(root, "alpha"));
    writeFileSync(join(root, "alpha", "SKILL.md"), "---\nname: alpha\ndescription: first skill\n---\n# Alpha\n");
    mkdirSync(join(root, "beta"));
    writeFileSync(join(root, "beta", "SKILL.md"), "# Beta has no frontmatter\n");
    mkdirSync(join(root, "empty"));
    writeFileSync(join(root, "loose.md"), "not a skill directory\n");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test("loads each directory that holds a SKILL.md, sorted, and skips the rest", () => {
    const seeds = loadSkills(root);
    expect(seeds.map((s) => s.id)).toEqual(["alpha", "beta"]);
    expect(seeds[0]).toEqual({
      id: "alpha",
      name: "alpha",
      description: "first skill",
      path: join(root, "alpha", "SKILL.md"),
      content: "# Alpha\n",
    });
  });

  test("names a skill by its directory when its frontmatter has no name or description", () => {
    expect(loadSkills(root)[1]).toMatchObject({ name: "beta", description: "", content: "# Beta has no frontmatter\n" });
  });

  test("a missing root has no skills", () => {
    expect(loadSkills(join(root, "missing"))).toEqual([]);
  });

  test("refuses a relative root, because OpenCode needs each skill path absolute", () => {
    expect(() => loadSkills("skills")).toThrow("skills root must be an absolute path, got skills");
  });
});

describe("the shared skills tree", () => {
  test("every skill's id, name, and description match the generator's YAML reading", () => {
    const seeds = loadSkills(SKILLS_ROOT);
    const expected = agentSkills(skillsDir);
    expect(seeds.length).toBeGreaterThan(0);
    expect(seeds.map((s) => [s.id, s.name, s.description])).toEqual(expected.map((s) => [s.name, s.name, s.description]));
  });

  test("the mapping file the routing text names exists under the shared tree", () => {
    expect(MAPPING_PATH).toBe(join(SKILLS_ROOT, "poteto-mode", "references", "opencode-tools.md"));
    expect(existsSync(MAPPING_PATH)).toBe(true);
  });
});

describe("routingInstruction", () => {
  const mapping = "/install/skills/poteto-mode/references/opencode-tools.md";
  const text = routingInstruction(mapping);

  test("names the mapping file it was given, and sends the agent to it instead of a separate skill", () => {
    expect(text).toContain(`read ${mapping} with the \`read\` tool`);
    expect(text).toContain("do not look for a separate pstack-opencode skill");
    expect(text).not.toContain("Load `pstack-opencode`");
  });

  test("loads poteto-mode with the skill tool when a task meets the routing criteria", () => {
    expect(text).toContain("Load the `poteto-mode` skill with the `skill` tool");
    expect(text.startsWith("<EXTREMELY_IMPORTANT>")).toBe(true);
    expect(text.endsWith("</EXTREMELY_IMPORTANT>")).toBe(true);
  });

  test("passes no Claude model name to a subagent", () => {
    expect(text).toContain("never pass a Claude model name to a subagent");
    expect(text).not.toMatch(/claude-[a-z]|\b(?:opus|sonnet|haiku|fable)\b/);
  });
});

// A stand-in for OpenCode's plugin context: it records the skills the entry
// registers and the context hook it installs.
function stubContext({ options, existing = [] } = {}) {
  const ctx = {
    options,
    added: [],
    removed: [],
    hooks: [],
    editor: {
      get: (id) => (existing.includes(id) ? { id } : undefined),
      add: (skill) => ctx.added.push(skill),
      remove: (id) => ctx.removed.push(id),
    },
    skill: {
      transform: async (edit) => {
        await edit(ctx.editor);
      },
    },
    session: {
      hook: async (name, handler) => {
        ctx.hooks.push({ name, handler });
      },
    },
  };
  return ctx;
}

describe("the plugin entry", () => {
  test("is the pstack-opencode plugin, with a setup function", () => {
    expect(plugin.id).toBe("pstack-opencode");
    expect(typeof plugin.setup).toBe("function");
  });

  test("registers every shared skill by directory name, with its content", async () => {
    const ctx = stubContext({});
    await plugin.setup(ctx);
    const seeds = loadSkills(SKILLS_ROOT);
    expect(ctx.added.map((s) => s.id)).toEqual(seeds.map((s) => s.id));
    expect(ctx.added[0]).toEqual({
      id: seeds[0].id,
      name: seeds[0].name,
      description: seeds[0].description,
      path: seeds[0].path,
      content: seeds[0].content,
    });
    expect(ctx.removed).toEqual([]);
  });

  test("replaces a skill that is already registered under the same id", async () => {
    const ctx = stubContext({ existing: ["poteto-mode"] });
    await plugin.setup(ctx);
    expect(ctx.removed).toEqual(["poteto-mode"]);
    expect(ctx.added.map((s) => s.id)).toContain("poteto-mode");
  });

  test("adds the routing text to every session's context", async () => {
    const ctx = stubContext({});
    await plugin.setup(ctx);
    expect(ctx.hooks.map((h) => h.name)).toEqual(["context"]);
    const event = { system: [] };
    ctx.hooks[0].handler(event);
    expect(event.system).toEqual([{ type: "text", text: routingInstruction(MAPPING_PATH) }]);
  });

  test("routing false registers no context hook but still registers the skills", async () => {
    const ctx = stubContext({ options: { routing: false } });
    await plugin.setup(ctx);
    expect(ctx.hooks).toEqual([]);
    expect(ctx.added.length).toBeGreaterThan(0);
  });

  test("an absent options object keeps routing on", async () => {
    const ctx = stubContext(undefined);
    await plugin.setup(ctx);
    expect(ctx.hooks.map((h) => h.name)).toEqual(["context"]);
  });
});
