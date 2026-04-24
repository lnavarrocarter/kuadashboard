# Firma de Codigo y Notarizacion

Esta guia explica como preparar releases de escritorio confiables para Windows y macOS.

Objetivo:

- Instalador de Windows firmado con un certificado valido.
- App de macOS firmada y notarizada con Apple Developer ID.
- Artefactos de release publicados con checksums y trazabilidad del build.

## Integracion Actual en CI

La automatizacion de release de KuaDashboard esta en [.github/workflows/electron-build.yml](https://github.com/lnavarrocarter/kuadashboard/blob/main/.github/workflows/electron-build.yml) y usa:

- `CSC_LINK` / `CSC_KEY_PASSWORD` para firma en Windows.
- `APPLE_TEAM_ID` / `APPLE_API_KEY` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` para notarizacion en macOS.

La configuracion de Electron esta en [package.json](https://github.com/lnavarrocarter/kuadashboard/blob/main/package.json), y la notarizacion se ejecuta en [electron/notarize.js](https://github.com/lnavarrocarter/kuadashboard/blob/main/electron/notarize.js).

## Windows: Generar y Exportar Certificado

Usa un certificado de firma de codigo emitido por una CA (OV o EV).

Importante:

- EV normalmente acelera la reputacion de SmartScreen.
- OV funciona correctamente, pero SmartScreen puede tardar mas en confiar.

### 1. Recibir certificado de la CA

Sigue el proceso de tu CA (DigiCert, Sectigo, GlobalSign, etc.) e instala el certificado en el almacén de certificados de Windows o importa el archivo `.pfx` entregado.

### 2. Exportar PFX (si aplica)

Si tu certificado esta instalado en Windows Certificate Store:

1. Abre `certmgr.msc`.
2. Ve a `Personal` -> `Certificates`.
3. Busca tu certificado de code signing.
4. Click derecho -> `All Tasks` -> `Export`.
5. Elige `Yes, export the private key`.
6. Elige `Personal Information Exchange - PKCS #12 (.PFX)`.
7. Define una contraseña robusta.
8. Guarda el archivo, por ejemplo: `kuadashboard-codesign.pfx`.

### 3. Convertir PFX a base64 para GitHub Secret

PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes(".\kuadashboard-codesign.pfx")) | Set-Content -NoNewline .\codesign-pfx-base64.txt
```

Usa el contenido de `codesign-pfx-base64.txt` como valor de `CSC_LINK`.

Define `CSC_KEY_PASSWORD` con la contraseña del PFX.

## macOS: Preparar Firma y Notarizacion

Requisitos:

- Membresia activa en Apple Developer Program.
- Certificado `Developer ID Application`.
- API key de App Store Connect para notarizacion.

Estos pasos se hacen desde tu Mac.

### 1. Crear o importar certificado Developer ID

En Keychain Access:

1. Importa tu certificado `Developer ID Application`.
2. Verifica que la clave privada aparezca bajo el certificado.

### 2. Exportar certificado como P12

1. Abre Keychain Access.
2. Selecciona el certificado `Developer ID Application` y su clave privada.
3. Click derecho -> `Export 2 items...`.
4. Guarda como `.p12` y define una contraseña de exportacion.

### 3. Convertir P12 a base64 para CI

En terminal macOS:

```bash
base64 -i kuadashboard-developer-id.p12 | tr -d '\n' > apple-cert-base64.txt
```

Puedes usar este valor como `CSC_LINK` en GitHub Secrets si tu workflow firma macOS con la misma variable.

Nota:

- Si Windows y macOS usan materiales distintos de certificado, separa secretos por plataforma o por environment/workflow.

### 4. Crear API key de App Store Connect

En App Store Connect:

1. Users and Access -> Keys.
2. Crea una API key nueva.
3. Descarga el archivo `.p8` (solo una vez).
4. Guarda:
   - Key ID
   - Issuer ID
   - Team ID (de tu cuenta Apple).

### 5. Preparar GitHub secrets para notarizacion

Define:

- `APPLE_API_KEY` = contenido completo del `.p8` (texto crudo incluyendo BEGIN/END).
- `APPLE_API_KEY_ID` = key ID.
- `APPLE_API_ISSUER` = issuer ID.
- `APPLE_TEAM_ID` = Apple Team ID.

## Configuracion de Secrets en GitHub

En GitHub -> `Settings` -> `Secrets and variables` -> `Actions`, agrega:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_TEAM_ID`
- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

Recomendado:

- Usar secrets por environment (por ejemplo `production`) con aprobacion requerida.
- Ejecutar releases solo desde tags protegidos.

## Checklist de Validacion de Release

Antes de crear tag:

1. Verificar certificados vigentes (sin expiracion).
2. Verificar que todos los secrets requeridos existen.
3. Probar un release con tag temporal.
4. Verificar firmas:
   - Windows: validar firmante en propiedades del `.exe`.
   - macOS: ejecutar `codesign --verify --deep --strict --verbose=2 /Applications/KuaDashboard.app`.
   - macOS: ejecutar `spctl -a -vv /Applications/KuaDashboard.app`.
5. Confirmar que `SHA256SUMS.txt` esta adjunto al release.
6. Confirmar que la atestacion del build esta disponible.

## Troubleshooting

### SmartScreen sigue mostrando advertencia en Windows

Posibles causas:

- El certificado es valido, pero la reputacion de SmartScreen aun esta calentando.
- Cambio de nombre de producto o publisher entre versiones.
- El binario fue modificado despues de firmar.

### La app de macOS no abre despues de instalar

Posibles causas:

- La notarizacion no corrio por falta de secretos Apple.
- Certificado o API key de otro Team.
- El artefacto fue modificado/re-empaquetado luego de firma/notarizacion.

### GitHub Action marca secret context invalid

El editor puede advertir esto cuando no encuentra metadata local de secretos. No bloquea la ejecucion real si los secrets existen en el repositorio.
