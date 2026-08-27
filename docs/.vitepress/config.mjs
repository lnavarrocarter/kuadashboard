import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitepress'

const configDir = path.dirname(fileURLToPath(import.meta.url))
const docsDir = path.resolve(configDir, '..')
const siteUrl = (process.env.SITE_URL || 'https://lnavarrocarter.github.io/kuadashboard').replace(/\/+$/, '')
const base = process.env.VITEPRESS_BASE || (process.env.SITE_URL ? '/' : '/kuadashboard/')

function pageRoute(page) {
  const normalized = page.replace(/\\/g, '/')
  if (normalized === 'index.md') return '/'
  const route = normalized.replace(/\.md$/, '')
  if (route.endsWith('/index')) return `/${route.slice(0, -'/index'.length)}/`
  return `/${route}.html`
}

function absoluteUrl(route) {
  return `${siteUrl}${route === '/' ? '/' : route}`
}

function translatedPage(page) {
  return page.startsWith('es/') ? page.slice(3) : `es/${page}`
}

function hasPage(page) {
  return fs.existsSync(path.join(docsDir, page))
}

function homepageSchema(url, language) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        name: 'KUA — Know Unified Administration',
        alternateName: 'KuaDashboard',
        url,
        inLanguage: language,
      },
      {
        '@type': 'SoftwareApplication',
        name: 'KUA',
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Windows, macOS, Linux',
        description: 'Open source Kubernetes and multi-cloud dashboard for AWS, GCP, Vercel and Helm operations.',
        url,
        downloadUrl: 'https://github.com/lnavarrocarter/kuadashboard/releases',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      },
    ],
  })
}

const enNav = [
  { text: 'Home', link: '/' },
  { text: 'Guide', link: '/guide/getting-started' },
  { text: 'Features', link: '/features/' },
  { text: 'Changelog', link: '/changelog' },
  { text: 'Legal', items: [
    { text: 'Privacy Policy', link: '/privacy_policy' },
    { text: 'EULA', link: '/EULA' },
  ]},
  { text: 'Download', link: '/download' },
  { text: '💖 Sponsor', link: '/sponsor' },
  { text: 'Architecture', link: '/architecture/' },
  { text: 'GitHub', link: 'https://github.com/lnavarrocarter/kuadashboard' },
]

const esNav = [
  { text: 'Inicio', link: '/es/' },
  { text: 'Guía', link: '/es/guide/getting-started' },
  { text: 'Funcionalidades', link: '/es/features/' },
  { text: 'Changelog', link: '/es/changelog' },
  { text: 'Legal', items: [
    { text: 'Privacy Policy', link: '/privacy_policy' },
    { text: 'EULA', link: '/EULA' },
  ]},
  { text: 'Descarga', link: '/es/download' },
  { text: '💖 Patrocinar', link: '/es/sponsor' },
  { text: 'Arquitectura', link: '/es/architecture/' },
  { text: 'GitHub', link: 'https://github.com/lnavarrocarter/kuadashboard' },
]

const enSidebar = {
  '/guide/': [{ text: 'Guide', items: [
    { text: 'Getting Started', link: '/guide/getting-started' },
    { text: 'Installation', link: '/guide/installation' },
    { text: 'Code Signing & Trust', link: '/guide/code-signing' },
    { text: 'Electron Desktop App', link: '/guide/electron' },
    { text: 'Configuration', link: '/guide/configuration' },
    { text: 'Credential setup', link: '/guide/credentials' },
    { text: 'Certification ZoZE/001347/US', link: '/guide/certificate-order-zoze-001347-us' },
  ]}],
  '/features/': [{ text: 'Features', items: [
    { text: 'Overview', link: '/features/' },
    { text: 'Kubernetes', link: '/features/kubernetes' },
    { text: 'AWS Integration', link: '/features/aws' },
    { text: 'GCP Integration', link: '/features/gcp' },
    { text: 'Vercel Integration', link: '/features/vercel' },
    { text: 'Port Forwarding', link: '/features/port-forwarding' },
    { text: 'Terminal & Shell', link: '/features/terminal' },
  ]}],
  '/architecture/': [{ text: 'Architecture', items: [
    { text: 'Overview', link: '/architecture/' },
    { text: 'Workspace Phase 3', link: '/architecture/workspace-phase-3' },
    { text: 'Workspace Phase 4', link: '/architecture/workspace-phase-4' },
    { text: 'Backend API', link: '/architecture/backend' },
    { text: 'Frontend (Vue 3)', link: '/architecture/frontend' },
    { text: 'Electron', link: '/architecture/electron' },
  ]}],
}

const esSidebar = {
  '/es/guide/': [{ text: 'Guía', items: [
    { text: 'Primeros Pasos', link: '/es/guide/getting-started' },
    { text: 'Instalación', link: '/es/guide/installation' },
    { text: 'Firma y Confianza', link: '/es/guide/code-signing' },
    { text: 'App Electron', link: '/es/guide/electron' },
    { text: 'Configuración', link: '/es/guide/configuration' },
    { text: 'Configurar credenciales', link: '/es/guide/credentials' },
    { text: 'Certificacion ZoZE/001347/US', link: '/es/guide/certificate-order-zoze-001347-us' },
  ]}],
  '/es/features/': [{ text: 'Funcionalidades', items: [
    { text: 'Resumen', link: '/es/features/' },
    { text: 'Kubernetes', link: '/es/features/kubernetes' },
    { text: 'Integración AWS', link: '/es/features/aws' },
    { text: 'Integración GCP', link: '/es/features/gcp' },
    { text: 'Integración Vercel', link: '/es/features/vercel' },
    { text: 'Port Forwarding', link: '/es/features/port-forwarding' },
    { text: 'Terminal & Shell', link: '/es/features/terminal' },
  ]}],
  '/es/architecture/': [{ text: 'Arquitectura', items: [
    { text: 'Resumen', link: '/es/architecture/' },
    { text: 'Workspace Fase 3', link: '/es/architecture/workspace-phase-3' },
    { text: 'Workspace Fase 4', link: '/es/architecture/workspace-phase-4' },
    { text: 'Backend API', link: '/es/architecture/backend' },
    { text: 'Frontend (Vue 3)', link: '/es/architecture/frontend' },
    { text: 'Electron', link: '/es/architecture/electron' },
  ]}],
}

export default defineConfig({
  title: 'KUA — Kubernetes & Multi-Cloud Dashboard',
  titleTemplate: ':title | KUA',
  description: 'KUA is an open source Kubernetes and multi-cloud dashboard for AWS, GCP, Vercel, Helm, logs and infrastructure operations.',
  base,
  ignoreDeadLinks: true,

  head: [
    ['meta', { name: 'author', content: 'KuaDashboard' }],
    ['meta', { name: 'theme-color', content: '#0f172a' }],
    ['meta', { property: 'og:site_name', content: 'KUA — Know Unified Administration' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:image', content: absoluteUrl('/logo.png') }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:image', content: absoluteUrl('/logo.png') }],
    ['link', { rel: 'icon', href: `${base}favicon.png` }],
  ],

  transformHead({ page, title, description }) {
    if (page === '404.md') return []

    const route = pageRoute(page)
    const canonical = absoluteUrl(route)
    const alternate = translatedPage(page)
    const entries = [
      ['meta', { name: 'description', content: description }],
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: description }],
      ['meta', { property: 'og:url', content: canonical }],
      ['meta', { name: 'twitter:title', content: title }],
      ['meta', { name: 'twitter:description', content: description }],
      ['link', { rel: 'canonical', href: canonical }],
    ]

    if (hasPage(alternate)) {
      const englishPage = page.startsWith('es/') ? alternate : page
      const spanishPage = page.startsWith('es/') ? page : alternate
      entries.push(
        ['link', { rel: 'alternate', hreflang: 'en', href: absoluteUrl(pageRoute(englishPage)) }],
        ['link', { rel: 'alternate', hreflang: 'es', href: absoluteUrl(pageRoute(spanishPage)) }],
        ['link', { rel: 'alternate', hreflang: 'x-default', href: absoluteUrl(pageRoute(englishPage)) }],
      )
    }

    if (page === 'index.md' || page === 'es/index.md') {
      entries.push([
        'script',
        { type: 'application/ld+json' },
        homepageSchema(canonical, page.startsWith('es/') ? 'es' : 'en'),
      ])
    }

    return entries
  },

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
