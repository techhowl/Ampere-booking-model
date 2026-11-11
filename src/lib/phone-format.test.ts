import { describe, expect, it } from 'vitest';
import { isValidPincode } from './phone-format';

describe('isValidPincode', () => {
  it.each(['560038', '110001', '744101', '794001', ' 560069 '])('accepts %s', (pincode) => {
    expect(isValidPincode(pincode)).toBe(true);
  });

  // The CRM adds any pincode it does not know to its master, so these would
  // stay there. 9 is the Army Post Service, never a customer's address.
  it.each(['999999', '900001', '012345', '56003', '5600381', 'abcdef', ''])('refuses %s', (pincode) => {
    expect(isValidPincode(pincode)).toBe(false);
  });
});
