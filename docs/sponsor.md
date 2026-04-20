# Sponsor KuaDashboard

KuaDashboard is free and open source. If it saves you time or you find it useful, consider supporting the project — it helps keep development active.

## GitHub Sponsors

<script setup>
import { ref, onMounted } from 'vue'

const sponsorUrl = 'https://github.com/sponsors/lnavarrocarter'
</script>

<div class="sponsor-section">

<div class="sponsor-card">
  <div class="sponsor-icon">💖</div>
  <h3>Support via GitHub Sponsors</h3>
  <p>GitHub Sponsors is the easiest way to fund KuaDashboard development. Your sponsorship goes directly to the maintainer — and GitHub <strong>matches contributions</strong> for eligible developers.</p>
  <a :href="sponsorUrl" target="_blank" class="sponsor-btn">
    💖 Sponsor on GitHub
  </a>
</div>

</div>

## What Your Support Enables

| Area | Impact |
|------|--------|
| **New Features** | AWS, GCP, and Azure integrations, RBAC views, Helm chart management |
| **Platform Support** | Linux builds, auto-update, ARM native builds |
| **Quality** | Better testing, CI/CD, accessibility improvements |
| **Community** | Documentation, issue triage, contributor support |

## Other Ways to Help

Not ready to sponsor? You can still help:

- ⭐ **Star the repo** — helps visibility
- 🐛 **Report bugs** — [open an issue](https://github.com/lnavarrocarter/kuadashboard/issues)
- 💬 **Spread the word** — tell your team about KuaDashboard
- 🔧 **Contribute code** — PRs are welcome

<style>
.sponsor-section {
  margin: 2rem 0;
}

.sponsor-card {
  border: 2px solid var(--vp-c-brand-1);
  border-radius: 12px;
  padding: 2rem;
  text-align: center;
  background: var(--vp-c-bg-soft);
  transition: border-color 0.3s, box-shadow 0.3s;
}

.sponsor-card:hover {
  box-shadow: 0 4px 20px rgba(234, 74, 170, 0.15);
}

.sponsor-icon {
  font-size: 3rem;
  margin-bottom: 1rem;
}

.sponsor-card h3 {
  margin: 0.5rem 0;
  font-size: 1.4rem;
}

.sponsor-card p {
  color: var(--vp-c-text-2);
  max-width: 500px;
  margin: 0.8rem auto 1.5rem;
  line-height: 1.6;
}

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

.sponsor-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(234, 74, 170, 0.4);
}
</style>
