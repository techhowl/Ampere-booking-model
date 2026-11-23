import { describe, expect, it } from 'vitest';
import { BodyTooLargeError, readBodyText, readJsonBody } from './body';

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/x', { method: 'POST', body, headers });

const json = { 'Content-Type': 'application/json' };

describe('readJsonBody', () => {
  it('reads what our own page sends', async () => {
    const result = await readJsonBody(post('{"a":1}', { ...json, 'Sec-Fetch-Site': 'same-origin' }));
    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });

  it('accepts a charset on the content type', async () => {
    const result = await readJsonBody(post('{}', { 'Content-Type': 'application/json; charset=utf-8' }));
    expect(result.ok).toBe(true);
  });

  it('allows same-site, for the marketing site proxying /buy', async () => {
    const result = await readJsonBody(post('{}', { ...json, 'Sec-Fetch-Site': 'same-site' }));
    expect(result.ok).toBe(true);
  });

  it('refuses a cross-site request (audit V-08)', async () => {
    const result = await readJsonBody(post('{}', { ...json, 'Sec-Fetch-Site': 'cross-site' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it('refuses a text/plain body, the kind a form on another site can send (audit V-08)', async () => {
    const result = await readJsonBody(post('{"a":1}', { 'Content-Type': 'text/plain' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(415);
  });

  it('refuses a body over the limit (audit V-04)', async () => {
    const result = await readJsonBody(post(JSON.stringify({ x: 'a'.repeat(2000) }), json), { maxBytes: 1024 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
  });

  it('refuses malformed JSON', async () => {
    const result = await readJsonBody(post('{nope', json));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
  });

  it('treats an empty body as {} only when asked to', async () => {
    expect(await readJsonBody(post('', json), { allowEmpty: true })).toEqual({ ok: true, value: {} });
    const strict = await readJsonBody(post('', json));
    expect(strict.ok).toBe(false);
  });
});

describe('readBodyText', () => {
  it('refuses on the declared length before reading', async () => {
    await expect(readBodyText(post('{}', { 'Content-Length': '999999' }), 1024)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it('refuses a stream that runs past the limit', async () => {
    await expect(readBodyText(post('x'.repeat(5000)), 1024)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it('returns a body within the limit unchanged, multibyte included', async () => {
    expect(await readBodyText(post('नमस्ते'), 1024)).toBe('नमस्ते');
  });
});
