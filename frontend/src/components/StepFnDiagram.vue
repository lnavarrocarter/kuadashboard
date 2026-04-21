<template>
  <div class="sfn-diagram" ref="wrap">
    <div v-if="error" class="sfn-error">{{ error }}</div>
    <div v-else-if="!nodes.length" class="sfn-empty">No states found in definition.</div>
    <template v-else>
      <!-- Toolbar -->
      <div class="sfn-toolbar">
        <button class="sfn-btn" title="Zoom in" @click="zoomBy(0.2)">＋</button>
        <button class="sfn-btn" title="Zoom out" @click="zoomBy(-0.2)">－</button>
        <button class="sfn-btn" title="Fit to view" @click="fitView">⊡</button>
        <span class="sfn-zoom-label">{{ Math.round(zoom * 100) }}%</span>
        <div class="sfn-legend">
          <span v-for="t in STATE_TYPES" :key="t.type" class="sfn-legend-item">
            <span class="sfn-legend-dot" :style="{ background: t.fill }"></span>
            <span>{{ t.type }}</span>
          </span>
        </div>
        <span class="sfn-hint">Drag to pan · Scroll to zoom</span>
      </div>

      <!-- Canvas -->
      <div class="sfn-canvas" ref="canvas"
        @mousedown="onMouseDown"
        @mousemove="onMouseMove"
        @mouseup="onMouseUp"
        @mouseleave="onMouseUp"
        @wheel.prevent="onWheel"
        :style="{ cursor: dragging ? 'grabbing' : 'grab' }"
      >
        <svg
          width="100%" height="100%"
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

          <!-- Pan + Zoom group -->
          <g :transform="`translate(${panX},${panY}) scale(${zoom})`">

            <!-- START indicator -->
            <circle :cx="startPos.x" :cy="startPos.y - NH/2 - 22" r="8" fill="#22c55e" />
            <line
              :x1="startPos.x" :y1="startPos.y - NH/2 - 14"
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

              <!-- State name -->
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

          </g>
        </svg>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, nextTick, watch } from 'vue'

const props = defineProps({
  definition: { type: String, default: '' },
})

defineEmits(['nodeClick'])

const wrap   = ref(null)
const canvas = ref(null)

// ─── Layout constants ──────────────────────────────────────────────────────────
const NW    = 150  // node width
const NH    = 58   // node height
const H_GAP = 40   // horizontal gap between nodes
const V_GAP = 70   // vertical gap between levels
const PAD   = 60   // canvas padding

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

// ─── Pan & Zoom state ─────────────────────────────────────────────────────────
const zoom  = ref(1)
const panX  = ref(0)
const panY  = ref(0)

const MIN_ZOOM = 0.15
const MAX_ZOOM = 3

function zoomBy(delta) {
  const newZ = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom.value + delta))
  // Zoom toward canvas center
  const cw = canvas.value?.clientWidth  || 600
  const ch = canvas.value?.clientHeight || 400
  panX.value = cw / 2 - (cw / 2 - panX.value) * (newZ / zoom.value)
  panY.value = ch / 2 - (ch / 2 - panY.value) * (newZ / zoom.value)
  zoom.value = newZ
}

function fitView() {
  if (!nodes.value.length || !canvas.value) return
  const cw = canvas.value.clientWidth
  const ch = canvas.value.clientHeight
  const minX = Math.min(...nodes.value.map(n => n.x - NW / 2))
  const maxX = Math.max(...nodes.value.map(n => n.x + NW / 2))
  const minY = Math.min(...nodes.value.map(n => n.y - NH / 2)) - 40  // room for START indicator
  const maxY = Math.max(...nodes.value.map(n => n.y + NH / 2)) + 30  // room for END badge

  const contentW = maxX - minX + PAD * 2
  const contentH = maxY - minY + PAD * 2
  const newZ = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(cw / contentW, ch / contentH) * 0.92))

  zoom.value = newZ
  panX.value = (cw - contentW * newZ) / 2 - minX * newZ + PAD * newZ
  panY.value = (ch - contentH * newZ) / 2 - minY * newZ + PAD * newZ
}

// ─── Drag to pan ──────────────────────────────────────────────────────────────
const dragging    = ref(false)
const dragStart   = ref({ x: 0, y: 0 })
const panAtDrag   = ref({ x: 0, y: 0 })

function onMouseDown(e) {
  if (e.button !== 0) return
  dragging.value  = true
  dragStart.value = { x: e.clientX, y: e.clientY }
  panAtDrag.value = { x: panX.value, y: panY.value }
}

function onMouseMove(e) {
  if (!dragging.value) return
  panX.value = panAtDrag.value.x + (e.clientX - dragStart.value.x)
  panY.value = panAtDrag.value.y + (e.clientY - dragStart.value.y)
}

function onMouseUp() {
  dragging.value = false
}

// ─── Scroll to zoom ───────────────────────────────────────────────────────────
function onWheel(e) {
  const rect   = canvas.value.getBoundingClientRect()
  const mouseX = e.clientX - rect.left
  const mouseY = e.clientY - rect.top
  const delta  = e.deltaY < 0 ? 0.1 : -0.1
  const newZ   = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom.value + delta))
  panX.value   = mouseX - (mouseX - panX.value) * (newZ / zoom.value)
  panY.value   = mouseY - (mouseY - panY.value) * (newZ / zoom.value)
  zoom.value   = newZ
}

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
  if (!parsed.value || !parsed.value.States) return { nodes: [], edges: [], startAt: '', pos: {} }
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

const nodes    = computed(() => layout.value.nodes)
const edges    = computed(() => layout.value.edges)
const startPos = computed(() => {
  const p = layout.value.pos?.[layout.value.startAt]
  return p || { x: PAD + NW / 2, y: PAD + 50 + NH / 2 }
})

// ─── Edge drawing ──────────────────────────────────────────────────────────────
function edgePath(e) {
  const sp = layout.value.pos[e.from]
  const tp = layout.value.pos[e.to]
  if (!sp || !tp) return ''
  const x1 = sp.x
  const y1 = sp.y + NH / 2
  const x2 = tp.x
  const y2 = tp.y - NH / 2
  const cy = (y1 + y2) / 2
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
  const parts = r.split(':')
  return parts[parts.length - 1] || r
}

async function initView() {
  await nextTick()
  fitView()
}

onMounted(initView)
watch(() => props.definition, initView)
</script>

<style scoped>
.sfn-diagram {
  display: flex;
  flex-direction: column;
  gap: 0;
  height: 100%;
  min-height: 0;
  background: #0e0e12;
  border-radius: 6px;
  border: 1px solid #2a2a2a;
  overflow: hidden;
}

/* ─── Toolbar ─────────────────────────────────────────────────────────────── */
.sfn-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid #1e1e1e;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.sfn-btn {
  background: #1e1e2e;
  border: 1px solid #333;
  color: #ccc;
  border-radius: 4px;
  width: 28px;
  height: 28px;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.sfn-btn:hover { background: #2a2a3e; border-color: #555; color: #fff; }

.sfn-zoom-label {
  font-size: 11px;
  color: #666;
  min-width: 38px;
}

.sfn-hint {
  font-size: 10px;
  color: #444;
  margin-left: auto;
}

/* ─── Canvas ──────────────────────────────────────────────────────────────── */
.sfn-canvas {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
  user-select: none;
}

.sfn-svg {
  display: block;
  width: 100%;
  height: 100%;
}

/* ─── Nodes ───────────────────────────────────────────────────────────────── */
.sfn-node { transition: opacity 0.15s; }
.sfn-node:hover { opacity: 0.85; }

/* ─── States ──────────────────────────────────────────────────────────────── */
.sfn-error,
.sfn-empty {
  text-align: center;
  padding: 32px;
  color: #666;
  font-size: 13px;
}

/* ─── Legend ──────────────────────────────────────────────────────────────── */
.sfn-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
}

.sfn-legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: #888;
}

.sfn-legend-dot {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  border: 1px solid #444;
  flex-shrink: 0;
}
</style>
