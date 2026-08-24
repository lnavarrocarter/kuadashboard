<template>
  <section class="architecture-routes">
    <header class="routes-header">
      <span><strong>Application routes</strong><small>Event-driven paths derived from confirmed AWS evidence</small></span>
      <span class="route-count">{{ groups.length }} entrypoint{{ groups.length === 1 ? '' : 's' }}</span>
    </header>

    <div v-if="!groups.length" class="routes-empty">
      <i data-lucide="route-off"></i>
      <strong>No event or workflow routes in this diagram</strong>
      <span>Import a candidate containing EventBridge or Step Functions evidence.</span>
    </div>

    <article v-for="group in groups" :key="group.id" class="route-group">
      <header>
        <span class="route-entry-icon"><i :data-lucide="iconFor(group.type)"></i></span>
        <span><strong>{{ group.name }}</strong><small>{{ labelFor(group.type) }}</small></span>
        <button v-if="group.type === 'stepfunctions'" class="btn sm" @click="$emit('inspect-workflow', group.paths[0].nodes[0])">
          <i data-lucide="workflow"></i> Workflow diagram
        </button>
      </header>

      <div v-if="group.config" class="event-structure">
        <span><small>Event bus</small><strong>{{ group.config.eventBus }}</strong></span>
        <span v-if="group.config.scheduleExpression"><small>Schedule</small><code>{{ group.config.scheduleExpression }}</code></span>
        <template v-if="group.config.eventPattern">
          <span v-for="(value, key) in group.config.eventPattern" :key="key">
            <small>{{ key }}</small><code>{{ patternValue(value) }}</code>
          </span>
        </template>
      </div>

      <div class="route-paths">
        <div v-for="path in group.paths" :key="path.id" class="route-path">
          <span v-for="(node, index) in path.nodes" :key="node.id" class="route-segment">
            <button
              :class="['route-node', node.resourceType, { actionable: node.resourceType === 'stepfunctions' }]"
              :disabled="node.resourceType !== 'stepfunctions'"
              @click="node.resourceType === 'stepfunctions' && $emit('inspect-workflow', node)"
            >
              <i :data-lucide="iconFor(node.resourceType)"></i>
              <span><strong>{{ node.name }}</strong><small>{{ labelFor(node.resourceType) }}</small></span>
            </button>
            <span v-if="path.relations[index]" class="route-relation">
              <small>{{ relationLabel(path.relations[index].relationType) }}</small>
              <i data-lucide="arrow-right"></i>
            </span>
          </span>
        </div>
      </div>
    </article>
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { architectureRouteGroups } from '../../lib/architectureRoutes'

const props = defineProps({ graph: { type: Object, required: true } })
defineEmits(['inspect-workflow'])

const groups = computed(() => architectureRouteGroups(props.graph?.document))

function iconFor(type) {
  return { eventbridge: 'radio-tower', sqs: 'list-end', lambda: 'square-function', stepfunctions: 'workflow', ecs: 'container', s3: 'hard-drive' }[type] || 'box'
}

function labelFor(type) {
  return { eventbridge: 'EventBridge event', sqs: 'SQS queue', lambda: 'Lambda', stepfunctions: 'Step Functions workflow', ecs: 'ECS', s3: 'S3' }[type] || type
}

function relationLabel(type) {
  return { triggers: 'triggers', invokes: 'invokes', sends_to: 'sends to', starts_execution: 'starts' }[type]
    || String(type || 'depends_on').replaceAll('_', ' ')
}

function patternValue(value) {
  if (Array.isArray(value)) return value.map(item => typeof item === 'object' ? JSON.stringify(item) : item).join(', ')
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function refreshIcons() { nextTick(() => createIcons({ icons })) }
watch(groups, refreshIcons)
onMounted(refreshIcons)
</script>

<style scoped>
.architecture-routes { border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: var(--bg-panel); }
.routes-header, .route-group > header { min-height: 52px; padding: 10px 12px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--border); }
.routes-header { justify-content: space-between; }
.routes-header > span:first-child, .route-group > header > span:nth-child(2) { display: flex; flex-direction: column; }
.routes-header small, .route-group header small, .route-count { color: var(--text-dim); }
.route-group { border-bottom: 1px solid var(--border); }
.route-group:last-child { border-bottom: 0; }
.route-group > header { background: var(--bg-hover); }
.route-group > header .btn { margin-left: auto; }
.route-entry-icon { width: 32px; height: 32px; display: grid; place-items: center; color: white; background: #1f6feb; border-radius: 5px; }
.route-entry-icon :deep(svg) { width: 16px; height: 16px; }
.event-structure { padding: 8px 12px; display: flex; flex-wrap: wrap; gap: 7px; border-bottom: 1px solid var(--border); }
.event-structure > span { min-width: 130px; padding: 5px 7px; display: flex; flex-direction: column; gap: 2px; border-left: 2px solid #d29922; background: color-mix(in srgb, #d29922 7%, transparent); }
.event-structure small { color: var(--text-dim); text-transform: uppercase; font-size: 9px; }
.event-structure code { color: var(--text); white-space: normal; overflow-wrap: anywhere; }
.route-paths { padding: 12px; display: flex; flex-direction: column; gap: 10px; overflow-x: auto; }
.route-path { min-width: max-content; display: flex; align-items: center; }
.route-segment { display: contents; }
.route-node { width: 190px; min-height: 54px; padding: 7px 9px; display: flex; align-items: center; gap: 8px; color: var(--text); text-align: left; border: 1px solid var(--border); border-radius: 5px; background: var(--bg); }
.route-node > span { display: flex; flex-direction: column; min-width: 0; }
.route-node strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.route-node small { color: var(--text-dim); }
.route-node :deep(svg) { width: 17px; flex: none; color: #58a6ff; }
.route-node.actionable { cursor: pointer; border-color: #2f81f7; }
.route-node:disabled { opacity: 1; }
.route-relation { width: 84px; display: flex; flex-direction: column; align-items: center; color: #58a6ff; }
.route-relation small { color: var(--text-dim); }
.route-relation :deep(svg) { width: 28px; }
.routes-empty { min-height: 260px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; color: var(--text-dim); }
.routes-empty strong { color: var(--text); }
@media (max-width: 760px) { .route-node { width: 165px; } }
</style>