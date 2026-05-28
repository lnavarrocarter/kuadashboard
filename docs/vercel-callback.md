# Vercel OAuth Callback

This page is configured as the HTTPS redirect URI for Vercel OAuth.

## Redirect URI

- [https://lnavarrocarter.github.io/kuadashboard/vercel-callback](https://lnavarrocarter.github.io/kuadashboard/vercel-callback)

Vercel may append query parameters such as `code`, `state`, and `configurationId`.

## Next step (desktop app)

After approval, open the app deep link:

- [kua://vercel/callback](kua://vercel/callback)

If your setup requires handling `configurationId` automatically, implement a secure backend callback endpoint that receives the HTTPS redirect and then forwards to the desktop deep link.
