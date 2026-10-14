# T3 tool mapping for pstack

## Detection

Immediately before each dispatch, inspect the live tool list. Use this mapping only when the final name segment `delegate_task` and `orchestrator_capabilities` are both present. Host prefixes vary. Examples include `mcp__t3-code__delegate_task`, `mcp__t3_code__delegate_task`, and, on OpenCode, `tools["t3-code-<hash>"].delegate_task`. Match the final name, not a fixed prefix.

Do not infer T3 from an environment variable or from the host being started by T3. Neither signal is verified. If either tool is absent, follow the host's own mapping unchanged. Do not mention T3.


If the tools disappear during a session, stop new T3 dispatches. Do not duplicate a child whose acceptance is still unclear. Check `task_status` when a task ID is available.

## Tool actions

| pstack action | T3 action |
| --- | --- |
| Dispatch one child | Call `delegate_task` with `mode: "async"`, the role's configured target, and a suitable `role` value. Keep the returned `taskId`. |
| Dispatch a panel or parallel work | Make one `delegate_task` call per entry. |
| Wait for a child | A completed child wakes the thread. Call `task_status` when its result is needed before the thread wakes. |
| Cancel a child | Call `task_cancel`, then check `task_status`. |
| Schedule a later task | Call `schedule_task` with `schedule` as an object, not JSON text. Use `list_scheduled_tasks` to find the task by its title and bound thread. Delete only the matching task when it is no longer needed. |
| Watch a pull request | Call `watch_pull_request`, then end the turn. Call `unwatch_pull_request` when handing the work back. |
| Open a pull request | After it is created, call `link_pull_request` with its full URL. Link every layer of a stack. Before finishing, call `list_thread_pull_requests` and link any pull request from this work that is missing. |

Use `t3_thread_launch` only when the user or a playbook asks for a separate top-level conversation. A delegated child is not a top-level conversation.

## Child dispatch

Every pstack role dispatches through `delegate_task` while this mapping applies. This includes same-family work. A child gets its brief, not the parent's full context. Include file paths and the instructions the child needs.

Use `pstack:<name>` for pstack skills and agents. Do not rename the namespace. Do not reinterpret `pstack:` as another plugin name.

Children must run on provider instances that carry the pstack layer and the access gate. The sheet may name only instances recorded by the machine-local allow-list. The allow-list has this shape:

```json
{
  "instances": {
    "<providerInstanceId>": {
      "layers": ["pstack", "..."],
      "gate": true
    }
  }
}
```

Do not infer that an instance has these layers from its display name.

The entry's options carry effort in T3. The `@<level>` syntax and `pstack:effort-*` agents are for native dispatch only. Copy option IDs and values from `orchestrator_capabilities` for that model.

## The sheet

The sheet is `pstack-t3-models.md` in the active host's config directory. A missing sheet is valid. A role absent from the sheet is also valid. Both mean inherit the parent's model and omit `target` from `delegate_task`.

Use one `role: value` line per configured role. The role must match a role in `plugins/pstack/models.json`. The value is `inherit-parent` or its alias `auto`, or a comma-separated list of entries. An entry is `<providerInstanceId>/<modelId>` followed by zero or more `<optionId>=<value>` tokens. Split at the first slash so the model ID may contain slashes. `session hook: on` and `session hook: off` are allowed. A `default effort` line and any `@<level>` syntax are invalid.

The four panel roles are `arena runners`, `arena cross-judge pool`, `architect runners`, and `interrogate reviewers`. An unset panel role inherits the parent model. A configured panel needs at least two model families. Determine a model's family from the first segment of the model ID's last slash-separated part, before its first hyphen. Different provider instances do not make models from one family diverse.

Validate each entry against a saved `orchestrator_capabilities` result before dispatch. The provider instance must exist and have `canRunChildTask: true`. The model must be listed under that instance. Each option must exist for that model, and its value must be listed for that option. When checking is run with an allow-list, every entry's provider instance must also be listed with the `pstack` layer and `gate: true`.

## Rejections and fallback

If a target is rejected, try only another explicitly configured, validated entry from the same model family. Do not invent a target or option. If no such entry is available, report that role as unavailable.

Use the host's native dispatch only when the T3 tools are absent or T3 definitively refused the request before creating a task. Say when native dispatch follows a definite refusal. After a timeout or an ambiguous acceptance, check `task_status` first. Never retry natively while a T3 child may exist.

If the T3 tools vanish mid-session, stop new T3 dispatches. For a role that has not started, use native dispatch only after confirming T3 did not accept a task. Do not duplicate an in-flight child.

## Parent hosts

Claude Code and Codex are documented as able to dispatch as a parent in T3 by t3-pstack. OpenCode exposes the tools in its live tool list, measured, but a dispatch has not been measured. Copilot and Pi are unknown.

## Per-skill notes

These skills dispatch children, choose role models, schedule work, or watch pull requests. The generator stamps the conditional T3 line on exactly these entry points.

| Skill | On T3 Code |
| --- | --- |
| `arena` | Runner and judge dispatch uses this mapping. |
| `architect` | Runner dispatch uses this mapping. |
| `automate-me` | Parallel transcript readers use this mapping. |
| `babysit` | PR watching and scheduled follow-up use this mapping. |
| `how` | Explorer and explainer dispatch uses this mapping. |
| `interrogate` | Reviewer dispatch uses this mapping. |
| `maintain-verification-skill` | Parallel source readers use this mapping. |
| `no-comments` | Reviewer dispatch uses this mapping. |
| `poteto-mode` | Shared dispatch policy uses this mapping. |
| `reflect` | Reviewer and synthesizer dispatch uses this mapping. |
| `setup-pstack` | T3 capability and role choices use this mapping. |
| `swarm` | Worker dispatch uses this mapping. |
| `teach` | Composed skill dispatch uses this mapping. |
| `thermos` | Review dispatch uses this mapping. |
| `why` | Investigator and synthesizer dispatch uses this mapping. |

The machine-local allow-list is `pstack-t3-instances.json` beside `pstack-t3-models.md` in the active host config directory.

## Source

Adapted from [t3-pstack](https://github.com/chhoumann/t3-pstack) by Christian Bager Bach Houmann, released under the MIT License. The repository root has the license text in `LICENSE-t3-pstack`.
