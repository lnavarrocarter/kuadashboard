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

			// Marketplace flow: code + configurationId (no state)
			const configurationId = url.searchParams.get('configurationId')
			const next            = url.searchParams.get('next')
			const teamId          = url.searchParams.get('teamId')
			const source          = url.searchParams.get('source')

			if (!code || (!state && !configurationId)) {
				container.innerHTML = '<p style="margin:0 0 .5rem;color:#d29922;font-weight:600;">Missing OAuth parameters</p>' +
					'<p style="margin:0;">This page expects code and state (or configurationId) query parameters from Vercel.</p>'
				document.body.appendChild(container)
				return
			}

			document.body.appendChild(container)

			// Build deep-link forwarding all Vercel params
			const deepParams = new URLSearchParams({ code })
			if (state)           deepParams.set('state', state)
			if (configurationId) deepParams.set('configurationId', configurationId)
			if (teamId)          deepParams.set('teamId', teamId)
			if (next)            deepParams.set('next', next)
			if (source)          deepParams.set('source', source)
			window.location.replace(`kua://vercel/callback?${deepParams.toString()}`)
		})()
	}
</script>

<!-- markdownlint-enable MD033 MD010 -->
