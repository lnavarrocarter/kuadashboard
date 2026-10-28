'use strict';
/**
 * electron/openLink.js
 * kua://open?view=…&app=…&tab=… (#302): brings KUA to the front on that view, for the VS Code
 * extension and other local tools. Only the view parameters of the app URL pass through
 * (frontend/src/composables/useViewUrl.js); anything else is dropped, and the target is always
 * the local backend.
 */

const VIEW_PARAMS = ['view', 'service', 'profile', 'app', 'tab', 'selected', 'project'];
const MAX_VALUE = 500;

/** The backend URL to load for a kua://open link, or null when it is not one. */
function openLinkTarget(link, backendUrl) {
  let parsed;
  try { parsed = new URL(String(link).replace(/^kua:\/\//, 'https://')); } catch { return null; }
  if (!/^kua:\/\//.test(String(link)) || parsed.hostname !== 'open') return null;
  const search = new URLSearchParams();
  for (const key of VIEW_PARAMS) {
    const value = parsed.searchParams.get(key);
    if (value && value.length <= MAX_VALUE) search.set(key, value);
  }
  const query = search.toString();
  return { url: `${String(backendUrl).replace(/\/$/, '')}/${query ? `?${query}` : ''}`, hasView: !!query };
}

module.exports = { VIEW_PARAMS, openLinkTarget };
