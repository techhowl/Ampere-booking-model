import { describe, expect, it } from 'vitest';
import { MODELS } from '@/lib/catalog/catalog';
import { coloursMissingFrom, parseProductList, ProductListError, productsFor } from './products';

/** Shaped like the live answer of 2026-11-23, ids shortened only in the names. */
function reply(models: unknown[], extra: Record<string, unknown> = {}): string {
  const output = JSON.stringify({ status: 'success', message: 'Vehicle models fetched successfully', total_models: models.length, models, ...extra });
  return JSON.stringify({ code: 'success', details: { output, output_type: 'string', id: '1' }, message: 'function executed successfully' });
}

const LIVE = [
  { model_id: '1270103000000876292', model_variant_name: 'EX+', model_family: 'Nexus', colors: ['Carbon Knight', 'Steel Grey'] },
  { model_id: '1270103000000876466', model_variant_name: 'Nexus EX+ (INTELLIPACK)', model_family: 'Nexus', colors: ['Aqua Metallic', 'Carbon Knight'] },
  { model_id: '1270103000000876487', model_variant_name: 'Magnus G Max', model_family: 'Magnus', colors: ['Matcha Green'] },
  { model_id: '1270103000000876489', model_variant_name: 'Magnus G Max with Intellipack', model_family: 'Magnus', colors: [] },
  { model_id: '1270103000000876491', model_variant_name: 'Magnus Neo', model_family: 'Magnus', colors: [] },
  { model_id: '1270103000000876493', model_variant_name: 'Reo VYB', model_family: 'Reo', colors: [] },
];

describe('reading get_products', () => {
  it('reads every model, ids as exact strings', () => {
    const products = parseProductList(200, reply(LIVE));
    expect(products).toHaveLength(6);
    expect(products[0]).toEqual({ id: '1270103000000876292', name: 'EX+', family: 'Nexus', colours: ['Carbon Knight', 'Steel Grey'] });
  });

  it('keeps a 19-digit id exact even when it arrives as a bare number', () => {
    const output = '{"status":"success","models":[{"model_id":1270103000000876292,"model_variant_name":"EX+","model_family":"Nexus"}]}';
    const body = JSON.stringify({ code: 'success', details: { output } });
    expect(parseProductList(200, body)[0]?.id).toBe('1270103000000876292');
  });

  it('refuses anything that is not a product list', () => {
    expect(() => parseProductList(401, '{}')).toThrow(ProductListError);
    expect(() => parseProductList(200, 'nope')).toThrow(/not JSON/);
    expect(() => parseProductList(200, JSON.stringify({ code: 'INVALID_URL_PATTERN' }))).toThrow(/did not complete/);
    expect(() => parseProductList(200, reply([], { status: 'failure', message: 'boom' }))).toThrow(/boom/);
  });

  it('drops rows without a usable id or name', () => {
    const products = parseProductList(200, reply([{ model_id: 'x', model_variant_name: 'A' }, { model_id: '1270103000000876292' }]));
    expect(products).toEqual([]);
  });
});

describe('matching our scooters to the CRM', () => {
  const products = parseProductList(200, reply(LIVE));

  it('finds exactly one product for every scooter on the page', () => {
    for (const model of MODELS) {
      expect(productsFor(model.name, products), model.code).toHaveLength(1);
    }
  });

  it('reads "EX+" in the Nexus family as the Nexus EX+, and not as the Intellipack', () => {
    expect(productsFor('Nexus EX+', products).map((p) => p.id)).toEqual(['1270103000000876292']);
    expect(productsFor('Nexus EX+ Intellipack', products).map((p) => p.id)).toEqual(['1270103000000876466']);
  });

  it('ignores "with", spacing and case', () => {
    expect(productsFor('Magnus GMax Intellipack', products).map((p) => p.id)).toEqual(['1270103000000876489']);
  });

  it('names colours we offer that the CRM does not list', () => {
    const intellipack = products[1]!;
    expect(coloursMissingFrom(intellipack, ['Carbon Knight', 'Steel Grey'])).toEqual(['Steel Grey']);
  });
});
