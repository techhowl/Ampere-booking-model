import { describe, expect, it } from 'vitest';
import { verdictOf } from './jobs';

describe('verdictOf', () => {
  it('links a duplicate that names the existing lead, however it is worded', () => {
    for (const message of [
      'Duplicate Lead: Active Lead already exists in the system',
      'Lead already exists in the system',
      'This is a duplicate lead',
    ]) {
      expect(verdictOf({ kind: 'rejected', category: 'rule_failure', message, leadId: '1270103000087654321' })).toBe('duplicate');
    }
  });

  it('keeps the sandbox wording working without an id', () => {
    expect(
      verdictOf({ kind: 'rejected', category: 'rule_failure', message: 'Duplicate Lead: Lead already exists in the system', leadId: null }),
    ).toBe('duplicate');
  });

  it('does not call an unrelated refusal a duplicate just because it carries an id', () => {
    expect(
      verdictOf({ kind: 'rejected', category: 'api_failure', message: 'Lead creation failed due to technical reasons', leadId: '1270103000087654321' }),
    ).toBe('retry');
  });

  it('still retries when there is no answer', () => {
    expect(verdictOf({ kind: 'unreachable', reason: 'zoho_unknown (keys:message)', ambiguous: true })).toBe('retry');
  });
});
