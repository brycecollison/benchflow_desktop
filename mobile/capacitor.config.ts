import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.benchflow.companion',
  appName: 'Benchflow Companion',
  webDir: 'dist',
  plugins: {
    // Native HTTP for fetch: the Microsoft token endpoint rejects browser-origin (CORS) code
    // redemption for non-SPA apps, and the LAN probe needs to reach a plain http:// host.
    CapacitorHttp: { enabled: true },
  },
};

export default config;
