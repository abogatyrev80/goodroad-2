const { withGradleProperties } = require("@expo/config-plugins");

const ORG_GRADLE_JAVA_HOME = "org.gradle.java.home";
const EAS_JAVA_PATH = "/usr/lib/jvm/java-17-openjdk-amd64";

/**
 * Fixes "Value '' given for org.gradle.java.home Gradle property is invalid" on EAS Build.
 * - On Linux (EAS build): adds org.gradle.java.home with valid path to override any empty value
 * - On other platforms: removes org.gradle.java.home if present with empty value
 */
function withFixGradleJavaHome(config) {
  return withGradleProperties(config, (config) => {
    const props = config.modResults;

    // Remove existing org.gradle.java.home (empty or invalid)
    const filtered = props.filter(
      (item) =>
        !(item.type === "property" && item.key === ORG_GRADLE_JAVA_HOME)
    );

    // On Linux (EAS Build server), add valid org.gradle.java.home to override any empty value
    if (process.platform === "linux") {
      filtered.push({
        type: "property",
        key: ORG_GRADLE_JAVA_HOME,
        value: EAS_JAVA_PATH,
      });
    }

    config.modResults = filtered;
    return config;
  });
}

module.exports = withFixGradleJavaHome;
