import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { SESSION_COOKIE, parseSession } from '@/lib/crypto/session';
import { getModel } from '@/lib/catalog/catalog';
import { formatRupees } from '@/lib/pricing/price';
import { PAYMENT_TYPE_LABELS, type PaymentTypeCode } from '@/lib/schemas/order';
import { FakeCheckout } from './FakeCheckout';

/**
 * A stand-in for Juspay's hosted checkout.
 *
 * This page exists ONLY because Juspay credentials have not arrived. It takes
 * the place of their payment page so the whole loop — order, handoff, return,
 * status resolution, confirmation, retry — can be built and demonstrated now.
 *
 * It is deliberately, visibly not a real payment page. Nothing here takes card
 * details, and nothing ever will: Juspay is a hosted redirect flow and no card
 * data touches this codebase.
 *
 * It deletes itself from the journey the day the real redirect URL is used —
 * and until then it is closed whenever the real client is on, and shows an
 * order only to the browser that owns it. An order id travels in URLs; on its
 * own it must not reveal what was bought, for how much, from whom.
 */

export default async function FakePayPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;

  if (process.env.JUSPAY_ENABLED === 'true') notFound();

  const session = parseSession((await cookies()).get(SESSION_COOKIE)?.value);
  const order = await prisma.order.findUnique({
    where: { orderId },
    include: { dealer: true },
  });
  if (!order || !session || order.leadId !== session.leadId) notFound();

  const model = getModel(order.modelCode);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-amp-ink px-5 py-12">
      <div className="w-full max-w-md">
        <p className="mb-4 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-2.5 text-[12px] leading-relaxed text-amber-200">
          <strong className="font-semibold">Stand-in for Juspay.</strong> Real credentials
          have not arrived, so this page takes their place. No card details are collected
          here or anywhere in this application.
        </p>

        <div className="rounded-2xl bg-white p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amp-muted">
            Payment for
          </p>
          <h1 className="mt-1 text-[20px] font-bold text-amp-ink">
            Ampere {model?.name ?? order.modelCode}
          </h1>

          <dl className="mt-5 flex flex-col gap-2 border-t border-amp-line pt-4 text-[14px]">
            <Row label="Order" value={order.orderId} mono />
            <Row
              label="Method"
              value={PAYMENT_TYPE_LABELS[order.paymentType as PaymentTypeCode]}
            />
            <Row label="On-road price" value={formatRupees(order.amountTotal.toNumber())} />
            <div className="mt-1 border-t border-amp-line pt-3">
              <Row
                label="Payable now"
                value={formatRupees(order.amountCharged.toNumber())}
                emphasis
              />
            </div>
          </dl>

          <FakeCheckout orderId={order.orderId} />
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  emphasis,
  mono,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={emphasis ? 'font-medium text-amp-ink' : 'text-amp-muted'}>{label}</dt>
      <dd
        className={[
          emphasis ? 'text-[18px] font-bold text-amp-ink' : 'text-amp-ink',
          mono ? 'font-mono text-[12px]' : '',
        ].join(' ')}
      >
        {value}
      </dd>
    </div>
  );
}
