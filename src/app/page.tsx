import { MODELS, REGIONS } from '@/lib/catalog/catalog';

/**
 * Placeholder root. The real work is `/buy` — prefill parsing, the step machine
 * and lead capture — which is the next item in the build order.
 *
 * Server component, as everything is by default here.
 */
export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-xs font-medium uppercase tracking-widest text-neutral-500">
        Ampere Electric
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">buy.ampere-electric.com</h1>
      <p className="mt-4 text-neutral-600">
        Scaffold is up. The purchase journey lives at <code>/buy</code> and has not been
        built yet.
      </p>

      <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-neutral-200 bg-neutral-200 text-sm">
        <div className="bg-white p-4">
          <dt className="text-neutral-500">Models in catalog</dt>
          <dd className="mt-1 text-2xl font-semibold">{MODELS.length}</dd>
        </div>
        <div className="bg-white p-4">
          <dt className="text-neutral-500">Regions</dt>
          <dd className="mt-1 text-2xl font-semibold">{REGIONS.length}</dd>
        </div>
      </dl>

      <p className="mt-8 text-sm text-neutral-500">
        Health check: <code>/api/health</code>
      </p>
    </main>
  );
}
