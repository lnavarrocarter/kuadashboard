# Sponsor KuaDashboard

**KUA — Know Unified Administration** is free and open source. It was built to eliminate the operational fragmentation of managing multiple clouds and Kubernetes clusters from separate consoles.

If KuaDashboard saves you time, reduces your operational complexity, or helps your team act faster — consider supporting its continued development.

> _"Not just a dashboard — a system that understands, organizes and lets you operate your entire infrastructure from a single point."_

## GitHub Sponsors

<script setup>
const sponsorUrl = 'https://github.com/sponsors/lnavarrocarter'
const shareText = encodeURIComponent('KuaDashboard — A free Lens-like dashboard for Kubernetes + AWS + GCP. Check it out!')
const shareUrl = encodeURIComponent('https://github.com/lnavarrocarter/kuadashboard')
const twitterUrl = `https://twitter.com/intent/tweet?text=${shareText}&url=${shareUrl}`
const linkedinUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${shareUrl}`
const redditUrl = `https://reddit.com/submit?url=${shareUrl}&title=${shareText}`
</script>

<div class="sponsor-section">
<div class="sponsor-card">
  <div class="sponsor-icon">💖</div>
  <h3>Support via GitHub Sponsors</h3>
  <p>Your sponsorship goes directly to the maintainer and funds the KUA roadmap: from Dashboard to Control Platform to Intelligent System — and eventually <strong>AI-driven Cloud Ops</strong>. GitHub <strong>matches contributions</strong> for eligible developers.</p>
  <a :href="sponsorUrl" target="_blank" class="sponsor-btn">💖 Sponsor on GitHub</a>
</div>
</div>

## What Your Support Enables

KUA's vision is to evolve through four stages. Your support drives that roadmap forward:

| Stage | Goal | Status |
|-------|------|--------|
| 1. **Dashboard** | Unified K8s + Cloud visibility | ✅ Released |
| 2. **Control Platform** | Multi-cloud actions, RBAC, Helm, deployments | 🔧 In progress |
| 3. **Intelligent System** | AI-assisted diagnostics, log analysis, recommendations | 💖 Needs support |
| 4. **AI Ops** | Automated operations, smart alerts, self-healing | 🚀 Future |

| Area | Impact |
|------|--------|
| **New Integrations** | Azure, EKS console, GKE full management, Step Functions |
| **Platform Builds** | macOS DMG, Linux AppImage, ARM native |
| **Quality** | E2E tests, CI/CD pipeline, accessibility |
| **Community** | Documentation, issue triage, contributor onboarding |

---

## Other Ways to Help

### ⭐ Star the Repository

Stars help KuaDashboard get discovered by other developers and ops teams.

<a href="https://github.com/lnavarrocarter/kuadashboard" target="_blank" class="action-btn star-btn">⭐ Star on GitHub</a>

---

### 🐛 Report a Bug or Request a Feature

Found something broken? Have an idea? Use these templates:

<div class="issue-links">
  <a href="https://github.com/lnavarrocarter/kuadashboard/issues/new?template=bug_report.md&title=%5BBUG%5D+&labels=bug" target="_blank" class="action-btn bug-btn">🐛 Report a Bug</a>
  <a href="https://github.com/lnavarrocarter/kuadashboard/issues/new?template=feature_request.md&title=%5BFEATURE%5D+&labels=enhancement" target="_blank" class="action-btn feature-btn">💡 Request a Feature</a>
</div>

---

### 📣 Spread the Word

Share KuaDashboard with your team or community:

<div class="share-links">
  <a :href="twitterUrl" target="_blank" class="action-btn twitter-btn">𝕏 Share on X / Twitter</a>
  <a :href="linkedinUrl" target="_blank" class="action-btn linkedin-btn">in Share on LinkedIn</a>
  <a :href="redditUrl" target="_blank" class="action-btn reddit-btn">👾 Share on Reddit</a>
</div>

---

### 🔧 Contribute Code

KuaDashboard is open to contributions. Fork it, fix it, improve it.

**How to get started:**

- **Fork the repo**: [github.com/lnavarrocarter/kuadashboard](https://github.com/lnavarrocarter/kuadashboard)
- **Pick an open issue**: [`good first issue`](https://github.com/lnavarrocarter/kuadashboard/issues?q=label%3A%22good+first+issue%22) · [`help wanted`](https://github.com/lnavarrocarter/kuadashboard/issues?q=label%3A%22help+wanted%22)
- **Submit a Pull Request** — describe what you changed and why
- **Review existing PRs** — code review is a valuable contribution too

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/kuadashboard.git
cd kuadashboard

# Install and run in dev mode
npm install
npm run dev:full
```

> See the [Architecture docs](/architecture/) to understand how the backend, frontend and Electron layer fit together before contributing.

<style>
.sponsor-section { margin: 2rem 0; }
.sponsor-card {
  border: 2px solid var(--vp-c-brand-1);
  border-radius: 12px;
  padding: 2rem;
  text-align: center;
  background: var(--vp-c-bg-soft);
  transition: border-color 0.3s, box-shadow 0.3s;
}
.sponsor-card:hover { box-shadow: 0 4px 20px rgba(234, 74, 170, 0.15); }
.sponsor-icon { font-size: 3rem; margin-bottom: 1rem; }
.sponsor-card h3 { margin: 0.5rem 0; font-size: 1.4rem; }
.sponsor-card p { color: var(--vp-c-text-2); max-width: 520px; margin: 0.8rem auto 1.5rem; line-height: 1.6; }
.sponsor-btn {
  display: inline-block;
  padding: 0.75rem 2rem;
  background: linear-gradient(135deg, #ea4aaa, #db61a2);
  color: white !important;
  border-radius: 8px;
  font-weight: 600;
  font-size: 1.1rem;
  text-decoration: none !important;
  transition: transform 0.2s, box-shadow 0.2s;
}
.sponsor-btn:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(234, 74, 170, 0.4); }
.issue-links, .share-links { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 1rem; }
.action-btn {
  display: inline-block;
  padding: 0.55rem 1.25rem;
  border-radius: 8px;
  font-weight: 600;
  font-size: 0.95rem;
  text-decoration: none !important;
  transition: transform 0.2s, box-shadow 0.2s;
  color: white !important;
}
.action-btn:hover { transform: translateY(-2px); }
.star-btn    { background: #e3a008; }
.bug-btn     { background: #dc2626; }
.feature-btn { background: #2563eb; }
.twitter-btn { background: #000; }
.linkedin-btn { background: #0077b5; }
.reddit-btn  { background: #ff4500; }
</style>
