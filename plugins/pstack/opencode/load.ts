// Reads the shared skills tree for the OpenCode plugin. Pure apart from the
// filesystem reads: no OpenCode import, so the tests load it without the
// package installed.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import type { SkillEditor } from "@opencode/plugin/promise/skill";

// The fields OpenCode brands. Type-only: nothing is imported at runtime.
type SkillInfo = Parameters<SkillEditor["add"]>[0];

export interface SkillSeed {
  id: SkillInfo["id"];
  name: SkillInfo["name"];
  description: string;
  path: SkillInfo["path"];
  content: string;
}

// A frontmatter value as YAML reads it: plain, single-quoted, or double-quoted.
// A double-quoted value uses JSON's escapes, which covers the escapes the
// skills write (\" and \\); anything else keeps its raw text.
function scalar(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
}

// Splits a SKILL.md into its top-level scalar fields and its body. A file with
// no closing fence has no frontmatter, so its whole text is the body.
export function splitFrontmatter(raw: string): { fields: Record<string, string>; body: string } {
  const text = raw.replace(/\r\n/g, "\n");
  const block = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!block) return { fields: {}, body: text };
  const fields: Record<string, string> = {};
  for (const line of block[1].split("\n")) {
    const match = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (match) fields[match[1]] = scalar(match[2].trim());
  }
  return { fields, body: text.slice(block[0].length) };
}

// One seed per directory under `root` that holds a SKILL.md, sorted by
// directory name. A missing root has no skills. This is the one place a file
// system string becomes a branded OpenCode value: the directory name is the
// skill's ID, and the path it reads is absolute, which OpenCode requires.
export function loadSkills(root: string): SkillSeed[] {
  if (!isAbsolute(root)) throw new Error(`skills root must be an absolute path, got ${root}`);
  if (!existsSync(root)) return [];
  const seeds: SkillSeed[] = [];
  for (const entry of readdirSync(root).sort()) {
    const directory = join(root, entry);
    if (!statSync(directory).isDirectory()) continue;
    const file = join(directory, "SKILL.md");
    if (!existsSync(file)) continue;
    const { fields, body } = splitFrontmatter(readFileSync(file, "utf8"));
    seeds.push({
      id: entry as SkillInfo["id"],
      name: (fields.name || entry) as SkillInfo["name"],
      description: fields.description ?? "",
      path: file as SkillInfo["path"],
      content: body,
    });
  }
  return seeds;
}
