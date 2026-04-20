import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'KuaDashboard',
  description: 'A lightweight Kubernetes & Cloud dashboard — Lens alternative',
  base: '/kuadashboard/',
  ignoreDeadLinks: true,

  head: [
    ['link', { rel: 'icon', href: '/kuadashboard/favicon.png' }],
  ],

  themeConfig: {
    logo: '/logo.png',
    siteTitle: 'KuaDashboard',

    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Features', link: '/features/' },
      { text: 'Architecture', link: '/architecture/' },
      { text: 'GitHub', link: 'https://github.com/lnavarrocarter/kuadashboard' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Installation', link: '/guide/installation' },
            { text: 'Electron Desktop App', link: '/guide/electron' },
            { text: 'Configuration', link: '/guide/configuration' },
          ],
        },
      ],
      '/features/': [
        {
          text: 'Features',
          items: [
            { text: 'Overview', link: '/features/' },
            { text: 'Kubernetes', link: '/features/kubernetes' },
            { text: 'AWS Integration', link: '/features/aws' },
            { text: 'GCP Integration', link: '/features/gcp' },
            { text: 'Port Forwarding', link: '/features/port-forwarding' },
            { text: 'Terminal & Shell', link: '/features/terminal' },
          ],
        },
      ],
      '/architecture/': [
        {
          text: 'Architecture',
          items: [
            { text: 'Overview', link: '/architecture/' },
            { text: 'Backend API', link: '/architecture/backend' },
            { text: 'Frontend (Vue 3)', link: '/architecture/frontend' },
            { text: 'Electron Integration', link: '/architecture/electron' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/lnavarrocarter/kuadashboard' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024-present KuaDashboard',
    },

    search: {
      provider: 'local',
    },
  },
})
