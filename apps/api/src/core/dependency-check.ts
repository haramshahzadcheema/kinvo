export interface DependencyCheckResult {
  ok: boolean;
  error?: string;
}

export type DependencyChecker = () => Promise<DependencyCheckResult>;
