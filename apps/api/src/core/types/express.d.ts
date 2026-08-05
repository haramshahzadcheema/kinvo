import type { RequestContext } from '../request-context';

declare global {
  namespace Express {
    interface Request {
      /**
       * The Current Context: populated once by `authenticate`, from the
       * same object bound to AsyncLocalStorage for the rest of the
       * request. Controllers read this directly; services/deep call
       * sites (which don't have `req`) use `getRequestContext()` instead
       * — both resolve to the identical value.
       */
      context?: RequestContext;
    }
  }
}

export {};
