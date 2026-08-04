import { readinessResponseSchema, type ReadinessResponse } from '@kinvo/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from './lib/apiClient';

function useApiReadiness() {
  return useQuery<ReadinessResponse>({
    queryKey: ['health', 'ready'],
    queryFn: async () => {
      const payload = await apiGet<unknown>('/health/ready');
      return readinessResponseSchema.parse(payload);
    },
    refetchInterval: 15_000,
  });
}

function StatusDot({ status }: { status: 'ok' | 'error' }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${
        status === 'ok' ? 'bg-emerald-500' : 'bg-red-500'
      }`}
      aria-hidden
    />
  );
}

export default function App() {
  const { data, isLoading, isError, error } = useApiReadiness();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-950 px-6 text-slate-100">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Kinvo</h1>
        <p className="mt-1 text-sm text-slate-400">Foundation scaffold — Phase 0</p>
      </div>

      <section className="w-full max-w-sm rounded-lg border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-sm font-medium text-slate-300">API status</h2>

        {isLoading && <p className="mt-2 text-sm text-slate-500">Checking…</p>}

        {isError && (
          <p className="mt-2 text-sm text-red-400">
            Could not reach the API: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        )}

        {data && (
          <ul className="mt-3 space-y-2">
            {data.dependencies.map((dependency) => (
              <li key={dependency.name} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 capitalize">
                  <StatusDot status={dependency.status} />
                  {dependency.name}
                </span>
                <span className="text-slate-500">
                  {dependency.status === 'ok' ? `${dependency.latencyMs ?? 0}ms` : dependency.error}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
