import { describe, expect, it } from 'vitest';
import {
  publicObjectUrl,
  rewritePrivateR2Url,
} from '@/providers/storage/r2';

describe('publicObjectUrl', () => {
  it('joins R2_PUBLIC_BASE_URL with the object key', () => {
    expect(publicObjectUrl('generated/user/tool/0.png')).toBe(
      'https://media.test.local/generated/user/tool/0.png',
    );
  });

  it('strips leading slashes from the key', () => {
    expect(publicObjectUrl('/generated/user/tool/0.png')).toBe(
      'https://media.test.local/generated/user/tool/0.png',
    );
  });
});

describe('rewritePrivateR2Url', () => {
  it('rewrites path-style private API URLs to the public base', () => {
    const privateUrl =
      'https://r2_account_vitest.r2.cloudflarestorage.com/magica-media-vitest/generated/user/tool/0.png';
    expect(rewritePrivateR2Url(privateUrl)).toBe(
      'https://media.test.local/generated/user/tool/0.png',
    );
  });

  it('rewrites virtual-hosted private API URLs to the public base', () => {
    const privateUrl =
      'https://magica-media-vitest.r2_account_vitest.r2.cloudflarestorage.com/generated/user/tool/0.png';
    expect(rewritePrivateR2Url(privateUrl)).toBe(
      'https://media.test.local/generated/user/tool/0.png',
    );
  });

  it('leaves non-R2 URLs unchanged', () => {
    const cdn = 'https://g.tlcdn.com/gen/abc.png';
    expect(rewritePrivateR2Url(cdn)).toBe(cdn);
  });

  it('leaves already-public URLs unchanged', () => {
    const pub = 'https://media.test.local/generated/user/tool/0.png';
    expect(rewritePrivateR2Url(pub)).toBe(pub);
  });
});
