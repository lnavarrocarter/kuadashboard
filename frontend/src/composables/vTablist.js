// v-tablist: keyboard behaviour of a WAI-ARIA tablist.
//
//   <div role="tablist" v-tablist> <button role="tab" ...> ... </div>
//
// - Left/Right arrows move to the previous/next tab (wrapping), Home/End to the
//   first/last; the tab is focused and activated (automatic activation).
// - Tabs keep their own roving tabindex (0 on the selected one, -1 elsewhere),
//   bound in the template, so Tab enters the strip once and leaves it.

function tabsOf(el) {
  return [...el.querySelectorAll('[role="tab"]')].filter(tab => !tab.disabled)
}

function onKeydown(event) {
  const tabs = tabsOf(event.currentTarget)
  const index = tabs.indexOf(event.target)
  if (index < 0) return
  const last = tabs.length - 1
  const next = event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
    : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : event.key === 'Home' ? 0
        : event.key === 'End' ? last : -1
  if (next < 0) return
  event.preventDefault()
  tabs[next].focus()
  tabs[next].click()
}

export const vTablist = {
  mounted(el) {
    el.setAttribute('role', 'tablist')
    el.addEventListener('keydown', onKeydown)
  },
  unmounted(el) {
    el.removeEventListener('keydown', onKeydown)
  },
}
