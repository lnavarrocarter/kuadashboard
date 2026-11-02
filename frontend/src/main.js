import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'
import { api } from './composables/useApi'
import { startCoordinatorReporting } from './lib/coordinatorReporter'

const app = createApp(App)
app.use(createPinia())
app.mount('#app')
// What the KUApps task coordinators do, in the background task manager (#330).
startCoordinatorReporting({ post: body => api('POST', '/api/system/tasks/kuapps/coordinators/events', body) })
