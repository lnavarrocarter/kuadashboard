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
      { text: 'Download', link: '/download' },
      { text: '💖 Sponsor', link: '/sponsor' },
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
      { icon: { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>' }, link: 'https://github.com/sponsors/lnavarrocarter' },
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
