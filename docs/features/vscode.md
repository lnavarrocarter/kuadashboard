---
title: KUA for VS Code
description: The KUA extension for VS Code shows the local KUA in the status bar and gives the editor's AI chat KUA's MCP tools with nothing to configure.
---

# KUA for VS Code

::: info Next release
The KUA extension for VS Code comes with the next KUA release after 2.0.0, which attaches its `.vsix` to the release. Until then, build it from the repository with `npm ci && npm run package` in `vscode/`.
:::


The KUA extension brings your local KUA into VS Code:

- **Status bar**: whether KUA runs on this computer, its version and plan, and whether AI agents are allowed. Click it for the commands.
- **MCP server for the chat**: with KUA open, the editor's chat (Copilot in agent mode and any client that uses the VS Code MCP API) gets KUA's [tools](./ai-agents#tools) without editing any file. The extension starts the MCP server of the KUA you have installed, so both always have the same version. With KUA closed the server still starts and tells the agent to open KUA.
- **Applications view**: the KUA icon of the activity bar lists your KUA Applications with what needs attention (the same text as KUApps: thresholds broken, resources that no longer exist, failed collections), their resources with the signal state, and the product Advisor. The application of this workspace comes first and expanded: the one set in `kua.application` (**Link this workspace to a KUA Application** in the view), or the only one whose GitHub repository, set in KUA or declared by its workloads, matches the workspace's `origin`. Each item has **Open in KUA** (that application and tab in KUA) and **Send to chat**, which gives the editor's chat KUA's brief of an issue, an Advisor finding or the whole Advisor, without credentials or raw logs; in an editor without a chat the brief is copied. The view is refreshed when the window gets focus, when KUA starts or stops and with its refresh button, and only reads KUA's local API.
- **KUA: Open dashboard** opens the desktop app (`kua://open`), or the browser for a KUA run from the repository. Setting `kua.openIn` chooses `app` or `browser`.
- **KUA: Verify MCP connection** starts the server like the chat does and reports the tools and profiles it reached, or the error.
- **KUA: Add MCP server to this workspace** writes the `kua` entry to `.vscode/mcp.json`, keeping other servers and comments, for editors that read that file but not the extension API. An invalid file is not overwritten.

## Install

Until the extension is in the Marketplace and Open VSX, install the `.vsix` from the release: **Extensions → … → Install from VSIX…**. It needs VS Code 1.101 or later for the chat integration.

KUA is found by itself, whatever its port (the same way as the MCP server). Set `kua.url` (for example `http://localhost:7192`) to use a specific one.

The extension runs on the computer where KUA runs, also when the editor is connected to Remote SSH, WSL or a Dev Container.

## Privacy

The extension only talks to the KUA on this computer (`127.0.0.1`) and does not read or store cloud credentials. Agents read through KUA, every change to KUA Applications is previewed and approved in KUA, and turning agents off in KUA's tray panel refuses them all.
