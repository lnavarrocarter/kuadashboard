<template>
  <BaseModal :show="show" :wide="true" @close="$emit('close')">
    <template #title><i data-lucide="info"></i> KuaDashboard v{{ VERSION }}</template>

    <div class="help-layout">

      <!-- ── Columna izquierda: navegación ─────────────── -->
      <nav class="help-nav">
        <button v-for="tab in TABS" :key="tab.id"
          :class="['help-nav-item', { active: activeTab === tab.id }]"
          @click="activeTab = tab.id">
          <i :data-lucide="tab.icon"></i>
          {{ tab.label }}
        </button>
      </nav>

      <!-- ── Contenido ──────────────────────────────────── -->
      <div class="help-content">

        <!-- About -->
        <div v-show="activeTab === 'about'" class="help-section">
          <div class="about-hero">
            <i data-lucide="layers" class="about-logo-icon"></i>
            <div>
              <div class="about-title">KuaDashboard</div>
              <div class="about-subtitle">v{{ VERSION }} · Dashboard multi-cloud open source</div>
            </div>
          </div>
          <p class="help-p">
            KuaDashboard es un dashboard de administración para Kubernetes, AWS y GCP.
            Gestiona pods, deployments, instancias, lambdas, servicios cloud y más desde una sola interfaz.
          </p>
          <div class="about-links">
            <a class="btn" @click="open('https://github.com/lnavarrocarter/kuadashboard')">
              <i data-lucide="github"></i> GitHub
            </a>
            <a class="btn" @click="open('https://github.com/lnavarrocarter/kuadashboard/blob/main/CHANGELOG.md')">
              <i data-lucide="file-text"></i> CHANGELOG
            </a>
            <a class="btn" @click="open('https://github.com/lnavarrocarter/kuadashboard/releases')">
              <i data-lucide="tag"></i> Releases
            </a>
          </div>

          <div class="donate-card">
            <i data-lucide="heart" class="donate-icon"></i>
            <div>
              <div class="donate-title">¿Te es útil? Considera apoyar el proyecto</div>
              <div class="donate-sub">KuaDashboard es software libre mantenido en tiempo libre. Tu apoyo ayuda a seguir mejorándolo.</div>
            </div>
            <button class="btn primary" @click="open('https://github.com/sponsors/lnavarrocarter/')">
              <i data-lucide="heart"></i> Sponsor
            </button>
          </div>
        </div>

        <!-- Releases / Changelog -->
        <div v-show="activeTab === 'releases'" class="help-section">
          <div class="help-section-header">
            <i data-lucide="tag"></i>
            <h3>Historial de versiones</h3>
          </div>
          <div class="release-list">
            <div v-for="rel in CHANGELOG" :key="rel.version" class="release-block">
              <div class="release-head">
                <span class="release-ver">v{{ rel.version }}</span>
                <span v-if="rel.version === VERSION" class="release-current">actual</span>
                <span class="release-date text-dim">{{ rel.date }}</span>
              </div>
              <ul class="change-list">
                <li v-for="(item, i) in rel.items" :key="i" class="change-item">
                  <span :class="['change-tag', `tag-${item.type}`]">{{ tagLabel(item.type) }}</span>
                  <span>{{ item.text }}</span>
                </li>
              </ul>
            </div>
          </div>
          <div class="help-footer-link">
            <a class="btn sm" @click="open('https://github.com/lnavarrocarter/kuadashboard/releases')">
              <i data-lucide="external-link"></i> Ver todos los releases en GitHub
            </a>
          </div>
        </div>

        <!-- Reportar issue / sugerencia -->
        <div v-show="activeTab === 'feedback'" class="help-section">
          <div class="help-section-header">
            <i data-lucide="message-square"></i>
            <h3>Feedback &amp; soporte</h3>
          </div>
          <p class="help-p">¿Encontraste un bug? ¿Tienes una sugerencia o nueva feature en mente? Abre un issue en GitHub.</p>

          <div class="feedback-cards">
            <div class="feedback-card" @click="open('https://github.com/lnavarrocarter/kuadashboard/issues/new?template=bug_report.md')">
              <i data-lucide="bug" class="feedback-icon red"></i>
              <div>
                <div class="feedback-title">Reportar bug</div>
                <div class="feedback-sub">Algo no funciona como esperas</div>
              </div>
              <i data-lucide="chevron-right" class="feedback-arrow"></i>
            </div>
            <div class="feedback-card" @click="open('https://github.com/lnavarrocarter/kuadashboard/issues/new?template=feature_request.md')">
              <i data-lucide="lightbulb" class="feedback-icon yellow"></i>
              <div>
                <div class="feedback-title">Sugerir feature</div>
                <div class="feedback-sub">Tienes una idea para mejorar el dashboard</div>
              </div>
              <i data-lucide="chevron-right" class="feedback-arrow"></i>
            </div>
            <div class="feedback-card" @click="open('https://github.com/lnavarrocarter/kuadashboard/discussions')">
              <i data-lucide="message-circle" class="feedback-icon blue"></i>
              <div>
                <div class="feedback-title">Discussions</div>
                <div class="feedback-sub">Preguntas, ideas y conversaciones abiertas</div>
              </div>
              <i data-lucide="chevron-right" class="feedback-arrow"></i>
            </div>
          </div>

          <div class="donate-card" style="margin-top:20px">
            <i data-lucide="heart" class="donate-icon"></i>
            <div>
              <div class="donate-title">Apoya el desarrollo</div>
              <div class="donate-sub">Con tu sponsorship podemos dedicar más tiempo a nuevas features y fixes.</div>
            </div>
            <button class="btn primary" @click="open('https://github.com/sponsors/lnavarrocarter/')">
              <i data-lucide="heart"></i> Sponsor
            </button>
          </div>
        </div>

      </div>
    </div>

    <template #footer>
      <span class="text-dim" style="font-size:11px">KuaDashboard v{{ VERSION }} · MIT License</span>
      <button class="btn primary" @click="$emit('close')">Cerrar</button>
    </template>
  </BaseModal>
</template>

<script setup>
import BaseModal from '../BaseModal.vue'

const VERSION = '1.1.1'

defineProps({ show: Boolean })
defineEmits(['close'])

const activeTab = ref('about')

const TABS = [
  { id: 'about',    label: 'Acerca de',  icon: 'info' },
  { id: 'releases', label: 'Releases',   icon: 'tag' },
  { id: 'feedback', label: 'Feedback',   icon: 'message-square' },
]

const CHANGELOG = [
  {
    version: '1.1.1',
    date: 'Abril 2026',
    items: [
      { type: 'new',     text: 'Credenciales AWS y GCP configurables desde el header global (como Kubernetes)' },
      { type: 'new',     text: 'Botón de Local Shell siempre visible en el header (icono de terminal)' },
      { type: 'new',     text: 'Botón de Env Manager en el header, accesible desde cualquier proveedor' },
      { type: 'new',     text: 'Modal de Ayuda con Acerca de, Releases y Feedback/Issues' },
      { type: 'better',  text: 'Iconos SVG uniformes en toda la interfaz (12px)' },
      { type: 'better',  text: 'Botón Refresh en las vistas AWS y GCP con icono' },
      { type: 'better',  text: 'Env Manager accesible desde cualquier proveedor, no sólo Kubernetes' },
    ],
  },
  {
    version: '1.1.0',
    date: 'Abril 2026',
    items: [
      { type: 'new',     text: 'Selectores de credencial AWS y GCP en el header global' },
      { type: 'new',     text: 'Botón de Local Shell siempre visible en el header' },
      { type: 'new',     text: 'Botón de Env Manager en el header, accesible desde cualquier proveedor' },
      { type: 'new',     text: 'Navegación lateral (sidebar) para AWS y GCP' },
      { type: 'new',     text: 'Soporte para AWS Step Functions con visualización de diagramas' },
      { type: 'new',     text: 'Soporte para AWS EventBridge — reglas, logs y métricas' },
      { type: 'new',     text: 'Soporte para AWS API Gateway — rutas e integraciones' },
      { type: 'new',     text: 'GCP Pub/Sub — gestiona tópicos' },
      { type: 'new',     text: 'GCP Cloud Functions — invoca y monitorea funciones' },
      { type: 'better',  text: 'SSH directo a instancias EC2 desde el dashboard' },
      { type: 'better',  text: 'Terminal local integrada con múltiples pestañas' },
      { type: 'better',  text: 'Port-forward ahora persiste entre sesiones' },
    ],
  },
  {
    version: '1.0.0',
    date: 'Enero 2026',
    items: [
      { type: 'new',     text: 'Dashboard Kubernetes con gestión de Pods, Deployments, Services y más' },
      { type: 'new',     text: 'Soporte multi-contexto y multi-namespace' },
      { type: 'new',     text: 'Vista AWS — EC2, ECS, EKS, Lambda, S3, ECR, VPC' },
      { type: 'new',     text: 'Vista GCP — Cloud Run, GKE, Compute VMs, Cloud SQL, Storage' },
      { type: 'new',     text: 'Env Manager para gestionar perfiles de credenciales cifradas' },
      { type: 'new',     text: 'Port forwarding visual' },
      { type: 'new',     text: 'Logs en streaming y terminal exec para pods' },
    ],
  },
]

function tagLabel(t) {
  return { new: 'Nuevo', better: 'Mejora', fix: 'Fix' }[t] ?? t
}

function open(url) {
  if (window.kuaElectron?.openExternal) window.kuaElectron.openExternal(url)
  else window.open(url, '_blank')
}

import { ref } from 'vue'
</script>

<style scoped>
.help-layout {
  display: flex;
  gap: 0;
  min-height: 380px;
}

/* Nav */
.help-nav {
  width: 140px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 8px 4px 0;
}
.help-nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: background .12s, color .12s;
}
.help-nav-item i, .help-nav-item svg { width: 13px; height: 13px; flex-shrink: 0; }
.help-nav-item:hover { background: var(--bg-hover); color: var(--text); }
.help-nav-item.active { background: var(--bg-sel); color: #fff; }

/* Content */
.help-content {
  flex: 1;
  padding: 0 0 0 20px;
  overflow-y: auto;
}
.help-section { display: flex; flex-direction: column; gap: 14px; }
.help-section-header {
  display: flex; align-items: center; gap: 8px;
  color: var(--text);
}
.help-section-header i, .help-section-header svg { width: 14px; height: 14px; color: var(--accent); }
.help-section-header h3 { font-size: 14px; font-weight: 600; }

.help-p { font-size: 13px; color: var(--text-dim); line-height: 1.6; }

/* About */
.about-hero {
  display: flex; align-items: center; gap: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}
.about-logo-icon { width: 32px !important; height: 32px !important; color: var(--accent); }
.about-title { font-size: 16px; font-weight: 700; color: var(--text); }
.about-subtitle { font-size: 12px; color: var(--text-dim); margin-top: 2px; }
.about-links { display: flex; gap: 8px; flex-wrap: wrap; }
.about-links .btn { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.about-links .btn i, .about-links .btn svg { width: 12px; height: 12px; }

/* Donate card */
.donate-card {
  display: flex;
  align-items: center;
  gap: 14px;
  background: rgba(255,64,129,.08);
  border: 1px solid rgba(255,64,129,.25);
  border-radius: 6px;
  padding: 14px;
}
.donate-icon { width: 20px !important; height: 20px !important; color: #ff4081; flex-shrink: 0; }
.donate-title { font-size: 13px; font-weight: 600; color: var(--text); }
.donate-sub { font-size: 12px; color: var(--text-dim); margin-top: 2px; line-height: 1.5; }
.donate-card .btn { flex-shrink: 0; display: flex; align-items: center; gap: 6px; cursor: pointer; }
.donate-card .btn i, .donate-card .btn svg { width: 12px; height: 12px; }

/* Releases */
.release-list { display: flex; flex-direction: column; gap: 16px; max-height: 340px; overflow-y: auto; padding-right: 4px; }
.release-head {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 8px;
}
.release-ver { font-size: 13px; font-weight: 700; color: var(--accent); }
.release-current {
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  background: rgba(14,157,232,.2); color: var(--accent);
  padding: 1px 6px; border-radius: 3px;
}
.release-date { font-size: 11px; }
.change-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 5px; }
.change-item { display: flex; align-items: baseline; gap: 8px; font-size: 12px; line-height: 1.5; }
.change-tag {
  display: inline-block; font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .4px; padding: 1px 5px; border-radius: 3px; flex-shrink: 0;
}
.tag-new    { background: rgba(78,201,176,.18); color: #4ec9b0; }
.tag-better { background: rgba(14,157,232,.18); color: #0e9de8; }
.tag-fix    { background: rgba(255,152,0,.18);  color: #ff9800; }

.help-footer-link { display: flex; justify-content: flex-end; }
.help-footer-link .btn { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.help-footer-link .btn i, .help-footer-link .btn svg { width: 12px; height: 12px; }

/* Feedback */
.feedback-cards { display: flex; flex-direction: column; gap: 8px; }
.feedback-card {
  display: flex; align-items: center; gap: 14px;
  background: var(--bg-row);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px 14px;
  cursor: pointer;
  transition: border-color .15s, background .15s;
}
.feedback-card:hover { border-color: var(--accent); background: var(--bg-hover); }
.feedback-icon { width: 18px !important; height: 18px !important; flex-shrink: 0; }
.feedback-icon.red    { color: var(--red); }
.feedback-icon.yellow { color: var(--yellow); }
.feedback-icon.blue   { color: var(--accent); }
.feedback-title { font-size: 13px; font-weight: 600; color: var(--text); }
.feedback-sub { font-size: 11px; color: var(--text-dim); margin-top: 2px; }
.feedback-arrow { width: 14px !important; height: 14px !important; color: var(--text-dim); margin-left: auto; flex-shrink: 0; }

.text-dim { color: var(--text-dim); }
</style>
