# Code Signing and Notarization

This guide explains how to prepare trusted desktop releases for Windows and macOS.

Goal:

- Windows installer signed with a valid code-signing certificate.
- macOS app signed and notarized with Apple Developer ID.
- Release artifacts published with checksums and build provenance.

## Current CI Integration

KuaDashboard release automation is configured in [.github/workflows/electron-build.yml](https://github.com/lnavarrocarter/kuadashboard/blob/main/.github/workflows/electron-build.yml) and uses:

- `CSC_LINK` / `CSC_KEY_PASSWORD` for Windows signing.
- `APPLE_TEAM_ID` / `APPLE_API_KEY` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` for macOS notarization.

The Electron build config is in [package.json](https://github.com/lnavarrocarter/kuadashboard/blob/main/package.json), and notarization is handled by [electron/notarize.js](https://github.com/lnavarrocarter/kuadashboard/blob/main/electron/notarize.js).

## Windows: Generate and Export Certificate

Use a CA-issued code-signing certificate (OV or EV).

Important:

- EV generally gets SmartScreen reputation faster.
- OV works correctly, but SmartScreen trust may take longer to build.

### 1. Receive certificate from CA

Follow your CA process (DigiCert, Sectigo, GlobalSign, etc.) and install the certificate in Windows Certificate Store or import the provided `.pfx` file.

### 2. Export PFX (if needed)

If your certificate is installed in Windows certificate store:

1. Open `certmgr.msc`.
2. Go to `Personal` -> `Certificates`.
3. Find your code-signing certificate.
4. Right-click -> `All Tasks` -> `Export`.
5. Choose `Yes, export the private key`.
6. Choose `Personal Information Exchange - PKCS #12 (.PFX)`.
7. Set a strong password.
8. Save file, for example: `kuadashboard-codesign.pfx`.

### 3. Convert PFX to base64 for GitHub Secret

PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes(".\kuadashboard-codesign.pfx")) | Set-Content -NoNewline .\codesign-pfx-base64.txt
```

Use the content of `codesign-pfx-base64.txt` as the value for `CSC_LINK`.

Set `CSC_KEY_PASSWORD` to the PFX export password.

## macOS: Prepare Signing and Notarization

Prerequisites:

- Apple Developer Program membership.
- `Developer ID Application` certificate.
- Access to App Store Connect API key for notarization.

Do these steps on your Mac.

### 1. Create or import Developer ID certificate

In Keychain Access:

1. Import your `Developer ID Application` certificate.
2. Ensure private key is present under the certificate.

### 2. Export certificate as P12

1. Open Keychain Access.
2. Select your `Developer ID Application` certificate and private key.
3. Right-click -> `Export 2 items...`.
4. Save as `.p12` and set export password.

### 3. Convert P12 to base64 for CI

On macOS terminal:

```bash
base64 -i kuadashboard-developer-id.p12 | tr -d '\n' > apple-cert-base64.txt
```

You can use this value as `CSC_LINK` in GitHub Secrets if your workflow signs macOS using the same variable.

Note:

- If Windows and macOS use different cert materials, run platform-specific signing jobs or inject secrets by matrix/platform.

### 4. Create App Store Connect API key

In App Store Connect:

1. Users and Access -> Keys.
2. Create a new API key.
3. Download `.p8` file once.
4. Record:
   - Key ID
   - Issuer ID
   - Team ID (from your Apple account).

### 5. Prepare GitHub secrets for notarization

Set:

- `APPLE_API_KEY` = full `.p8` content (raw text including BEGIN/END lines).
- `APPLE_API_KEY_ID` = key ID.
- `APPLE_API_ISSUER` = issuer ID.
- `APPLE_TEAM_ID` = your Apple Team ID.

## GitHub Repository Secrets Setup

In GitHub -> `Settings` -> `Secrets and variables` -> `Actions`, add:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_TEAM_ID`
- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

Recommended:

- Use environment-level secrets (for example `production`) and required reviewers.
- Restrict release workflow to protected tags.

## Release Validation Checklist

Before tagging:

1. Confirm certs are valid and not expired.
2. Confirm all required secrets are present.
3. Build test release from a temporary tag.
4. Verify signatures:
   - Windows: check signer in executable properties.
   - macOS: run `codesign --verify --deep --strict --verbose=2 /Applications/KuaDashboard.app`.
   - macOS: run `spctl -a -vv /Applications/KuaDashboard.app`.
5. Confirm `SHA256SUMS.txt` is attached to release.
6. Confirm release attestation is available.

## Troubleshooting

### SmartScreen still warns on Windows

Possible causes:

- Certificate is valid, but SmartScreen reputation is still warming up.
- Product name or publisher changed between versions.
- Binary was modified after signing.

### macOS app not opening after install

Possible causes:

- Notarization did not run due to missing Apple secrets.
- Certificate or API key belongs to another team.
- Build artifact got re-packed after signing/notarization.

### GitHub Action says secret context invalid

In-editor warnings can appear when secrets are not defined in local metadata. This does not block runtime if secrets exist in repository settings.
