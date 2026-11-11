// Config plugin: makes the Android system bars behave on a light, edge-to-edge app.
//
// The app draws behind the status bar and the navigation bar (Android 15+ does this for every app). Without these theme items,
// a phone in dark mode or on 3-button navigation can show white status-bar clock/icons and white Home/Back/Recents buttons on
// the app's light background, so they disappear. Setting them in the theme also fixes the first frames before JavaScript runs.
//
//   windowLightStatusBar      dark status-bar icons (the clock, battery and notification icons)
//   windowLightNavigationBar  dark Home/Back/Recents buttons and gesture pill
//   enforceNavigationBarContrast  with 3-button navigation Android adds a light scrim behind the buttons so they stay legible
//   enforceStatusBarContrast  off: the status bar stays fully transparent over the app header
const { AndroidConfig, withAndroidStyles } = require('expo/config-plugins');

// [name, value, API level the attribute was introduced in]
const ITEMS = [
  ['android:windowLightStatusBar', 'true', undefined],
  ['android:windowLightNavigationBar', 'true', '27'],
  ['android:enforceNavigationBarContrast', 'true', '29'],
  ['android:enforceStatusBarContrast', 'false', '29'],
];

module.exports = function withSystemBars(config) {
  return withAndroidStyles(config, (cfg) => {
    let xml = cfg.modResults;
    for (const [name, value, targetApi] of ITEMS) {
      xml = AndroidConfig.Styles.assignStylesValue(xml, { add: true, parent: AndroidConfig.Styles.getAppThemeGroup(), name, value, targetApi });
    }
    cfg.modResults = xml;
    return cfg;
  });
};
