<template>
  <Teleport to="body">
    <div class="overlay" :style="{ display: show ? 'flex' : 'none' }" @click.self="$emit('close')">
      <div :class="['modal', wide ? 'modal-xl' : '']">
        <div class="modal-header">
          <span class="modal-title"><slot name="title" /></span>
          <button class="btn sm" @click="$emit('close')"><i data-lucide="x"></i></button>
        </div>
        <div class="modal-body"><slot /></div>
        <div class="modal-footer"><slot name="footer" /></div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { onMounted, watch, nextTick } from 'vue'
import { createIcons, icons } from 'lucide'

const props = defineProps({
  show: Boolean,
  wide: Boolean,
})
defineEmits(['close'])

watch(() => props.show, v => { if (v) nextTick(() => createIcons({ icons })) })
onMounted(() => nextTick(() => createIcons({ icons })))
</script>
