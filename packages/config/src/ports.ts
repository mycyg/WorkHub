export const defaultPorts = {
  api: 8787,
  web: 5173,
  desktopWebview: 1420,
  postgres: 5432,
  redis: 6379,
  storybook: 6006,
  playwrightReport: 9323
} as const;

export type RuntimePortName = keyof typeof defaultPorts;
