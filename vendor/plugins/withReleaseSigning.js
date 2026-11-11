// Config plugin: sign release builds with the NESAM upload keystore when its
// location and passwords are supplied at build time (environment variables or
// Gradle properties — never committed). Without them the release build falls
// back to the debug keystore so it can still be installed for QA; such an
// artifact must NOT be uploaded to Google Play.
//
//   NESAM_UPLOAD_STORE_FILE      absolute path to the .jks / .keystore
//   NESAM_UPLOAD_STORE_PASSWORD
//   NESAM_UPLOAD_KEY_ALIAS
//   NESAM_UPLOAD_KEY_PASSWORD
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// nesam-release-signing';

const HELPERS = `
${MARKER}
def nesamSigningValue = { String name -> System.getenv(name) ?: (project.findProperty(name) ?: '') }
def nesamUploadStoreFile = nesamSigningValue('NESAM_UPLOAD_STORE_FILE')
def nesamHasUploadKey = nesamUploadStoreFile != '' && file(nesamUploadStoreFile).exists()
if (!nesamHasUploadKey) {
    logger.warn('NESAM: NESAM_UPLOAD_STORE_FILE not set — release build is signed with the DEBUG key (QA only, not for Play upload).')
}
`;

const RELEASE_SIGNING = `
        release {
            if (nesamHasUploadKey) {
                storeFile file(nesamUploadStoreFile)
                storePassword nesamSigningValue('NESAM_UPLOAD_STORE_PASSWORD')
                keyAlias nesamSigningValue('NESAM_UPLOAD_KEY_ALIAS')
                keyPassword nesamSigningValue('NESAM_UPLOAD_KEY_PASSWORD')
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes(MARKER)) return cfg;
    src = src.replace(/\nandroid \{/, `${HELPERS}\nandroid {`);
    src = src.replace(/(signingConfigs \{\n\s+debug \{[\s\S]*?\n\s+\})/, `$1${RELEASE_SIGNING}`);
    src = src.replace(
      /(release \{\n(?:\s*\/\/[^\n]*\n)*\s*)signingConfig signingConfigs\.debug/,
      '$1signingConfig nesamHasUploadKey ? signingConfigs.release : signingConfigs.debug',
    );
    if (!src.includes('nesamHasUploadKey ? signingConfigs.release')) {
      throw new Error('withReleaseSigning: could not patch android/app/build.gradle (template changed).');
    }
    cfg.modResults.contents = src;
    return cfg;
  });
};
