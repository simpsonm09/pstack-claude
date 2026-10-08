// The routing instruction the OpenCode plugin adds to every session. The
// Claude Code, Codex, and Copilot hooks inject the same routing text, with the
// runtime's own names; this one points at the OpenCode mapping file instead of
// a separate skill.

// `mappingPath` is the absolute path of references/opencode-tools.md, which the
// plugin resolves from its own location.
export function routingInstruction(mappingPath: string): string {
  return `<EXTREMELY_IMPORTANT>
You have pstack.

Load the \`poteto-mode\` skill with the \`skill\` tool and follow it when a task meets any of these:
- it touches more than one file, or changes a signature other files call
- it involves a design or architecture choice
- it is a bug whose cause is not yet known, or a performance issue

It routes to the right pstack skill from there. For smaller tasks, such as a contained change to one file with an obvious test, a question, or a one-line edit, work directly and verify on the real artifact. When the intent is already specific, enter that skill directly: \`tdd\`, \`architect\`, \`how\`, \`why\`, \`arena\`, \`interrogate\`.

This is OpenCode, not Claude Code. pstack skills name Claude tools and Claude model names. Before following a skill that does, read ${mappingPath} with the \`read\` tool and use its OpenCode equivalents. The mapping is a file, not a skill, so do not look for a separate pstack-opencode skill. A subagent runs on the session's model unless its agent profile names one, so never pass a Claude model name to a subagent.

User instructions (AGENTS.md, direct requests) take precedence.
</EXTREMELY_IMPORTANT>`;
}
