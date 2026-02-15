/**
 * Понижает версию Android Gradle Plugin (AGP) в корневом android/build.gradle.
 * Ошибка "No matching variant / No variants exist" для нативных модулей на EAS Build
 * часто связана с AGP 8.11.0. AGP 8.6.1 совместим с теми же Gradle 8.x и стабильнее
 * с react-native-* библиотеками.
 */
const { withProjectBuildGradle } = require("@expo/config-plugins");

const AGP_ORIGINAL = "8.11.0";
const AGP_FALLBACK = "8.6.1";

function withFixAgpVersion(config) {
  return withProjectBuildGradle(config, (config) => {
    let content = config.modResults.contents;
    if (typeof content !== "string") return config;

    if (content.includes(AGP_ORIGINAL)) {
      content = content.replace(
        new RegExp(AGP_ORIGINAL.replace(/\./g, "\\."), "g"),
        AGP_FALLBACK
      );
      config.modResults.contents = content;
    }
    return config;
  });
}

module.exports = withFixAgpVersion;
