import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { resetDatabase } from '../../../test/reset-db';
import { dealerCodeFor, DealerListError, syncDealers, type CrmDealer } from './dealers';

const prisma = new PrismaClient({ datasources: { db: { url: inject('databaseUrl') } } });

const RG: CrmDealer = { crmId: '1456765000001717131', name: 'RG Motors', city: 'Bengaluru', state: 'Karnataka', pincode: '560064' };
const SHIVAM: CrmDealer = { crmId: '1456765000001717135', name: 'Shivam Ev', city: 'Rajkot', state: 'Gujarat', pincode: '360007' };
const NOIDA: CrmDealer = { crmId: '1456765000001717134', name: 'GAUR AUTO WINGS PRIVATE LIMITED', city: 'Gautam Buddha Nagar', state: 'Uttar Pradesh', pincode: '201301' };

const dealer = (crm: CrmDealer) => prisma.dealer.findUniqueOrThrow({ where: { dealerCode: dealerCodeFor(crm.crmId) } });

beforeEach(async () => {
  await resetDatabase(prisma);
  await prisma.pincodeGeo.createMany({
    data: [
      { pincode: '560064', lat: 13.1007, lng: 77.5963 },
      { pincode: '360007', lat: 22.2734, lng: 70.7512 },
      // 201301 deliberately has no location.
    ],
  });
  await prisma.dealer.create({ data: { dealerCode: 'AMP-S-001', name: 'Ampere Indiranagar', active: true, crmId: RG.crmId } });
});

afterAll(() => prisma.$disconnect());

describe('syncing the dealer master', () => {
  it('creates each CRM dealer at its pincode, with the locality as its address', async () => {
    const summary = await syncDealers(prisma, [RG, SHIVAM, NOIDA]);

    expect(summary).toMatchObject({ listed: 3, created: 3, updated: 0, dryRun: false });
    expect(await dealer(RG)).toMatchObject({
      dealerCode: 'GEM-1456765000001717131',
      name: 'RG Motors',
      address: 'Bengaluru, Karnataka 560064',
      lat: 13.1007,
      lng: 77.5963,
      active: true,
      crmId: RG.crmId,
    });
    // No location for its pincode: listed, active, but reported, because no radius search can find it.
    expect(await dealer(NOIDA)).toMatchObject({ active: true, lat: null, lng: null });
    expect(summary.unlocated).toEqual([{ code: dealerCodeFor(NOIDA.crmId), name: NOIDA.name, pincode: '201301' }]);
  });

  it('retires every dealer not in the list, placeholders included, without deleting any', async () => {
    const summary = await syncDealers(prisma, [RG, SHIVAM]);

    expect(summary.retired).toEqual(['AMP-S-001']);
    expect(await prisma.dealer.findUniqueOrThrow({ where: { dealerCode: 'AMP-S-001' } })).toMatchObject({ active: false });
    expect(await prisma.dealer.count({ where: { active: true } })).toBe(2);
  });

  it('updates in place on the next sync, keeps the phone we hold, and brings back a dealer that returns', async () => {
    await syncDealers(prisma, [RG, SHIVAM, NOIDA]);
    await prisma.dealer.update({ where: { dealerCode: dealerCodeFor(RG.crmId) }, data: { phone: '+918045560700', homeServiceable: true } });

    // NOIDA leaves the list; RG is renamed.
    const second = await syncDealers(prisma, [{ ...RG, name: 'RG Motors Yelahanka' }, SHIVAM]);
    expect(second).toMatchObject({ created: 0, updated: 2, retired: [dealerCodeFor(NOIDA.crmId)] });
    expect(await dealer(RG)).toMatchObject({ name: 'RG Motors Yelahanka', phone: '+918045560700', homeServiceable: true });
    expect(await dealer(NOIDA)).toMatchObject({ active: false });

    await syncDealers(prisma, [RG, SHIVAM, NOIDA]);
    expect(await dealer(NOIDA)).toMatchObject({ active: true });
  });

  it('refuses a list that would retire most of the CRM dealers, unless forced', async () => {
    await syncDealers(prisma, [RG, SHIVAM, NOIDA]);

    await expect(syncDealers(prisma, [RG])).rejects.toThrow(/would retire 2 of 3/);
    expect(await prisma.dealer.count({ where: { active: true } })).toBe(3);

    await syncDealers(prisma, [RG], { force: true });
    expect(await prisma.dealer.count({ where: { active: true } })).toBe(1);
  });

  it('changes nothing on a dry run, and nothing for an empty list', async () => {
    const summary = await syncDealers(prisma, [RG, SHIVAM], { dryRun: true });
    expect(summary).toMatchObject({ created: 2, retired: ['AMP-S-001'], dryRun: true });
    expect(await prisma.dealer.count()).toBe(1);
    expect(await prisma.dealer.count({ where: { active: true } })).toBe(1);

    await expect(syncDealers(prisma, [])).rejects.toThrow(DealerListError);
    expect(await prisma.dealer.count({ where: { active: true } })).toBe(1);
  });
});
