import { prisma } from '@/lib/db';
import { crmSettings } from './config';
import { FakeCrmClient } from './fake';
import { PrismaTokenProvider } from './token-store';
import type { CrmClient } from './types';
import { ZohoCrmClient } from './zoho';

/**
 * Which CRM the app talks to. CRM_PROVIDER=zoho and the ZOHO_* variables
 * switch from the fake to Greaves CRM.Next; nothing else changes. See
 * config.ts for the rule that keeps sandbox and production apart.
 *
 * Null means HOLD: jobs are queued and nothing sends them. That is what the
 * fake means anywhere but local development. In UAT or production a fake
 * would mark real leads "delivered" when they went nowhere, and they would
 * never reach the CRM once it is switched on. Held, they go the moment
 * CRM_PROVIDER=zoho — which is what launching before Greaves' go-live
 * approval needs.
 *
 * One client per process, so the token held in memory is reused.
 */

let client: CrmClient | null | undefined;

export function getCrmClient(): CrmClient | null {
  if (client !== undefined) return client;
  const settings = crmSettings();
  if (settings.provider === 'zoho') {
    client = new ZohoCrmClient(settings.zoho, new PrismaTokenProvider(prisma, settings.zoho));
  } else {
    client = process.env.APP_ENV === 'development' ? new FakeCrmClient() : null;
  }
  return client;
}

export function setCrmClient(next: CrmClient | null | undefined): void {
  client = next;
}
