<template>
  <div class="sfn-diagram" ref="wrap">
    <div v-if="error" class="sfn-error">{{ error }}</div>
    <div v-else-if="!nodes.length" class="sfn-empty">No states found in definition.</div>
    <div v-else class="sfn-scroll-area" :style="{ overflowX: svgW > wrapW ? 'auto' : 'hidden', overflowY: 'auto' }">
      <svg
        :width="svgW" :height="svgH"
        :viewBox="`${vbX} ${vbY} ${svgW} ${svgH}`"
        xmlns="http://www.w3.org/2000/svg"
        class="sfn-svg"
      >
        <defs>
          <marker id="sfn-arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#666" />
          </marker>
          <marker id="sfn-arrow-catch" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#f59e0b" />
          </marker>
        </defs>

        <!-- START indicator -->
        <circle :cx="startPos.x" :cy="startPos.y - NW/2 - 22" r="8" fill="#22c55e" />
        <line
          :x1="startPos.x" :y1="startPos.y - NW/2 - 14"
          :x2="startPos.x" :y2="startPos.y - NH/2"
          stroke="#22c55e" stroke-width="2"
          marker-end="url(#sfn-arrow)"
        />

        <!-- Edges -->
        <g v-for="(e, ei) in edges" :key="ei">
          <path
            :d="edgePath(e)"
            fill="none"
            :stroke="e.type === 'catch' ? '#f59e0b' : e.type === 'choice' ? '#818cf8' : '#555'"
            stroke-width="1.5"
            :stroke-dasharray="e.type === 'catch' ? '4 3' : 'none'"
            :marker-end="e.type === 'catch' ? 'url(#sfn-arrow-catch)' : 'url(#sfn-arrow)'"
          />
          <text
            v-if="e.label"
            :x="edgeLabelPos(e).x"
            :y="edgeLabelPos(e).y"
            text-anchor="middle"
            font-size="9"
            :fill="e.type === 'catch' ? '#f59e0b' : e.type === 'choice' ? '#a5b4fc' : '#888'"
          >{{ e.label }}</text>
        </g>

        <!-- Nodes -->
        <g
          v-for="n in nodes"
          :key="n.name"
          :transform="`translate(${n.x},${n.y})`"
          class="sfn-node"
          :class="`sfn-type-${n.state.Type.toLowerCase()}`"
          @click="$emit('nodeClick', n)"
          style="cursor:pointer"
        >
          <!-- Node shape: Choice = diamond-ish (rounded), Succeed/Fail = pill, others = rect -->
          <rect
            :x="-NW/2" :y="-NH/2"
            :width="NW" :height="NH"
            :rx="nodeRx(n.state.Type)"
            :fill="nodeFill(n.state.Type)"
            stroke="#444"
            stroke-width="1.2"
          />

          <!-- Type label -->
          <text
            x="0" :y="-NH/2 + 12"
            text-anchor="middle"
            font-size="9"
            font-weight="600"
            :fill="typeColor(n.state.Type)"
            letter-spacing="0.5"
          >{{ n.state.Type.toUpperCase() }}</text>

          <!-- Divider -->
          <line
            :x1="-NW/2 + 8" :y1="-NH/2 + 16"
            :x2="NW/2 - 8"  :y2="-NH/2 + 16"
            stroke="#333" stroke-width="0.8"
          />

          <!-- State name (clipped) -->
          <foreignObject :x="-NW/2 + 5" :y="-NH/2 + 18" :width="NW - 10" :height="NH - 22">
            <div
              xmlns="http://www.w3.org/1999/xhtml"
              style="font-size:11px;font-weight:500;color:#ddd;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.3;padding:1px 2px"
              :title="n.name"
            >{{ n.name }}</div>
            <div
              v-if="n.state.Type === 'Task' && n.state.Resource"
              xmlns="http://www.w3.org/1999/xhtml"
              style="font-size:9px;color:#999;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px"
              :title="n.state.Resource"
            >{{ shortResource(n.state.Resource) }}</div>
          </foreignObject>

          <!-- End double-ring badge -->
          <g v-if="n.state.End">
            <circle cx="0" :cy="NH/2 + 12" r="7" fill="none" stroke="#ef4444" stroke-width="1.5" />
            <circle cx="0" :cy="NH/2 + 12" r="4" fill="#ef4444" />
          </g>
          <line v-if="n.state.End"
            x1="0" :y1="NH/2"
            x2="0" :y2="NH/2 + 5"
            stroke="#ef4444" stroke-width="1.5"
          />
        </g>
      </svg>
    </div>

    <!-- Legend -->
    <div class="sfn-legend">
      <span v-for="t in STATE_TYPES" :key="t.type" class="sfn-legend-item">
        <span class="sfn-legend-dot" :style="{ background: t.fill }"></span>
        <span>{{ t.type }}</span>
      </span>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, nextTick, watch } from 'vue'

const props = defineProps({
  definition: { type: String, default: '' },
})

defineEmits(['nodeClick'])

const wrap   = ref(null)
const wrapW  = ref(800)

// ─── Layout constants ──────────────────────────────────────────────────────────
const NW     = 150  // node width
const NH     = 58   // node height
const H_GAP  = 40   // horizontal gap between nodes
const V_GAP  = 70   // vertical gap between levels
const PAD    = 60   // canvas padding

const STATE_TYPES = [
  { type: 'Task',     fill: '#1e3a5f' },
  { type: 'Choice',   fill: '#44270e' },
  { type: 'Wait',     fill: '#2d1b69' },
  { type: 'Pass',     fill: '#1a2535' },
  { type: 'Parallel', fill: '#063a3a' },
  { type: 'Map',      fill: '#063a1e' },
  { type: 'Succeed',  fill: '#0f2e10' },
  { type: 'Fail',     fill: '#3a0f0f' },
]

// ─── ASL Parser + Layout ───────────────────────────────────────────────────────
const parsed = computed(() => {
  if (!props.definition) return null
  try { return JSON.parse(props.definition) } catch { return null }
})

const error = computed(() => {
  if (!props.definition) return 'No definition provided.'
  if (!parsed.value) return 'Invalid JSON definition.'
  if (!parsed.value.States) return 'No States found in definition.'
  return null
})

function getNexts(state) {
  const nexts = []
  if (state.Next) nexts.push({ name: state.Next, type: 'normal', label: null })
  if (state.Choices) {
    state.Choices.forEach((c, i) => {
      if (c.Next) nexts.push({ name: c.Next, type: 'choice', label: shortCondition(c) || `branch ${i + 1}` })
    })
    if (state.Default) nexts.push({ name: state.Default, type: 'choice', label: 'default' })
  }
  if (state.Catch) {
    state.Catch.forEach(c => {
      if (c.Next) nexts.push({ name: c.Next, type: 'catch', label: (c.ErrorEquals || []).join(',') || 'catch' })
    })
  }
  return nexts
}

function shortCondition(choice) {
  if (choice.Variable) {
    const v = choice.Variable.split('.').pop()
    if (choice.StringEquals !== undefined) return `${v}="${choice.StringEquals}"`
    if (choice.NumericEquals !== undefined) return `${v}==${choice.NumericEquals}`
    if (choice.BooleanEquals !== undefined) return `${v}=${choice.BooleanEquals}`
    return v
  }
  return null
}

const layout = computed(() => {
  if (!parsed.value || !parsed.value.States) return { nodes: [], edges: [], startAt: '' }
  const { StartAt, States } = parsed.value

  // BFS to assign deepest level
  const level = {}
  const queue = [{ name: StartAt, lvl: 0 }]
  level[StartAt] = 0

  while (queue.length) {
    const { name, lvl } = queue.shift()
    const state = States[name]
    if (!state) continue
    for (const { name: next } of getNexts(state)) {
      if (!States[next]) continue
      if (level[next] === undefined || level[next] < lvl + 1) {
        level[next] = lvl + 1
        queue.push({ name: next, lvl: lvl + 1 })
      }
    }
  }

  // Any unreachable states get appended at end
  let maxLvl = Math.max(0, ...Object.values(level))
  for (const name of Object.keys(States)) {
    if (level[name] === undefined) { maxLvl++; level[name] = maxLvl }
  }

  // Group by level
  const byLevel = {}
  for (const [name, lvl] of Object.entries(level)) {
    if (!byLevel[lvl]) byLevel[lvl] = []
    byLevel[lvl].push(name)
  }

  // Assign positions
  const pos = {}
  const totalLevels = Math.max(...Object.keys(byLevel).map(Number)) + 1
  for (let lvl = 0; lvl < totalLevels; lvl++) {
    const names = byLevel[lvl] || []
    const rowW = names.length * NW + (names.length - 1) * H_GAP
    names.forEach((name, i) => {
      pos[name] = {
        x: PAD + i * (NW + H_GAP) + NW / 2,
        y: PAD + 50 + lvl * (NH + V_GAP) + NH / 2,
        col: i,
        colTotal: names.length,
        rowW,
      }
    })
  }

  // Center all rows to the widest row
  const maxRowW = Math.max(...Object.values(pos).map(p => p.rowW))
  for (const p of Object.values(pos)) {
    p.x += (maxRowW - p.rowW) / 2
  }

  // Build edges
  const edges = []
  for (const [name, state] of Object.entries(States)) {
    if (!pos[name]) continue
    for (const next of getNexts(state)) {
      if (!pos[next.name]) continue
      edges.push({ from: name, to: next.name, type: next.type, label: next.label })
    }
  }

  const nodes = Object.entries(States)
    .filter(([name]) => pos[name])
    .map(([name, state]) => ({ name, state, ...pos[name] }))

  return { nodes, edges, startAt: StartAt, pos }
})

const nodes   = computed(() => layout.value.nodes)
const edges   = computed(() => layout.value.edges)

const startPos = computed(() => {
  const p = layout.value.pos?.[layout.value.startAt]
  return p || { x: PAD + NW / 2, y: PAD + 50 + NH / 2 }
})

// SVG dimensions
const svgW = computed(() => {
  if (!nodes.value.length) return 400
  const maxX = Math.max(...nodes.value.map(n => n.x + NW / 2)) + PAD
  return Math.max(maxX, 300)
})
const svgH = computed(() => {
  if (!nodes.value.length) return 200
  // Extra space for end indicators
  const maxY = Math.max(...nodes.value.map(n => n.y + NH / 2)) + 50 + PAD
  return Math.max(maxY, 200)
})
const vbX = computed(() => 0)
const vbY = computed(() => 0)

// ─── Edge drawing ──────────────────────────────────────────────────────────────
function edgePath(e) {
  const sp = layout.value.pos[e.from]
  const tp = layout.value.pos[e.to]
  if (!sp || !tp) return ''
  const x1 = sp.x
  const y1 = sp.y + NH / 2
  const x2 = tp.x
  const y2 = tp.y - NH / 2 - (tp.state?.End ? 0 : 0)
  const cy = (y1 + y2) / 2
  // Straight line if same column, else bezier
  if (Math.abs(x1 - x2) < 4) {
    return `M ${x1} ${y1} L ${x2} ${Math.max(y2 - 8, y1 + 1)}`
  }
  return `M ${x1} ${y1} C ${x1} ${cy}, ${x2} ${cy}, ${x2} ${Math.max(y2 - 8, y1 + 1)}`
}

function edgeLabelPos(e) {
  const sp = layout.value.pos[e.from]
  const tp = layout.value.pos[e.to]
  if (!sp || !tp) return { x: 0, y: 0 }
  return {
    x: (sp.x + tp.x) / 2,
    y: (sp.y + NH / 2 + tp.y - NH / 2) / 2 - 4,
  }
}

// ─── Node styling ──────────────────────────────────────────────────────────────
function nodeRx(type) {
  if (type === 'Choice')  return 12
  if (type === 'Succeed') return NH / 2
  if (type === 'Fail')    return NH / 2
  return 6
}

function nodeFill(type) {
  const map = {
    Task:     '#1e3a5f',
    Choice:   '#44270e',
    Wait:     '#2d1b69',
    Pass:     '#1a2535',
    Parallel: '#063a3a',
    Map:      '#063a1e',
    Succeed:  '#0f2e10',
    Fail:     '#3a0f0f',
  }
  return map[type] || '#1a2535'
}

function typeColor(type) {
  const map = {
    Task:     '#60a5fa',
    Choice:   '#fb923c',
    Wait:     '#a78bfa',
    Pass:     '#94a3b8',
    Parallel: '#2dd4bf',
    Map:      '#34d399',
    Succeed:  '#4ade80',
    Fail:     '#f87171',
  }
  return map[type] || '#94a3b8'
}

function shortResource(r) {
  if (!r) return ''
  // arn:aws:lambda:region:account:function:name → name
  const parts = r.split(':')
  return parts[parts.length - 1] || r
}

onMounted(async () => {
  await nextTick()
  if (wrap.value) wrapW.value = wrap.value.clientWidth || 800
})

watch(() => props.definition, async () => {
  await nextTick()
  if (wrap.value) wrapW.value = wrap.value.clientWidth || 800
})
</script>

<style scoped>
.sfn-diagram {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  min-height: 0;
}

.sfn-scroll-area {
  flex: 1;
  min-height: 0;
  background: #0e0e12;
  border-radius: 6px;
  border: 1px solid #2a2a2a;
  overflow: auto;
}

.sfn-svg {
  display: block;
}

.sfn-node {
  transition: opacity 0.15s;
}
.sfn-node:hover { opacity: 0.85; }

.sfn-error,
.sfn-empty {
  text-align: center;
  padding: 32px;
  color: #666;
  font-size: 13px;
}

.sfn-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  padding: 4px 0;
  flex-shrink: 0;
}

.sfn-legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: #888;
}

.sfn-legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  border: 1px solid #444;
}
</style>
