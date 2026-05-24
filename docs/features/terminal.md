# Terminal & Shell

KuaDashboard includes a powerful integrated terminal panel that gives you full interactive access to pod shells, log streams, EC2 SSH/RDP sessions and a local system shell — all from within the same window.

![KuaDashboard — pod overview](/screenshots/dashboard-pods.png)

## Overview

The terminal panel sits at the bottom of the main view and supports **multiple simultaneous tabs**, each colour-coded by context:

| Context | Colour | Description |
| --- | --- | --- |
| `pod` | Blue | Live log stream from a Kubernetes pod |
| `workload` | Blue | Live log stream resolved from a Deployment, StatefulSet or DaemonSet selector |
| `exec` | Purple | Interactive shell session inside a pod |
| `local` | Green | Local system shell (bash / zsh / PowerShell) |
| `ec2` | Teal | Browser-based SSH/RDP session to an EC2 instance |

---

## Opening a Terminal Tab

### Pod and Workload Logs

Stream real-time logs from any running pod or supported workload:

1. Select a pod, deployment, statefulset or daemonset in the Kubernetes resource table
2. Click the **Logs** action
3. A new tab opens with live-streaming output via WebSocket

For **multi-container pods**, select the container from the dropdown in the terminal header.

For workloads, KuaDashboard resolves the current pods using the resource selector and prefixes each line with the source pod name when multiple pods are streaming.

Toggle **Prev** in the toolbar to also include log output from the previous container instance (useful after a crash restart).

Use the search button in the toolbar to filter log output by text, date/time range or both. Filtered logs can be downloaded as a `.log` file.

### Pod Exec (Shell)

Open an interactive shell session directly inside a pod:

1. Select a pod in the Kubernetes resource table
2. Click the **Shell** action
3. A terminal tab opens with a live PTY shell

The exec session supports:

- Full PTY mode (colours, cursor movement, terminal resize)
- Container selection for multi-container pods
- Standard keyboard shortcuts (Ctrl+C, Ctrl+D, Tab completion)

### Local Shell

Access a local system shell without leaving the dashboard:

1. Click **Local Shell** in the **Tools** section of the sidebar
2. A terminal tab opens with your system shell (bash / zsh / PowerShell)

Use the local shell for running `kubectl`, `aws`, `gcloud`, `helm`, or any CLI tools without switching windows.

### EC2 SSH/RDP

Open a browser-based SSH or RDP session to any running EC2 instance:

1. Go to **Cloud > AWS > EC2** tab
2. Click **SSH** for Linux instances or **RDP** for Windows instances
3. A remote session opens with the proper connection form

Remote sessions are persistent. Closing the session window only hides it; the WebSocket remains alive and the session can be restored from the floating remote-session dock. Use **Disconnect** inside the session, or close the dock tab, when you want to end it.

---

## Terminal Toolbar

The header toolbar provides quick controls for the active tab:

| Control | Description |
| --- | --- |
| Container selector | Switch container in multi-container pod sessions |
| **Prev** toggle | Include logs from the previous container instance (log tabs only) |
| Search / filters | Filter logs by text and serialized date range |
| Download | Export the current filtered log view to a `.log` file |
| ✦ Clear | Erase all current output in the active tab |
| ⏎ Wrap text | Toggle line wrapping for long log lines |
| ↓ Scroll to end | Jump to the bottom of the output buffer |
| 📁 File browser | Toggle the side file browser (local shell tabs only) |
| ? Keyboard shortcuts | Toggle the keyboard shortcut help overlay |
| ■ Stop | Send SIGINT / terminate the active stream or session |
| ⬡ Pop out | Detach the terminal into a floating browser window |
| — Minimise | Collapse the panel to just the tab bar |
| × Close all | Close all open terminal tabs |

---

## Input Bar

Shell tabs (exec, local, EC2) display an input bar at the bottom with:

- **Command prompt** (❯) — green when connected, grey when disconnected
- **Command input field** — type your command and press Enter to send
- **Suggestion chip** — shown when an autocomplete suggestion is available; click to apply
- **✕ Interrupt** — send Ctrl+C to terminate the running command

### Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `↑` / `↓` | Navigate command history |
| `Tab` | Path autocomplete |
| `Enter` | Send command |
| `Ctrl+C` | Interrupt (SIGINT) |
| `Ctrl+D` | EOF / close session |
| `Ctrl+L` | Clear output |

---

## File Browser (Local Shell)

When a **local shell** tab is active, click the 📁 button to open the inline file browser panel on the left side of the terminal.

| Action | Description |
| --- | --- |
| Click a 📁 folder | Navigate into the directory (also runs `cd` in the shell) |
| Click a 📄 file | Preview the file contents in the terminal output |
| Double-click a file | Insert the full file path into the command input |
| Click `↑` (top entry) | Navigate to the parent directory |
| Click ↻ (breadcrumb) | Refresh the current directory listing |

A breadcrumb trail shows your current location. The active working directory is also shown in the terminal footer.

---

## Output Highlighting

Log lines are colour-coded automatically to help you spot issues at a glance:

| Colour | Meaning |
| --- | --- |
| 🔴 Red | Error / exception / stderr |
| 🟡 Yellow | Warning |
| 🟢 Green | Success / OK |
| ⚫ Dim | System / meta messages |

---

## Footer

The footer bar at the bottom of the panel shows:

- **Status text** — connection state (Connected, Reconnecting, Stopped, etc.)
- **Working directory** — current `cwd` for local shell tabs
- **Line count** — total number of output lines in the current tab

---

## Panel Resize

Drag the **resize handle** at the top edge of the terminal panel to adjust its height. The height is preserved while the panel is open. Click **—** to collapse it to just the tab bar, and click **—** again to restore it.

---

## Multiple Tabs

You can have as many terminal tabs open as needed:

- Log multiple pods simultaneously
- Keep a local shell open alongside an exec session
- Switch between tabs instantly with a single click
- Close individual tabs with the **✕** button on each tab
- Tab content is preserved in memory while the tab is not active

---

## Common CLI Commands (Quick Reference)

| Command | Purpose |
| --- | --- |
| `ls -la` | List files with details |
| `pwd` | Show current directory |
| `env` | Print environment variables |
| `ps aux` | Show running processes |
| `cat /etc/os-release` | OS / distro information |
| `df -h` | Disk usage by mount point |
| `top` / `htop` | CPU and memory usage |
| `curl -I <url>` | HTTP response headers check |
