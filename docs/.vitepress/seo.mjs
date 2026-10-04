// SEO rules shared by the site config (meta tags) and scripts/generate-seo.mjs
// (sitemap, robots, llms.txt).

// Internal pages: kept online for whoever needs the link, out of search engines.
export const NOINDEX = [
  /^vercel-callback\.md$/,                                    // OAuth redirect page
  /(^|\/)guide\/certificate-order-/,                          // certification paperwork
  /(^|\/)architecture\/(kua-unified-management-plan|provisioning-and-control-plan|workspace-phase-\d+)\.md$/, // internal plans
]

export const isNoindex = page => NOINDEX.some(pattern => pattern.test(page))

// What KUA is, in the words people search with (home pages, llms.txt).
export const SUMMARY = {
  en: 'KUA (KuaDashboard) is a free, open source desktop dashboard for Kubernetes, AWS, GCP and Vercel: clusters, pods, logs, shells, port forwarding, Helm, CloudWatch logs and cost, all from one app on Windows, macOS and Linux.',
  es: 'KUA (KuaDashboard) es un dashboard de escritorio gratuito y open source para Kubernetes, AWS, GCP y Vercel: clústeres, pods, logs, shells, port forwarding, Helm, logs de CloudWatch y costos, desde una sola app para Windows, macOS y Linux.',
}
