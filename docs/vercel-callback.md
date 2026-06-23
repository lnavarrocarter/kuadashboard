<!-- markdownlint-disable MD033 MD010 -->

# Vercel OAuth Callback

This page is the HTTPS redirect URI used by Vercel OAuth.

## Redirect URI

- [https://lnavarrocarter.github.io/kuadashboard/vercel-callback](https://lnavarrocarter.github.io/kuadashboard/vercel-callback)

Vercel may append query parameters such as `code`, `state`, and `configurationId`.

## Desktop handoff

When the page loads with `code` and `state`, it automatically forwards to the KuaDashboard deep link:

- [kua://vercel/callback](kua://vercel/callback)

If automatic forwarding fails, use the link above manually to return to the app.

<script>
	if (typeof window !== 'undefined') {
		(function () {
			const url = new URL(window.location.href)
			const code = url.searchParams.get('code')
			const state = url.searchParams.get('state')
			const error = url.searchParams.get('error')
			const errorDescription = url.searchParams.get('error_description')

			const container = document.createElement('div')
			container.style.marginTop = '1.5rem'
			container.style.padding = '1rem'
			container.style.border = '1px solid var(--vp-c-divider, #333)'
			container.style.borderRadius = '12px'
			container.style.background = 'var(--vp-c-bg-soft, #111827)'
			container.innerHTML = '<p style="margin:0 0 .75rem;">Procesando autorización de Vercel...</p>'

			if (error) {
				container.innerHTML = '<p style="margin:0 0 .5rem;color:#f85149;font-weight:600;">Vercel OAuth failed</p>' +
					'<p style="margin:0;">' + (errorDescription || error) + '</p>'
				document.body.appendChild(container)
				return
			}

			if (!code || !state) {
				container.innerHTML = '<p style="margin:0 0 .5rem;color:#d29922;font-weight:600;">Missing OAuth parameters</p>' +
					'<p style="margin:0;">This page expects code and state query parameters from Vercel.</p>'
				document.body.appendChild(container)
				return
			}

			document.body.appendChild(container)
			window.location.replace(`kua://vercel/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`)
		})()
	}
</script>

<!-- markdownlint-enable MD033 MD010 -->
