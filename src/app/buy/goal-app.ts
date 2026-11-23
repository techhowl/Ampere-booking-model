/**
 * The link that hands a customer outside the Zoho pilot to the Goal App test
 * ride form (GOAL_APP_URL), which serves every dealer not in the pilot.
 *
 * The ad's utm_* parameters go along, so a campaign keeps its credit for the
 * ride it produced. Nothing about the customer does: no name, number or
 * pincode in a URL, where every proxy and analytics tool would log it.
 */
export function goalAppHref(base: string, utm: Record<string, string> | null): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(utm ?? {})) {
    if (/^utm_[a-z0-9_]{1,32}$/i.test(key) && !url.searchParams.has(key)) {
      url.searchParams.set(key, value.slice(0, 255));
    }
  }
  return url.toString();
}
