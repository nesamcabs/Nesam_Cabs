// Web stand-in for @expo/app-integrity (Google Play Integrity is Android-only).
// deviceSecurity.ts already skips the call off Android; this keeps the import
// from breaking the web bundle and fails loudly if it is ever reached.
const unavailable = (): never => {
  throw new Error('Play Integrity is not available in the browser.');
};

export const prepareIntegrityTokenProviderAsync = async (_cloudProjectNumber: string): Promise<void> => unavailable();
export const requestIntegrityCheckAsync = async (_requestHash: string): Promise<string> => unavailable();
