// The pstack OpenCode plugin. It registers the shared skills tree and adds the
// routing instruction to every session. The agent profiles in agents/ are not
// loaded here: the workspace installer copies them into .opencode/agents.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Plugin } from "@opencode/plugin";

import { loadSkills } from "./load.ts";
import { routingInstruction } from "./routing.ts";

// This entry lives in plugins/pstack/opencode/, so the shared tree is ../skills.
const here = dirname(fileURLToPath(import.meta.url));
export const SKILLS_ROOT = join(here, "..", "skills");
export const MAPPING_PATH = join(SKILLS_ROOT, "poteto-mode", "references", "opencode-tools.md");

export default Plugin.define({
  id: "pstack-opencode",
  async setup(ctx) {
    const skills = loadSkills(SKILLS_ROOT);
    if (skills.length === 0) {
      console.warn(`pstack: no skills under ${SKILLS_ROOT}; the skills tree must sit beside the plugin directory`);
    } else {
      await ctx.skill.transform((editor) => {
        for (const skill of skills) {
          if (editor.get(skill.id)) editor.remove(skill.id);
          editor.add({
            id: skill.id,
            name: skill.name,
            description: skill.description,
            path: skill.path,
            content: skill.content,
          });
        }
      });
    }

    if ((ctx.options as { routing?: boolean } | undefined)?.routing !== false) {
      const text = routingInstruction(MAPPING_PATH);
      await ctx.session.hook("context", (event) => {
        event.system.push({ type: "text", text });
      });
    }
  },
});
