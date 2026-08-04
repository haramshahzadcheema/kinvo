// Explicit named re-exports, not `export *`: TypeScript compiles `export *`
// to a runtime copy loop in CommonJS output, which bundlers' static export
// analysis (Rollup, esbuild) cannot see through — it breaks named-import
// tree-shaking/resolution for consumers like apps/web. Explicit re-exports
// compile to a statically analyzable `Object.defineProperty` per export.
export {
  dependencyHealthSchema,
  healthStatusSchema,
  livenessResponseSchema,
  readinessResponseSchema,
} from './health.schema';
export type {
  DependencyHealth,
  HealthStatus,
  LivenessResponse,
  ReadinessResponse,
} from './health.schema';
