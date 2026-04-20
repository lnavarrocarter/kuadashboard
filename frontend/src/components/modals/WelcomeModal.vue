<template>
  <BaseModal :show="visible" @close="dismiss">
    <template #title>🚀 Novedades en KuaDashboard v{{ version }}</template>

    <div class="welcome-changelog">
      <div v-for="(release, idx) in changelog" :key="release.version" class="release-block">
        <h3 class="release-version" v-if="idx > 0">v{{ release.version }}</h3>
        <ul class="change-list">
          <li v-for="(item, i) in release.items" :key="i" class="change-item">
            <span :class="['change-tag', `tag-${item.type}`]">{{ tagLabel(item.type) }}</span>
            <span>{{ item.text }}</span>
          </li>
        </ul>
      </div>
    </div>

    <template #footer>
      <button class="btn primary" @click="dismiss">¡Entendido!</button>
    </template>
  </BaseModal>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import BaseModal from '../BaseModal.vue'

const STORAGE_KEY = 'kuadashboard_last_seen_version'
const version = '1.1.1'

const visible = ref(false)

const changelog = [
  {
    version: '1.1.1',
    items: [
      { type: 'new',     text: 'Credenciales AWS y GCP configurables desde el header global (como Kubernetes)' },
      { type: 'new',     text: 'Botón de Local Shell siempre visible en el header (icono de terminal)' },
      { type: 'new',     text: 'Botón de Env Manager en el header, accesible desde cualquier proveedor' },
      { type: 'new',     text: 'Modal de Ayuda con Acerca de, Releases y Feedback/Issues' },
      { type: 'better',  text: 'Iconos SVG uniformes en toda la interfaz (12px)' },
      { type: 'better',  text: 'Botón Refresh en las vistas AWS y GCP con icono' },
      { type: 'better',  text: 'Env Manager ahora funciona desde cualquier proveedor, no sólo Kubernetes' },
    ],
  },
  {
    version: '1.1.0',
    items: [
      { type: 'new',     text: 'Navegación lateral (sidebar) para AWS y GCP — misma experiencia que Kubernetes' },
      { type: 'new',     text: 'Soporte para AWS Step Functions — visualiza máquinas de estado y diagramas' },
      { type: 'new',     text: 'Soporte para AWS EventBridge — reglas, logs y métricas' },
      { type: 'new',     text: 'Soporte para AWS API Gateway — rutas e integraciones' },
      { type: 'new',     text: 'GCP Pub/Sub — gestiona tópicos directamente' },
      { type: 'new',     text: 'GCP Cloud Functions — invoca y monitorea funciones' },
      { type: 'better',  text: 'SSH directo a instancias EC2 desde el dashboard' },
      { type: 'better',  text: 'Terminal local integrada con múltiples pestañas' },
      { type: 'better',  text: 'Port-forward ahora persiste entre sesiones' },
      { type: 'better',  text: 'Panel de novedades al actualizar (lo estás viendo ahora 😉)' },
    ],
  },
  {
    version: '1.0.0',
    items: [
      { type: 'new',     text: 'Dashboard Kubernetes con gestión de Pods, Deployments, Services y más' },
      { type: 'new',     text: 'Soporte multi-contexto y multi-namespace' },
      { type: 'new',     text: 'Vista AWS — EC2, ECS, EKS, Lambda, S3, ECR, VPC' },
      { type: 'new',     text: 'Vista GCP — Cloud Run, GKE, Compute VMs, Cloud SQL, Storage' },
      { type: 'new',     text: 'Env Manager para gestionar perfiles de credenciales' },
      { type: 'new',     text: 'Port forwarding visual con soporte drag & drop' },
      { type: 'new',     text: 'Logs en streaming y terminal exec para pods' },
    ],
  },
]

function tagLabel(type) {
  if (type === 'new')    return 'Nuevo'
  if (type === 'better') return 'Mejora'
  if (type === 'fix')    return 'Fix'
  return type
}

function dismiss() {
  visible.value = false
  localStorage.setItem(STORAGE_KEY, version)
}

onMounted(() => {
  const lastSeen = localStorage.getItem(STORAGE_KEY)
  if (lastSeen !== version) {
    setTimeout(() => { visible.value = true }, 1200)
  }
})
</script>

<style scoped>
.welcome-changelog {
  max-height: 400px;
  overflow-y: auto;
  padding-right: 4px;
}
.release-block { margin-bottom: 16px; }
.release-version {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-dim);
  margin-bottom: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.change-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.change-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
  line-height: 1.5;
}
.change-tag {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .5px;
  padding: 1px 6px;
  border-radius: 3px;
  flex-shrink: 0;
}
.tag-new    { background: rgba(78, 201, 176, .18); color: #4ec9b0; }
.tag-better { background: rgba(14, 157, 232, .18); color: #0e9de8; }
.tag-fix    { background: rgba(255, 152, 0, .18);  color: #ff9800; }
</style>
