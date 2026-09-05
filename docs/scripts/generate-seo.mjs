import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const docsDir = path.resolve(scriptDir, '..')
const publicDir = path.join(docsDir, 'public')
const siteUrl = (process.env.SITE_URL || 'https://lnavarrocarter.github.io/kuadashboard').replace(/\/+$/, '')

function collectMarkdown(directory, relative = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') return []
    const absolute = path.join(directory, entry.name)
    const nextRelative = path.join(relative, entry.name)
    if (entry.isDirectory()) return collectMarkdown(absolute, nextRelative)
    return entry.name.endsWith('.md') ? [nextRelative.replaceAll(path.sep, '/')] : []
  })
}

function pageRoute(page) {
  if (page === 'index.md') return '/'
  const route = page.replace(/\.md$/, '')
  if (route.endsWith('/index')) return `/${route.slice(0, -'/index'.length)}/`
  return `/${route}.html`
}

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

const urls = collectMarkdown(docsDir)
  .filter(page => page !== 'README.md')
  .map(page => `${siteUrl}${pageRoute(page)}`)
  .sort()

fs.mkdirSync(publicDir, { recursive: true })
fs.writeFileSync(path.join(publicDir, 'sitemap.xml'), [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...urls.map(url => `  <url><loc>${escapeXml(url)}</loc></url>`),
  '</urlset>',
  '',
].join('\n'))

fs.writeFileSync(path.join(publicDir, 'robots.txt'), [
  'User-agent: *',
  'Allow: /',
  `Sitemap: ${siteUrl}/sitemap.xml`,
  '',
].join('\n'))

console.log(`[seo] Generated sitemap with ${urls.length} URLs and robots.txt for ${siteUrl}`)
