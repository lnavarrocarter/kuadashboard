<template>
  <!-- eslint-disable-next-line vue/no-v-html -- HTML in the markdown is escaped; links are restricted to http(s)/mailto -->
  <div class="tw" v-html="html"></div>
</template>

<script setup>
import { computed } from 'vue'
import { Marked } from 'marked'

const props = defineProps({ markdown: { type: String, default: '' } })

const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Dashboard markdown is not trusted: raw HTML is shown as text and only
// http(s)/mailto links are kept (opened outside the app).
const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html({ text }) { return escape(text) },
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens)
      return /^(https?:|mailto:)/i.test(href || '') ? `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label
    },
    image({ text }) { return escape(text || '') },
  },
})

const html = computed(() => marked.parse(props.markdown || ''))
</script>

<style scoped>
.tw { font-size: 13px; line-height: 1.5; overflow: auto; height: 100%; }
.tw :deep(h1) { font-size: 17px; margin: 0 0 6px; }
.tw :deep(h2) { font-size: 15px; margin: 0 0 6px; }
.tw :deep(h3) { font-size: 13px; margin: 0 0 4px; }
.tw :deep(p) { margin: 0 0 6px; }
.tw :deep(code) { font-size: 12px; padding: 0 4px; border-radius: 3px; background: var(--bg-row); }
.tw :deep(a) { color: var(--accent); }
.tw :deep(ul) { margin: 0 0 6px; padding-left: 18px; }
</style>
