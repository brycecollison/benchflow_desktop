import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.benchflow.companion',
  appName: 'Benchflow Companion',
  webDir: 'dist',
  plugins: {
    // Native HTTP: the desktop's sync app sends no CORS headers (it is not a website).
    CapacitorHttp: { enabled: true },
  },
};

export default config;
