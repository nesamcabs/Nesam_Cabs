let guard: (() => boolean) | undefined;
export function registerFareWorkspaceGuard(next: () => boolean): () => void {
  guard = next;
  return () => { if (guard === next) guard = undefined; };
}
export const canLeaveFareWorkspace = (): boolean => guard?.() ?? true;
