import { defineConfig } from 'vitepress'

const enNav = [
  { text: 'Home', link: '/' },
  { text: 'Guide', link: '/guide/getting-started' },
  { text: 'Features', link: '/features/' },
  { text: 'Download', link: '/download' },
  { text: '💖 Sponsor', link: '/sponsor' },
  { text: 'Architecture', link: '/architecture/' },
  { text: 'GitHub', link: 'https://github.com/lnavarrocarter/kuadashboard' },
]

const esNav = [
  { text: 'Inicio', link: '/es/' },
  { text: 'Guía', link: '/es/guide/getting-started' },
  { text: 'Funcionalidades', link: '/es/features/' },
  { text: 'Descarga', link: '/es/download' },
  { text: '💖 Patrocinar', link: '/es/sponsor' },
  { text: 'Arquitectura', link: '/es/architecture/' },
  { text: 'GitHub', link: 'https://github.com/lnavarrocarter/kuadashboard' },
]

const enSidebar = {
  '/guide/': [{ text: 'Guide', items: [
    { text: 'Getting Started', link: '/guide/getting-started' },
    { text: 'Installation', link: '/guide/installation' },
    { text: 'Electron Desktop App', link: '/guide/electron' },
    { text: 'Configuration', link: '/guide/configuration' },
  ]}],
  '/features/': [{ text: 'Features', items: [
    { text: 'Overview', link: '/features/' },
    { text: 'Kubernetes', link: '/features/kubernetes' },
    { text: 'AWS Integration', link: '/features/aws' },
    { text: 'GCP Integration', link: '/features/gcp' },
    { text: 'Port Forwarding', link: '/features/port-forwarding' },
    { text: 'Terminal & Shell', link: '/features/terminal' },
  ]}],
  '/architecture/': [{ text: 'Architecture', items: [
    { text: 'Overview', link: '/architecture/' },
    { text: 'Backend API', link: '/architecture/backend' },
    { text: 'Frontend (Vue 3)', link: '/architecture/frontend' },
    { text: 'Electron', link: '/architecture/electron' },
  ]}],
}

const esSidebar = {
  '/es/guide/': [{ text: 'Guía', items: [
    { text: 'Primeros Pasos', link: '/es/guide/getting-started' },
    { text: 'Instalación', link: '/es/guide/installation' },
    { text: 'App Electron', link: '/es/guide/electron' },
    { text: 'Configuración', link: '/es/guide/configuration' },
  ]}],
  '/es/features/': [{ text: 'Funcionalidades', items: [
    { text: 'Resumen', link: '/es/features/' },
    { text: 'Kubernetes', link: '/es/features/kubernetes' },
    { text: 'Integración AWS', link: '/es/features/aws' },
    { text: 'Integración GCP', link: '/es/features/gcp' },
    { text: 'Port Forwarding', link: '/es/features/port-forwarding' },
    { text: 'Terminal & Shell', link: '/es/features/terminal' },
  ]}],
  '/es/architecture/': [{ text: 'Arquitectura', items: [
    { text: 'Resumen', link: '/es/architecture/' },
    { text: 'Backend API', link: '/es/architecture/backend' },
    { text: 'Frontend (Vue 3)', link: '/es/architecture/frontend' },
    { text: 'Electron', link: '/es/architecture/electron' },
  ]}],
}

export default defineConfig({
  title: 'KuaDashboard',
  description: 'A lightweight Kubernetes & Cloud dashboard — Lens alternative',
  base: '/kuadashboard/',
  ignoreDeadLinks: true,

  head: [
    ['link', { rel: 'icon', href: '/kuadashboard/favicon.png' }],
  ],

  locales: {
    root: {
      label: 'English',
      lang: 'en',
    },
    es: {
      label: 'Español',
      lang: 'es',
      link: '/es/',
      themeConfig: {
        nav: esNav,
        sidebar: esSidebar,
      },
    },
  },

  themeConfig: {
    logo: '/logo.png',
    siteTitle: 'KuaDashboard',

    nav: enNav,

    sidebar: enSidebar,

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


const sharedSidebar = {
  '/guide/': [{ text: 'Guía', items: [
    { text: 'Primeros Pasos', link: '/guide/getting-started' },
    { text: 'Instalación', link: '/guide/installation' },
    { text: 'App Electron', link: '/guide/electron' },
    { text: 'Configuración', link: '/guide/configuration' },
  ]}],
  '/features/': [{ text: 'Funcionalidades', items: [
    { text: 'Resumen', link: '/features/' },
    { text: 'Kubernetes', link: '/features/kubernetes' },
    { text: 'Integración AWS', link: '/features/aws' },
    { text: 'Integración GCP', link: '/features/gcp' },
    { text: 'Port Forwarding', link: '/features/port-forwarding' },
    { text: 'Terminal & Shell', link: '/features/terminal' },
  ]}],
  '/architecture/': [{ text: 'Arquitectura', items: [
    { text: 'Resumen', link: '/architecture/' },
    { text: 'Backend API', link: '/architecture/backend' },
    { text: 'Frontend (Vue 3)', link: '/architecture/frontend' },
    { text: 'Electron', link: '/architecture/electron' },
  ]}],
}

const enSidebar = {
  '/en/guide/': [{ text: 'Guide', items: [
    { text: 'Getting Started', link: '/en/guide/getting-started' },
    { text: 'Installation', link: '/en/guide/installation' },
    { text: 'Electron Desktop App', link: '/en/guide/electron' },
    { text: 'Configuration', link: '/en/guide/configuration' },
  ]}],
  '/en/features/': [{ text: 'Features', items: [
    { text: 'Overview', link: '/en/features/' },
    { text: 'Kubernetes', link: '/en/features/kubernetes' },
    { text: 'AWS Integration', link: '/en/features/aws' },
    { text: 'GCP Integration', link: '/en/features/gcp' },
    { text: 'Port Forwarding', link: '/en/features/port-forwarding' },
    { text: 'Terminal & Shell', link: '/en/features/terminal' },
  ]}],
  '/en/architecture/': [{ text: 'Architecture', items: [
    { text: 'Overview', link: '/en/architecture/' },
    { text: 'Backend API', link: '/en/architecture/backend' },
    { text: 'Frontend (Vue 3)', link: '/en/architecture/frontend' },
    { text: 'Electron Integration', link: '/en/architecture/electron' },
  ]}],
}

export default defineConfig({
  title: 'KuaDashboard',
  description: 'A lightweight Kubernetes & Cloud dashboard — Lens alternative',
  base: '/kuadashboard/',
  ignoreDeadLinks: true,

  head: [
    ['link', { rel: 'icon', href: '/kuadashboard/favicon.png' }],
  ],

  locales: {
    root: {
      label: 'Español',
      lang: 'es',
    },
    en: {
      label: 'English',
      lang: 'en',
      link: '/en/',
      themeConfig: {
        nav: enNav,
        sidebar: enSidebar,
      },
    },
  },

  themeConfig: {
    logo: '/logo.png',
    siteTitle: 'KuaDashboard',

    nav: sharedNav,

    sidebar: sharedSidebar,

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
