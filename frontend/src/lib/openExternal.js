/** Opens a URL in the system browser (Electron) or a new tab (web). */
export function openExternal(url) {
  if (window.kuaElectron?.openExternal) window.kuaElectron.openExternal(url)
  else window.open(url, '_blank', 'noopener')
}
