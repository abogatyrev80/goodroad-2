// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");
const path = require('path');
const { FileStore } = require('metro-cache');

const config = getDefaultConfig(__dirname);

// Use a stable on-disk store (shared across web/android)
const root = process.env.METRO_CACHE_ROOT || path.join(__dirname, '.metro-cache');
config.cacheStores = [
  new FileStore({ root: path.join(root, 'cache') }),
];

// CRITICAL: Resolve expo-sqlite to empty module on web to prevent WASM errors
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'expo-sqlite') {
    return {
      type: 'empty',
    };
  }
  
  // Default resolver
  return context.resolveRequest(context, moduleName, platform);
};

// Reduce the number of workers to decrease resource usage
config.maxWorkers = 2;

module.exports = config;
