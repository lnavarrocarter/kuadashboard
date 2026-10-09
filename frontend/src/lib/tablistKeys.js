// Arrow keys, Home and End move between the tabs of a tablist and select the one reached (#239).
// Disabled tabs are skipped. Use on each tab: @keydown="moveTab".
export function moveTab(event) {
  if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
  const list = event.currentTarget?.closest('[role="tablist"]')
  const tabs = [...(list?.querySelectorAll('[role="tab"]') || [])].filter(tab => !tab.disabled)
  if (!tabs.length) return
  event.preventDefault()
  const current = tabs.indexOf(event.currentTarget)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
    : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  tabs[next].focus()
  tabs[next].click()
}
