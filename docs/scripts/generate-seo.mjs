import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isNoindex, SUMMARY } from '../.vitepress/seo.mjs'

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

// Last change of a page, from git (needs the full history: the docs workflow fetches it).
function lastModified(page) {
  try {
    const date = execFileSync('git', ['log', '-1', '--format=%cs', '--', page], { cwd: docsDir, encoding: 'utf8' }).trim()
    if (date) return date
  } catch { /* not a git checkout */ }
  return new Date(fs.statSync(path.join(docsDir, page)).mtime).toISOString().slice(0, 10)
}

const counterpart = page => (page.startsWith('es/') ? page.slice(3) : `es/${page}`)
const pages = collectMarkdown(docsDir).filter(page => page !== 'README.md' && page !== '404.md' && !isNoindex(page)).sort()
const known = new Set(pages)

// Sitemap: indexable pages, their last change and their language versions.
const entries = pages.map(page => {
  const other = counterpart(page)
  const alternates = known.has(other)
    ? [[page.startsWith('es/') ? 'es' : 'en', page], [page.startsWith('es/') ? 'en' : 'es', other]]
      .map(([lang, p]) => `    <xhtml:link rel="alternate" hreflang="${lang}" href="${escapeXml(siteUrl + pageRoute(p))}"/>`)
    : []
  return [
    '  <url>',
    `    <loc>${escapeXml(siteUrl + pageRoute(page))}</loc>`,
    `    <lastmod>${lastModified(page)}</lastmod>`,
    ...alternates,
    '  </url>',
  ].join('\n')
})

fs.mkdirSync(publicDir, { recursive: true })
fs.writeFileSync(path.join(publicDir, 'sitemap.xml'), [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  ...entries,
  '</urlset>',
  '',
].join('\n'))

fs.writeFileSync(path.join(publicDir, 'robots.txt'), [
  'User-agent: *',
  'Allow: /',
  `Sitemap: ${siteUrl}/sitemap.xml`,
  '',
].join('\n'))

// llms.txt: what the site is about, for AI search engines and assistants (llmstxt.org).
const titleOf = page => {
  const text = fs.readFileSync(path.join(docsDir, page), 'utf8')
  return text.match(/^title:\s*(.+)$/m)?.[1]?.trim() || text.match(/^#\s+(.+)$/m)?.[1]?.trim() || page
}
const section = (name, filter) => [`## ${name}`, '', ...pages.filter(filter).map(page => `- [${titleOf(page)}](${siteUrl}${pageRoute(page)})`), '']
fs.writeFileSync(path.join(publicDir, 'llms.txt'), [
  '# KUA — Kubernetes & multi-cloud desktop dashboard',
  '',
  `> ${SUMMARY.en}`,
  '',
  `Source code: https://github.com/lnavarrocarter/kuadashboard · Download: ${siteUrl}/download.html · Account: https://app.kuadashboard.navarrocarter.com`,
  '',
  ...section('Guide', page => page.startsWith('guide/')),
  ...section('Features', page => page.startsWith('features/')),
  ...section('Manual', page => page.startsWith('manual/')),
  ...section('Legal', page => /^(terms|privacy_policy|EULA)\.md$/.test(page)),
  ...section('Optional', page => /^(changelog|download|sponsor|ROADMAP|KUA_Concept)\.md$/.test(page)),
].join('\n'))

console.log(`[seo] Generated sitemap (${pages.length} pages), robots.txt and llms.txt for ${siteUrl}`)
