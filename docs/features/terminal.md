# Terminal & Shell

KuaDashboard includes an integrated terminal panel for pod exec sessions, log streams, and local shell access.

## Terminal Panel

The terminal panel sits at the bottom of the main view and supports multiple tabs:

- **Log streams** — Real-time pod log output via WebSocket
- **Exec sessions** — Interactive shell into pods
- **Local shell** — System terminal for local commands

## Pod Logs

Stream logs from any running pod:
1. Select a pod in the resource table
2. Click **Logs** action
3. A new tab opens with live-streaming output

For multi-container pods, select the specific container from the dropdown.

## Pod Exec (Shell)

Open an interactive shell session:
1. Select a pod in the resource table
2. Click **Shell** action
3. A terminal tab opens with a shell prompt

The shell supports:
- Full PTY mode (colors, cursor movement)
- Standard keyboard shortcuts (Ctrl+C, tab completion, etc.)
- Resize on window changes

## Local Shell

Access a local terminal session from the sidebar:
1. Click **Local Shell** in the Tools section
2. A new terminal tab opens with your system shell

This is useful for running `kubectl`, `aws`, `gcloud`, or any other CLI commands without leaving the dashboard.

## Tab Management

- Multiple terminal tabs can be open simultaneously
- Close individual tabs with the × button
- Tabs preserve their content during the session
