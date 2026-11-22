import { describe, expect, it } from 'vitest';
import { loggablePath } from '../../src/common/access-log.js';

describe('loggablePath', () => {
  it('hides the token of a signed certificate link', () => {
    expect(loggablePath('/api/v1/certificates/eyJmaWxlSWQiOiJ4In0.c2lnbmF0dXJl')).toBe('/api/v1/certificates/:token');
  });

  it('hides it even when something follows the token', () => {
    expect(loggablePath('/api/v1/certificates/abc.def/extra')).toBe('/api/v1/certificates/:token/extra');
  });

  it('leaves every other path as it is', () => {
    expect(loggablePath('/api/v1/skills/11111111-1111-4111-8111-111111111111/certificate-link')).toBe('/api/v1/skills/11111111-1111-4111-8111-111111111111/certificate-link');
    expect(loggablePath('/api/v1/my/skills')).toBe('/api/v1/my/skills');
  });
});
