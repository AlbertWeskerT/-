const configuration = {
  node: process.version,
  platform: process.platform,
  architecture: process.arch,
  appVersion: '0.2.0',
  signalingConfigured: Boolean(process.env.VITE_SIGNALING_URL),
  publicAppConfigured: Boolean(process.env.VITE_PUBLIC_APP_URL),
  turnConfigured: Boolean(process.env.VITE_TURN_URL),
};

console.log(JSON.stringify(configuration, null, 2));
