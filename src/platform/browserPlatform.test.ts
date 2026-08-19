import { describe, expect, it } from 'vitest';
import { browserPlatform } from './browserPlatform';

describe('browserPlatform', () => {
  it('declara runtime web y habilita la exportación Excel', () => {
    expect(browserPlatform.runtime).toBe('web');
    expect(browserPlatform.canExportMovementReport).toBe(true);
  });
});
