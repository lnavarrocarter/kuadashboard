# KUA for VS Code

See your local [KUA (Know Unified Administration)](https://lnavarrocarter.github.io/kuadashboard/) from the editor, and give the editor's AI chat KUA's tools.

- **Status bar**: whether KUA runs on this computer (version, plan) and whether AI agents are allowed. Click it for the commands.
- **MCP server for the chat, with nothing to configure**: with KUA open, the editor's chat (Copilot in agent mode and any client that uses the VS Code MCP API) gets KUA's tools: profiles, inventory, Advisor, logs and KUA Applications of Kubernetes, AWS, GCP and Vercel. The extension starts the MCP server of the KUA you have installed, so both always have the same version.
- **KUA: Open dashboard** opens the desktop app (or the browser for a KUA run from the repository).
- **KUA: Verify MCP connection** starts the server like the chat does and says what it reached.
- **KUA: Add MCP server to this workspace** writes the `kua` entry to `.vscode/mcp.json`, keeping the other servers, for editors that read that file but not the extension API.

## Requirements

- [KuaDashboard](https://lnavarrocarter.github.io/kuadashboard/download) installed and open. KUA is found by itself, whatever its port; set `kua.url` to use a specific one.
- VS Code 1.101 or later for the chat integration. The commands work in any version.

## Privacy

The extension only talks to the KUA on this computer (`127.0.0.1`). It does not read or store cloud credentials. Agents read through KUA and every change to KUA Applications is previewed and approved in KUA, as for any other agent; turn agents off in KUA's tray panel to refuse them all.
