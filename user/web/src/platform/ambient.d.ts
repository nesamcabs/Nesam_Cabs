// Globals the shared app code (../app/src) expects.
declare const __DEV__: boolean;
declare const process: { env: Record<string, string | undefined> };

declare module '*.svg?raw' {
  const content: string;
  export default content;
}
