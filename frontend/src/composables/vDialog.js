// v-dialog: keyboard and screen-reader behaviour for a modal panel.
//
//   <div class="modal" v-dialog="() => (modal.open = false)">
//
// - role="dialog" + aria-modal, named after its header when it has no label;
// - focus moves into the dialog (first field, else the dialog itself);
// - Tab and Shift+Tab stay inside;
// - Escape calls the binding (only the topmost dialog when several are open);
// - on unmount, focus returns to the element that had it when it opened.

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',')
const FIELDS = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])'
// Most specific first: a header also holds buttons, whose text is not a name.
const TITLES = ['.modal-title', '.modal-header > span', '.modal-header > strong', 'h1', 'h2', 'h3', '[class$="-title"]', '.modal-header', '[class$="-header"]']

const open = [] // dialogs in opening order; the last one handles keys
let seq = 0

function focusables(el) {
  return [...el.querySelectorAll(FOCUSABLE)]
}

function label(el) {
  if (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')) return
  for (const selector of TITLES) {
    const title = el.querySelector(selector)
    if (!title || !title.textContent.trim()) continue
    if (!title.id) title.id = `kua-dialog-title-${++seq}`
    el.setAttribute('aria-labelledby', title.id)
    return
  }
}

export const vDialog = {
  mounted(el, binding) {
    el.setAttribute('role', 'dialog')
    el.setAttribute('aria-modal', 'true')
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
    label(el)

    const state = {
      opener: document.activeElement,
      close: binding.value,
      onKeydown(event) {
        if (open.at(-1) !== el) return
        if (event.key === 'Escape') {
          if (typeof state.close === 'function') {
            event.preventDefault()
            state.close()
          }
          return
        }
        if (event.key !== 'Tab') return
        const items = focusables(el)
        if (!items.length) { event.preventDefault(); el.focus(); return }
        const first = items[0]
        const last = items[items.length - 1]
        const active = document.activeElement
        if (event.shiftKey && (active === first || !el.contains(active))) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && (active === last || !el.contains(active))) { event.preventDefault(); first.focus() }
      },
    }
    el._kuaDialog = state
    open.push(el)
    document.addEventListener('keydown', state.onKeydown)
    // After the dialog content renders.
    queueMicrotask(() => {
      if (!el.isConnected || el.contains(document.activeElement)) return
      ;(el.querySelector(FIELDS) || el).focus()
    })
  },
  updated(el, binding) {
    if (el._kuaDialog) el._kuaDialog.close = binding.value
  },
  unmounted(el) {
    const state = el._kuaDialog
    if (!state) return
    document.removeEventListener('keydown', state.onKeydown)
    const index = open.indexOf(el)
    if (index >= 0) open.splice(index, 1)
    if (state.opener?.isConnected && typeof state.opener.focus === 'function') state.opener.focus()
    delete el._kuaDialog
  },
}
