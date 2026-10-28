import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODELS, findModel, modelsInGroup, photoSrc } from './catalog';

const PUBLIC = join(process.cwd(), 'public');

/**
 * The catalog and the files in public/ have to agree, and nothing else checks
 * that: a colour without photographs shows a placeholder, and a brochure
 * that is not there downloads an error page.
 */
describe('the catalog matches the files', () => {
  it('has every angle of every colour photographed', () => {
    const missing: string[] = [];
    for (const model of MODELS) {
      for (const colour of model.colours) {
        const count = model.angles[colour.code];
        if (!count) missing.push(`${model.code}/${colour.code}: no angle count`);
        for (let angle = 0; angle < (count ?? 0); angle++) {
          const src = photoSrc(model, colour.code, angle);
          if (!existsSync(join(PUBLIC, src))) missing.push(src);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('counts angles only for colours the model comes in', () => {
    for (const model of MODELS) {
      expect(Object.keys(model.angles).sort(), model.code).toEqual(
        model.colours.map((c) => c.code).sort(),
      );
    }
  });

  it('has every brochure it links to', () => {
    for (const model of MODELS) {
      if (model.brochureUrl.startsWith('/')) {
        expect(existsSync(join(PUBLIC, model.brochureUrl)), model.brochureUrl).toBe(true);
      } else {
        expect(model.brochureUrl, model.code).toMatch(/^https:\/\/ampere-electric\.com\//);
      }
    }
  });
});

describe('versions of one scooter', () => {
  it('pairs each Intellipack with its standard scooter, standard first', () => {
    expect(modelsInGroup('nexus-ex-plus').map((m) => m.variant.label)).toEqual([
      'Standard',
      'Intellipack',
    ]);
    expect(modelsInGroup('magnus-gmax').map((m) => m.code)).toEqual([
      'magnus-gmax',
      'magnus-gmax-intellipack',
    ]);
  });

  it('keeps a group within one family', () => {
    for (const model of MODELS) {
      const families = new Set(modelsInGroup(model.variant.group).map((m) => m.family));
      expect(families.size, model.code).toBe(1);
    }
  });

  it("finds each scooter by its page's name on the main site", () => {
    for (const model of MODELS) {
      const slug = new URL(model.pageUrl).pathname.slice(1);
      expect(findModel(slug)?.code, slug).toBe(model.code);
    }
  });
});
