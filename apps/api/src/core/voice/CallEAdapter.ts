import type { CalleClient as CalleClientType } from '@call-e/calle';
import { z } from 'zod';
import { CONFIRMATION_RESULT_JSON_SCHEMA } from './confirmationResultSchema';
import { translateCallToOutcome } from './outcomeTranslation';
import type {
  RequestConfirmationCallInput,
  VoiceCallHandle,
  VoiceCallOutcome,
  VoiceProvider,
  WebhookSignal,
} from './VoiceProvider';

export interface CallEAdapterDependencies {
  apiKey: string;
  baseUrl?: string;
}

function buildConfirmationTask(input: RequestConfirmationCallInput): string {
  const rateLine =
    input.rate !== null
      ? ` The offered rate is ${input.rate} ${input.rateCurrency ?? ''}.`.trimEnd()
      : '';
  return (
    `Call ${input.driverName} to confirm whether they will take a truck job. ` +
    `Ship: ${input.shipName}. Destination: ${input.destination}. Truck type: ${input.truckType}.` +
    `${rateLine} Ask them to clearly confirm yes or no. If their answer is not a clear yes or no, record it as unclear.`
  );
}

// The raw webhook delivery, per CALL-E's own OpenAPI schema (verified from
// the SDK's generated/schema.d.ts, not the docs) — snake_case wire JSON,
// NOT the SDK's hand-mapped camelCase `Call` interface used by
// calls.get()/calls.create(). Deliberately validated down to almost
// nothing: CALL-E's webhook deliveries carry no signature (confirmed three
// ways — docs, changelog, and a `@deprecated` verifier still shipped in the
// SDK — see CALL-E_Systems_Analysis.md), so every delivery is an untrusted,
// unauthenticated ping. This schema exists only to learn which call to
// re-fetch authoritatively via the API key; none of the delivery's business
// fields (status, structured_result, ...) are ever read.
const webhookEnvelopeSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    data: z.object({ id: z.string().min(1) }).passthrough(),
  })
  .passthrough();

// @call-e/calle ships ESM-only (verified from its package.json's `exports`
// map — an `import` condition only, no `require`), while apps/api itself
// has no `"type": "module"` and runs under tsx/tsc's CommonJS output. A
// top-level `import { CalleClient } from '@call-e/calle'` compiles to a
// `require()` at runtime and crashes with ERR_PACKAGE_PATH_NOT_EXPORTED the
// moment this module loads — confirmed the hard way, via `tsx watch`
// inside docker-compose, not caught by `tsc --noEmit` or vitest (neither
// actually executes a real CJS require of this package). A lazy dynamic
// `import()`, resolved once and memoized, sidesteps this without forcing
// apps/api's entire module system to ESM (a much larger, riskier change to
// make for one dependency) and without making createCallEAdapter itself
// async, which would ripple into container.ts's synchronous construction
// and every test call site that builds one.
let calleClientModulePromise: Promise<typeof import('@call-e/calle')> | undefined;
function loadCalleClientModule(): Promise<typeof import('@call-e/calle')> {
  calleClientModulePromise ??= import('@call-e/calle');
  return calleClientModulePromise;
}

export function createCallEAdapter(deps: CallEAdapterDependencies): VoiceProvider {
  let clientPromise: Promise<CalleClientType> | undefined;
  function getClient(): Promise<CalleClientType> {
    clientPromise ??= loadCalleClientModule().then(
      ({ CalleClient }) => new CalleClient({ apiKey: deps.apiKey, baseUrl: deps.baseUrl }),
    );
    return clientPromise;
  }

  return {
    name: 'call-e',

    async requestConfirmationCall(input: RequestConfirmationCallInput): Promise<VoiceCallHandle> {
      const client = await getClient();
      // Idempotency key is derived from the caller-supplied callAttemptRef,
      // not randomly generated — if the same placement job is submitted
      // twice (a worker crashing and retrying before marking its job
      // complete, a duplicate enqueue), CALL-E treats the replay as the
      // original request instead of placing a second real phone call to
      // the same driver. See the systems analysis's idempotency section: an
      // identical replay is safe; a differing body under the same key
      // 409s, which would only happen here if an attempt's own call content
      // changed between duplicate submissions — a bug worth surfacing, not
      // one to special-case away. callAttemptRef itself is derived
      // per-assignment-per-round by voice.service.ts, so a genuine later
      // retry (after an earlier round already resolved) gets its own,
      // distinct key and is never mistaken for a replay of the first.
      const call = await client.calls.create(
        {
          task: buildConfirmationTask(input),
          recipient: { phone: input.phone },
          resultSchema: CONFIRMATION_RESULT_JSON_SCHEMA,
          metadata: input.metadata,
        },
        { idempotencyKey: `voice-call:${input.metadata.callAttemptRef}` },
      );

      return { provider: 'call-e', externalCallId: call.id };
    },

    async getCallOutcome(externalCallId: string): Promise<VoiceCallOutcome> {
      // No try/catch here: a thrown CalleAPIError/CalleTimeoutError/
      // CalleConnectionError means the *attempt to check* failed, not that
      // CALL-E told us the call itself failed. Those are different facts —
      // only translateCallToOutcome's `failed`/`canceled` branches represent
      // the latter. Letting the SDK's own errors propagate lets the BullMQ
      // job's retry/backoff policy (task #94/#97) handle the former, which
      // is what should happen given the SDK ships zero retry logic of its
      // own (verified from source, not docs).
      const client = await getClient();
      const call = await client.calls.get(externalCallId);
      return translateCallToOutcome(call);
    },

    parseWebhookSignal(rawBody: unknown): WebhookSignal {
      const parsed = webhookEnvelopeSchema.safeParse(rawBody);
      if (!parsed.success) {
        return { kind: 'unrecognized' };
      }
      return {
        kind: 'call_event',
        provider: 'call-e',
        eventId: parsed.data.id,
        externalCallId: parsed.data.data.id,
      };
    },
  };
}
