# Patrocinar KuaDashboard

**KUA — Know Unified Administration** es gratuito y open source. Fue construido para eliminar la fragmentación operativa de gestionar múltiples clouds y clusters Kubernetes desde consolas separadas.

Si KuaDashboard te ahorra tiempo, reduce tu complejidad operativa o ayuda a tu equipo a actuar más rápido — considera apoyar su desarrollo continuo.

> _"No solo un dashboard — un sistema que entiende, organiza y permite operar toda la infraestructura desde un único punto."_

## GitHub Sponsors

<script setup>
const sponsorUrl = 'https://github.com/sponsors/lnavarrocarter'
const paypalUrl  = 'https://paypal.me/NavarroCarter'
const shareText = encodeURIComponent('KuaDashboard — Un dashboard gratuito estilo Lens para Kubernetes + AWS + GCP. ¡Échale un vistazo!')
const shareUrl = encodeURIComponent('https://github.com/lnavarrocarter/kuadashboard')
const twitterUrl = `https://twitter.com/intent/tweet?text=${shareText}&url=${shareUrl}`
const linkedinUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${shareUrl}`
const redditUrl = `https://reddit.com/submit?url=${shareUrl}&title=${shareText}`
</script>

<div class="sponsor-section">
<div class="sponsor-card">
  <div class="sponsor-icon">💖</div>
  <h3>Apoya vía GitHub Sponsors</h3>
  <p>Tu patrocinio va directamente al mantenedor y financia el roadmap de KUA: desde Dashboard a Plataforma de Control a Sistema Inteligente — y eventualmente <strong>AI-driven Cloud Ops</strong>. GitHub <strong>iguala las contribuciones</strong> para desarrolladores elegibles.</p>
  <a :href="sponsorUrl" target="_blank" class="sponsor-btn">💖 Patrocinar en GitHub</a>
</div>
<div class="sponsor-card paypal-card">
  <div class="sponsor-icon">🅿️</div>
  <h3>Donación directa vía PayPal</h3>
  <p>¿Prefieres contribuir con un pago único? Envía cualquier monto vía PayPal — no se requiere cuenta.</p>
  <a :href="paypalUrl" target="_blank" class="sponsor-btn paypal-btn">🅿️ Donar vía PayPal</a>
</div>
</div>

## Costo Real del Open Source

KuaDashboard es gratuito para usar, pero no es gratuito de construir y distribuir. Aquí un desglose transparente de lo que realmente cuesta mantenerlo activo y confiable.

### Tiempo de desarrollo

| Área | Horas invertidas estimadas |
|------|---------------------------|
| Backend principal (rutas K8s, AWS, GCP) | ~300 h |
| Frontend (Vue 3, Pinia, todas las vistas) | ~250 h |
| Empaquetado Electron de escritorio | ~60 h |
| Pipeline CI/CD y automatización de releases | ~40 h |
| Documentación (EN + ES) | ~50 h |
| Firma de código y hardening de seguridad | ~20 h |
| **Total acumulado** | **~720 h** |

A una tarifa de mercado conservadora de $50 USD/h, eso representa más de **$36,000 USD** de trabajo donado a la comunidad.

### Costos operativos anuales

| Concepto | Costo / año (USD) |
|----------|------------------|
| Certificado de firma de código Windows (OV/EV) | $30 – $600 |
| Apple Developer Program (firma + notarización macOS) | $99 |
| Dominio y hosting del sitio de documentación | ~$20 – $50 |
| **Total recurrente** | **~$149 – $749 / año** |

Cada dólar donado se destina a mantener el proyecto firmado, seguro y en evolución.

## Qué Permite Tu Apoyo

La visión de KUA es evolucionar en cuatro etapas. Tu apoyo impulsa ese roadmap:

| Etapa | Objetivo | Estado |
|-------|----------|--------|
| 1. **Dashboard** | Visibilidad unificada K8s + Cloud | ✅ Disponible |
| 2. **Control Platform** | Acciones multi-cloud, RBAC, Helm, deployments | 🔧 En progreso |
| 3. **Intelligent System** | Diagnóstico asistido por IA, análisis de logs, recomendaciones | 💖 Necesita apoyo |
| 4. **AI Ops** | Operaciones automatizadas, alertas inteligentes, auto-reparación | 🚀 Futuro |

| Área | Impacto |
|------|---------|
| **Nuevas Integraciones** | Azure, consola EKS, gestión completa GKE, Step Functions |
| **Builds de Plataforma** | macOS DMG, Linux AppImage, builds ARM nativos |
| **Calidad** | Tests E2E, pipeline CI/CD, accesibilidad |
| **Comunidad** | Documentación, triaje de issues, incorporación de contribuidores |

---

## Otras Formas de Ayudar

### ⭐ Dale una Estrella al Repositorio

Las estrellas ayudan a que KuaDashboard sea descubierto por otros desarrolladores y equipos de operaciones.

<a href="https://github.com/lnavarrocarter/kuadashboard" target="_blank" class="action-btn star-btn">⭐ Dar estrella en GitHub</a>

---

### 🐛 Reporta un Bug o Solicita una Funcionalidad

¿Encontraste algo roto? ¿Tienes una idea? Usa estas plantillas:

<div class="issue-links">
  <a href="https://github.com/lnavarrocarter/kuadashboard/issues/new?template=bug_report.md&title=%5BBUG%5D+&labels=bug" target="_blank" class="action-btn bug-btn">🐛 Reportar un Bug</a>
  <a href="https://github.com/lnavarrocarter/kuadashboard/issues/new?template=feature_request.md&title=%5BFEATURE%5D+&labels=enhancement" target="_blank" class="action-btn feature-btn">💡 Solicitar Funcionalidad</a>
</div>

---

### 📣 Corre la Voz

Comparte KuaDashboard con tu equipo o comunidad:

<div class="share-links">
  <a :href="twitterUrl" target="_blank" class="action-btn twitter-btn">𝕏 Compartir en X / Twitter</a>
  <a :href="linkedinUrl" target="_blank" class="action-btn linkedin-btn">in Compartir en LinkedIn</a>
  <a :href="redditUrl" target="_blank" class="action-btn reddit-btn">👾 Compartir en Reddit</a>
</div>

---

### 🔧 Contribuye al Código

KuaDashboard está abierto a contribuciones. Haz un fork, corrígelo, mejóralo.

**Cómo empezar:**

- **Haz fork del repo**: [github.com/lnavarrocarter/kuadashboard](https://github.com/lnavarrocarter/kuadashboard)
- **Elige un issue abierto**: [`good first issue`](https://github.com/lnavarrocarter/kuadashboard/issues?q=label%3A%22good+first+issue%22) · [`help wanted`](https://github.com/lnavarrocarter/kuadashboard/issues?q=label%3A%22help+wanted%22)
- **Envía un Pull Request** — describe qué cambiaste y por qué
- **Revisa PRs existentes** — la revisión de código también es una contribución valiosa

```bash
# Fork y clonar
git clone https://github.com/TU_USUARIO/kuadashboard.git
cd kuadashboard

# Instalar y ejecutar en modo dev
npm install
npm run dev:full
```

> Revisa la [documentación de Arquitectura](/es/architecture/) para entender cómo se conectan el backend, frontend y la capa Electron antes de contribuir.

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
.paypal-card { margin-top: 1.25rem; }
.paypal-btn  { background: linear-gradient(135deg, #003087, #009cde); }
.paypal-btn:hover { box-shadow: 0 4px 12px rgba(0, 156, 222, 0.4); }
</style>
