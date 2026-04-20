<template>
  <div class="eb-detail">
    <div v-if="loading" class="empty-row">Loading rule details...</div>
    <div v-else-if="error" class="alert-error">{{ error }}</div>
    <template v-else-if="rule">

      <!-- Rule Overview -->
      <section class="eb-section">
        <div class="eb-section-title">Rule</div>
        <div class="eb-grid">
          <div class="eb-kv">
            <span class="eb-key">Name</span>
            <span class="eb-val">{{ rule.Name }}</span>
          </div>
          <div class="eb-kv">
            <span class="eb-key">State</span>
            <span :class="rule.State === 'ENABLED' ? 'status-ok' : 'status-err'">{{ rule.State }}</span>
          </div>
          <div class="eb-kv">
            <span class="eb-key">Event Bus</span>
            <span class="eb-val mono-xs">{{ rule.EventBusName }}</span>
          </div>
          <div v-if="rule.ManagedBy" class="eb-kv">
            <span class="eb-key">Managed By</span>
            <span class="eb-val mono-xs">{{ rule.ManagedBy }}</span>
          </div>
          <div v-if="rule.RoleArn" class="eb-kv">
            <span class="eb-key">Role ARN</span>
            <span class="eb-val mono-xs arn-clip" :title="rule.RoleArn">{{ rule.RoleArn }}</span>
          </div>
          <div v-if="rule.Description" class="eb-kv full">
            <span class="eb-key">Description</span>
            <span class="eb-val">{{ rule.Description }}</span>
          </div>
        </div>
      </section>

      <!-- Trigger: Schedule or Event Pattern -->
      <section class="eb-section">
        <div class="eb-section-title">Trigger</div>

        <template v-if="rule.ScheduleExpression">
          <div class="eb-kv" style="margin-bottom:6px">
            <span class="eb-key">Schedule</span>
            <span class="eb-val mono-xs" style="color:#34d399">{{ rule.ScheduleExpression }}</span>
          </div>
          <div v-if="scheduleDescription" class="text-dim" style="font-size:11px;margin-left:0">{{ scheduleDescription }}</div>
        </template>

        <template v-else-if="parsedPattern">
          <div class="eb-pattern-header">
            <span class="eb-key">Event Pattern</span>
            <button class="btn sm" style="margin-left:auto" @click="patternView = patternView === 'visual' ? 'json' : 'visual'">
              {{ patternView === 'visual' ? 'Show JSON' : 'Show Visual' }}
            </button>
          </div>

          <!-- Visual pattern breakdown -->
          <div v-if="patternView === 'visual'" class="eb-pattern-visual">
            <div v-for="(val, key) in parsedPattern" :key="key" class="eb-pattern-row">
              <span class="eb-pattern-key">{{ key }}</span>
              <div class="eb-pattern-val">
                <template v-if="Array.isArray(val)">
                  <span v-for="(v, i) in val" :key="i" class="eb-pattern-chip">
                    {{ typeof v === 'object' ? JSON.stringify(v) : v }}
                  </span>
                </template>
                <template v-else-if="typeof val === 'object' && val !== null">
                  <div v-for="(sv, sk) in val" :key="sk" class="eb-pattern-sub">
                    <span class="eb-pattern-key" style="color:#a78bfa">{{ sk }}</span>
                    <div>
                    <div v-if="Array.isArray(sv)" style="display:flex;flex-wrap:wrap;gap:4px">
                      <span v-for="(v, i) in sv" :key="i" class="eb-pattern-chip sub">
                        {{ typeof v === 'object' ? JSON.stringify(v) : v }}
                      </span>
                    </div>
                      <span v-else class="eb-pattern-chip sub">{{ sv }}</span>
                    </div>
                  </div>
                </template>
                <span v-else class="eb-pattern-chip">{{ val }}</span>
              </div>
            </div>
          </div>

          <!-- Raw JSON pattern -->
          <pre v-else class="eb-json">{{ JSON.stringify(parsedPattern, null, 2) }}</pre>
        </template>

        <div v-else class="text-dim" style="font-size:12px">No trigger configured.</div>
      </section>

      <!-- Targets -->
      <section class="eb-section" v-if="targets.length">
        <div class="eb-section-title">Targets ({{ targets.length }})</div>
        <div v-for="(t, idx) in targets" :key="t.Id" class="eb-target">
          <div class="eb-target-header">
            <span class="eb-target-idx">#{{ idx + 1 }}</span>
            <span class="eb-target-id">{{ t.Id }}</span>
            <span class="eb-target-type">{{ targetType(t.Arn) }}</span>
          </div>

          <div class="eb-kv" style="margin-bottom:4px">
            <span class="eb-key">ARN</span>
            <span class="eb-val mono-xs arn-clip" :title="t.Arn">{{ t.Arn }}</span>
          </div>

          <div v-if="t.RoleArn" class="eb-kv" style="margin-bottom:4px">
            <span class="eb-key">Role</span>
            <span class="eb-val mono-xs arn-clip" :title="t.RoleArn">{{ t.RoleArn }}</span>
          </div>

          <!-- Input mode -->
          <div class="eb-input-block" v-if="t.Input || t.InputPath || t.InputTransformer">
            <div v-if="t.Input" class="eb-input-mode">
              <span class="eb-input-label">Constant Input</span>
              <pre class="eb-json small">{{ prettyJson(t.Input) }}</pre>
            </div>
            <div v-else-if="t.InputPath" class="eb-input-mode">
              <span class="eb-input-label">Input Path</span>
              <code class="eb-code">{{ t.InputPath }}</code>
            </div>
            <div v-else-if="t.InputTransformer" class="eb-input-mode">
              <span class="eb-input-label">Input Transformer</span>
              <div style="display:flex;flex-direction:column;gap:6px;margin-top:4px">
                <div v-if="t.InputTransformer.InputPathsMap">
                  <div class="eb-key" style="margin-bottom:4px">Input Paths Map</div>
                  <div class="eb-paths-map">
                    <div v-for="(path, varName) in t.InputTransformer.InputPathsMap" :key="varName" class="eb-paths-row">
                      <code class="eb-code var">{{ varName }}</code>
                      <span class="text-dim">→</span>
                      <code class="eb-code">{{ path }}</code>
                    </div>
                  </div>
                </div>
                <div v-if="t.InputTransformer.InputTemplate">
                  <div class="eb-key" style="margin-bottom:4px">Template</div>
                  <pre class="eb-json small">{{ prettyJson(t.InputTransformer.InputTemplate) }}</pre>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="text-dim" style="font-size:11px;margin-top:4px">Matched event passed as-is</div>

          <!-- ECS Parameters -->
          <div v-if="t.EcsParameters" class="eb-extra-block">
            <span class="eb-extra-title">ECS Parameters</span>
            <div class="eb-grid compact">
              <div class="eb-kv"><span class="eb-key">Task Def</span><span class="eb-val mono-xs arn-clip">{{ t.EcsParameters.TaskDefinitionArn }}</span></div>
              <div class="eb-kv"><span class="eb-key">Count</span><span class="eb-val">{{ t.EcsParameters.TaskCount }}</span></div>
              <div v-if="t.EcsParameters.LaunchType" class="eb-kv"><span class="eb-key">Launch Type</span><span class="eb-val">{{ t.EcsParameters.LaunchType }}</span></div>
            </div>
          </div>

          <!-- SQS Parameters -->
          <div v-if="t.SqsParameters" class="eb-extra-block">
            <span class="eb-extra-title">SQS Parameters</span>
            <div class="eb-kv"><span class="eb-key">Message Group ID</span><span class="eb-val mono-xs">{{ t.SqsParameters.MessageGroupId }}</span></div>
          </div>

          <!-- HTTP Parameters -->
          <div v-if="t.HttpParameters" class="eb-extra-block">
            <span class="eb-extra-title">HTTP Parameters</span>
            <pre class="eb-json small">{{ JSON.stringify(t.HttpParameters, null, 2) }}</pre>
          </div>

          <!-- Retry Policy -->
          <div v-if="t.RetryPolicy" class="eb-meta-row">
            <span class="eb-meta-item">
              Retry: max {{ t.RetryPolicy.MaximumRetryAttempts ?? '?' }} attempts,
              {{ t.RetryPolicy.MaximumEventAgeInSeconds ? Math.round(t.RetryPolicy.MaximumEventAgeInSeconds / 60) + ' min age limit' : '' }}
            </span>
          </div>

          <!-- DLQ -->
          <div v-if="t.DeadLetterConfig?.Arn" class="eb-meta-row dlq">
            <span class="eb-key" style="color:#f59e0b">DLQ</span>
            <span class="eb-val mono-xs arn-clip" :title="t.DeadLetterConfig.Arn">{{ t.DeadLetterConfig.Arn }}</span>
          </div>
        </div>
      </section>

      <section v-else class="eb-section">
        <div class="eb-section-title">Targets</div>
        <div class="text-dim" style="font-size:12px">No targets configured.</div>
      </section>

    </template>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  rule:    { type: Object, default: null },
  targets: { type: Array,  default: () => [] },
  loading: { type: Boolean, default: false },
  error:   { type: String,  default: null },
})

const patternView = ref('visual')

const parsedPattern = computed(() => {
  if (!props.rule?.EventPattern) return null
  try { return JSON.parse(props.rule.EventPattern) } catch { return null }
})

const scheduleDescription = computed(() => {
  const expr = props.rule?.ScheduleExpression
  if (!expr) return null
  if (expr.startsWith('rate(')) {
    const inner = expr.slice(5, -1)
    return `Runs every ${inner}`
  }
  if (expr.startsWith('cron(')) {
    return `Cron: ${expr.slice(5, -1)}`
  }
  return null
})

function prettyJson(val) {
  if (!val) return ''
  try { return JSON.stringify(JSON.parse(val), null, 2) } catch { return val }
}

function targetType(arn) {
  if (!arn) return ''
  const lower = arn.toLowerCase()
  if (lower.includes(':lambda:'))    return 'Lambda'
  if (lower.includes(':sqs:'))       return 'SQS'
  if (lower.includes(':sns:'))       return 'SNS'
  if (lower.includes(':ecs:'))       return 'ECS'
  if (lower.includes(':states:'))    return 'Step Function'
  if (lower.includes(':firehose:'))  return 'Firehose'
  if (lower.includes(':kinesis:'))   return 'Kinesis'
  if (lower.includes(':events:'))    return 'EventBridge'
  if (lower.includes(':logs:'))      return 'CloudWatch Logs'
  if (lower.includes(':codepipeline:')) return 'CodePipeline'
  if (lower.includes(':codebuild:')) return 'CodeBuild'
  const parts = arn.split(':')
  return parts[2] || 'AWS'
}
</script>

<style scoped>
.eb-detail { display: flex; flex-direction: column; gap: 14px; font-size: 12px; }

.eb-section { display: flex; flex-direction: column; gap: 8px; }
.eb-section-title {
  font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;
  color: #666; border-bottom: 1px solid #2a2a2a; padding-bottom: 4px; margin-bottom: 2px;
}

.eb-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 6px; }
.eb-grid.compact { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
.full { grid-column: 1 / -1; }

.eb-kv { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.eb-key { font-size: 10px; color: #666; flex-shrink: 0; min-width: 80px; }
.eb-val { color: #ccc; word-break: break-all; }

.arn-clip {
  max-width: 380px; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; display: inline-block; vertical-align: bottom;
  color: #94a3b8;
}

/* Pattern */
.eb-pattern-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.eb-pattern-visual { display: flex; flex-direction: column; gap: 8px; }
.eb-pattern-row {
  display: flex; gap: 10px; align-items: flex-start;
  background: rgba(255,255,255,0.03); border-radius: 4px; padding: 6px 8px;
  border-left: 2px solid #3b82f6;
}
.eb-pattern-key { font-size: 10px; color: #60a5fa; min-width: 130px; font-weight: 600; flex-shrink: 0; }
.eb-pattern-val { display: flex; flex-wrap: wrap; gap: 4px; align-items: flex-start; flex: 1; }
.eb-pattern-chip {
  background: rgba(99,102,241,0.2); border: 1px solid rgba(99,102,241,0.4);
  color: #c7d2fe; font-size: 11px; padding: 1px 7px; border-radius: 3px;
  font-family: monospace;
}
.eb-pattern-chip.sub {
  background: rgba(167,139,250,0.15); border-color: rgba(167,139,250,0.35); color: #ddd6fe;
}
.eb-pattern-sub { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; width: 100%; }

/* Targets */
.eb-target {
  background: rgba(255,255,255,0.03); border: 1px solid #2a2a2a;
  border-radius: 6px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px;
}
.eb-target-header { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }
.eb-target-idx { font-size: 10px; color: #555; font-weight: 700; }
.eb-target-id { font-weight: 600; color: #e2e8f0; flex: 1; }
.eb-target-type {
  font-size: 10px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;
  background: rgba(59,130,246,0.2); color: #93c5fd; padding: 1px 7px; border-radius: 3px;
}

/* Input block */
.eb-input-block {
  background: rgba(0,0,0,0.25); border-radius: 4px; padding: 8px 10px;
  border-left: 2px solid #6366f1;
}
.eb-input-mode { display: flex; flex-direction: column; gap: 6px; }
.eb-input-label { font-size: 10px; font-weight: 600; color: #818cf8; letter-spacing: 0.5px; text-transform: uppercase; }
.eb-code {
  font-family: monospace; font-size: 11px; background: rgba(255,255,255,0.06);
  color: #c4b5fd; padding: 2px 6px; border-radius: 3px;
}
.eb-code.var { color: #fbbf24; }

.eb-paths-map { display: flex; flex-direction: column; gap: 4px; }
.eb-paths-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

/* Extra blocks */
.eb-extra-block {
  margin-top: 4px; background: rgba(255,255,255,0.03); border-radius: 4px; padding: 6px 8px;
}
.eb-extra-title { font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; display: block; margin-bottom: 4px; }

/* Meta rows */
.eb-meta-row { display: flex; gap: 8px; font-size: 11px; color: #64748b; flex-wrap: wrap; }
.eb-meta-row.dlq { color: #f59e0b; }
.eb-meta-item { font-size: 11px; }

/* JSON pre */
.eb-json {
  margin: 0; font-family: monospace; font-size: 11px; color: #94a3b8;
  background: rgba(0,0,0,0.3); border-radius: 4px; padding: 8px; overflow: auto;
  max-height: 200px; border: 1px solid #2a2a2a;
}
.eb-json.small { font-size: 10px; max-height: 140px; }

.text-dim { color: #555; }
.mono-xs { font-family: monospace; font-size: 11px; }
.status-ok { color: #4ade80; }
.status-err { color: #f87171; }
</style>
