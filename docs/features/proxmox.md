---
title: Proxmox VE Inventory
description: Read-only inventory of Proxmox VE clusters and single nodes in KUA, with an API token and a pinned TLS certificate.
---

# Proxmox VE

::: info Next release
Proxmox VE comes with the next KUA release after 2.0.0. Until then, run KUA from the repository (`main`) to try it.
:::


KUA reads a Proxmox VE cluster or a single node and shows it in the **Proxmox** tab: quorum, nodes, QEMU VMs and LXC containers, storage, backup jobs and recent tasks. It only reads: nothing changes in Proxmox, and the reads go to the Proxmox API on your network, with no cloud cost.

## Turn on the plugin

Proxmox is a first-party plugin, off by default. Open **Plugins/Connections** (plug icon in the toolbar) and turn **Proxmox VE** on; the **Proxmox** tab appears in the top bar.

## Create a read-only API token

1. In Proxmox, create a user for KUA (for example `kua@pve`) and give it the **PVEAuditor** role on `/`.
2. Under **Datacenter → Permissions → API Tokens**, add a token for that user with **Privilege Separation** on, and give the token the **PVEAuditor** role too.
3. Copy the token id (`kua@pve!readonly`) and its secret: Proxmox shows the secret only once.

A token of `root@pam`, or one without privilege separation, works but can do much more than KUA needs.

## Add the connection

In the **Proxmox** tab, click **+** (or use the Env Manager and pick **Proxmox VE**) and fill in:

| Field | Value |
|---|---|
| `PROXMOX_URL` | `https://pve.example.lan:8006` (https only, no path) |
| `PROXMOX_TOKEN_ID` | `kua@pve!readonly` |
| `PROXMOX_TOKEN_SECRET` | the token secret |

Then choose how the server certificate is verified. KUA never turns TLS verification off:

- **Pin certificate** (self-signed, the Proxmox default): click **Read the server certificate**. KUA connects without sending any credential and shows the SHA-256 fingerprint. Compare it with the one in Proxmox (node → **System → Certificates**) and click **Pin this fingerprint**. If the certificate changes, KUA refuses to connect and shows the new fingerprint.
- **Own CA**: paste the cluster CA (`/etc/pve/pve-root-ca.pem`) or your own CA in PEM.
- **Trusted certificate**: for a certificate issued by a CA this computer already trusts (ACME/Let's Encrypt).

The secret is kept in the credential store like other profiles, and it never appears in scope ids, history, logs or exports.

## What you see

- **Overview**: quorum, nodes online, VMs, containers, running guests, storage over 85 %, guests without a backup job and failed tasks in the last 24 h.
- **VMs and containers**, **Nodes**, **Storage**, **Backup jobs** and **Recent tasks** tables.

A section the token cannot read says so ("not available") instead of showing zero, and the rest is still shown. The inventory is cached for 30 seconds; **Refresh** reads it again.
