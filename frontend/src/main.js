import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'
import { api } from './composables/useApi'
import { startCoordinatorReporting } from './lib/coordinatorReporter'

const app = createApp(App)
app.use(createPinia())
// Initialize only after KUA reports opt-in. This keeps agent credentials in
// the backend and ensures initial API requests carry W3C trace context.
import('./lib/observability/browserTracing')
  .then(({ startBrowserTracing }) => startBrowserTracing())
  .catch(() => false)
  .finally(() => {
    app.mount('#app')
    // What the KUApps task coordinators do, in the background task manager (#330).
    startCoordinatorReporting({ post: body => api('POST', '/api/system/tasks/kuapps/coordinators/events', body) })
  })
