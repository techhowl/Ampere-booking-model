import { NextResponse } from 'next/server';

/**
 * Reading request bodies with a ceiling.
 *
 * Next's route handlers put no limit on a body: `request.json()` reads
 * whatever arrives. The security audit stored a 2 MB webhook and an 800 KB
 * lead without complaint (V-04, V-05). Every route that reads a body goes
 * through here instead.
 */

/** Our own page's JSON requests are a few hundred bytes. */
export const JSON_BODY_MAX_BYTES = 16 * 1024;

export class BodyTooLargeError extends Error {
  constructor() {
    super('Request body is too large');
    this.name = 'BodyTooLargeError';
  }
}

/**
 * The body as text, refusing anything over `maxBytes` without reading the rest.
 * A declared Content-Length over the limit is refused before reading at all.
 */
export async function readBodyText(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError();
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export type JsonBody = { ok: true; value: unknown } | { ok: false; response: NextResponse };

function refuse(status: number, error: string, message: string): JsonBody {
  return { ok: false, response: NextResponse.json({ error, message }, { status }) };
}

/**
 * The JSON body of a request from our own page.
 *
 * Besides the size ceiling, two checks that our page always passes and a
 * forged cross-site request cannot (audit V-08). The session cookie is
 * SameSite=Lax, but every *.ampere-electric.com host counts as the same site,
 * including one a third party runs:
 *
 *   - Content-Type must be application/json. A page on another origin can only
 *     send that with a CORS preflight, and this app answers no preflight.
 *   - Sec-Fetch-Site, set by the browser and not by page script, must not be
 *     "cross-site". Same-site is allowed on purpose: the marketing site may
 *     proxy /buy from ampere-electric.com.
 *
 * `allowEmpty` treats an empty body as `{}`, for routes whose fields are all
 * optional.
 */
export async function readJsonBody(
  request: Request,
  options: { maxBytes?: number; allowEmpty?: boolean } = {},
): Promise<JsonBody> {
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    return refuse(403, 'cross_site', 'This request must come from the booking page.');
  }

  const type = request.headers.get('content-type') ?? '';
  if (!/^application\/json\b/i.test(type.trim())) {
    return refuse(415, 'unsupported_media_type', 'Request body must be JSON');
  }

  let text: string;
  try {
    text = await readBodyText(request, options.maxBytes ?? JSON_BODY_MAX_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return refuse(413, 'payload_too_large', 'Request body is too large');
    }
    throw error;
  }

  if (text.trim() === '') {
    return options.allowEmpty ? { ok: true, value: {} } : refuse(400, 'invalid_json', 'Request body must be JSON');
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return refuse(400, 'invalid_json', 'Request body must be JSON');
  }
}
