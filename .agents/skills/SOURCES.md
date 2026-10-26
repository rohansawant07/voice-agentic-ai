# UI skill sources

Imported October 26, 2026 using the Codex skill installer. These are development guidance, not application dependencies.

| Local directory | Source | Pinned revision | License supplied upstream |
| --- | --- | --- | --- |
| frontend-design | https://github.com/anthropics/skills/tree/main/skills/frontend-design | dbd4588f9e1033efb41dad4bef2f7947c8993d44 | Apache-2.0; LICENSE.txt retained |
| react-best-practices | https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices | 063bee94c3f4df8453406c830b0a7df0f2860278 | SKILL.md declares MIT |
| web-design-guidelines | https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines | 063bee94c3f4df8453406c830b0a7df0f2860278 | No license declared in this skill; upstream attribution retained |

Frontend Design provides visual direction; React Best Practices covers rendering and loading performance; Web Design Guidelines supports accessibility and interaction reviews. The latter fetches its current external guidelines when used, so those review rules are not pinned by this import.

Also researched: https://github.com/pbakaus/impeccable (broader design workflow with a runtime launcher) and https://github.com/nextlevelbuilder/ui-ux-pro-max-skill (large design datasets and tooling). Both are useful alternatives; the smaller selection above avoids overlapping workflows for this app.

To update, review upstream changes and licenses, install the desired revision into a temporary destination with the skill-installer helper, then replace the corresponding directory and update this table. Do not execute downloaded scripts without inspecting them.
