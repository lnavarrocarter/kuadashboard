<template>
  <select
    class="ctrl-select vercel-project-select"
    :value="vercelStore.selectedProject?.id || ''"
    :disabled="!vercelStore.activeProfileId || (vercelStore.projectsLoading && !vercelStore.projects.length)"
    :title="vercelStore.selectedProject?.name || t('vercel.header.projectHint')"
    @change="vercelStore.selectProjectById($event.target.value)"
  >
    <option value="">
      {{ vercelStore.projectsLoading && !vercelStore.projects.length ? t('vercel.header.loadingProjects') : t('vercel.header.noProject') }}
    </option>
    <option v-for="p in sortedProjects" :key="p.id" :value="p.id">{{ p.name }}</option>
  </select>
</template>

<script setup>
// Profile -> Project cascade for the Vercel header, like Cluster -> Namespace in
// Kubernetes. It shares vercelStore.selectedProject with the Projects table, so both
// stay in sync, and VercelView reloads the active tab when the project id changes.
import { computed, watch } from 'vue'
import { useVercelStore } from '../../stores/useVercelStore'
import { useI18n } from '../../composables/useI18n'

const { t } = useI18n()
const vercelStore = useVercelStore()

const sortedProjects = computed(() =>
  [...vercelStore.projects].sort((a, b) => String(a.name).localeCompare(String(b.name))))

// Changing profile clears the list; load it here so the project selector is usable
// from any Vercel tab, not only after visiting Projects.
watch(() => vercelStore.activeProfileId, profileId => {
  if (profileId && !vercelStore.projects.length) vercelStore.fetchProjects()
}, { immediate: true })
</script>

<style scoped>
.vercel-project-select { max-width: 220px; }
</style>
