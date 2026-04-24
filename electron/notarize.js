const { notarize } = require('@electron/notarize');

exports.default = async function notarizeApp(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== 'darwin') return;

  const appName = packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  const key = process.env.APPLE_API_KEY;
  const keyId = process.env.APPLE_API_KEY_ID;
  const issuer = process.env.APPLE_API_ISSUER;

  if (!key || !keyId || !issuer) {
    // Keep local mac builds working when notarization secrets are not configured.
    console.log('Skipping notarization: APPLE_API_KEY, APPLE_API_KEY_ID or APPLE_API_ISSUER not set.');
    return;
  }

  await notarize({
    appPath,
    key,
    keyId,
    issuer,
    teamId: process.env.APPLE_TEAM_ID,
  });
};
