import { constants, zstdCompressSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { readZstdFramedText } from '$server/zstd-frames.js';

/** One checksummed frame per payload, concatenated the way an append-only log grows. */
function framed(...payloads: string[]): Buffer {
  return Buffer.concat(payloads.map(frame));
}

function frame(payload: string): Buffer {
  return zstdCompressSync(Buffer.from(payload, 'utf8'), {
    params: { [constants.ZSTD_c_checksumFlag]: 1 }
  });
}

describe('readZstdFramedText', () => {
  it('decodes every frame of a concatenated session log in order', async () => {
    const source = framed('{"type":"session"}\n', '{"seq":1}\n{"seq":2}\n', '{"seq":3}\n');

    const result = await readZstdFramedText(source);

    expect(result.frames).toBe(3);
    expect(result.truncatedBytes).toBe(0);
    expect(result.text.split('\n').filter(Boolean)).toEqual([
      '{"type":"session"}',
      '{"seq":1}',
      '{"seq":2}',
      '{"seq":3}'
    ]);
  });

  it('decodes a log whose frames carry no content checksum', async () => {
    const source = Buffer.concat([
      zstdCompressSync(Buffer.from('{"type":"session"}\n', 'utf8')),
      zstdCompressSync(Buffer.from('{"seq":1}\n', 'utf8'))
    ]);

    const result = await readZstdFramedText(source);

    expect(result).toMatchObject({ frames: 2, truncatedBytes: 0 });
    expect(result.text).toBe('{"type":"session"}\n{"seq":1}\n');
  });

  it('keeps the complete records before an unfinished final frame', async () => {
    const complete = framed('{"type":"session"}\n', '{"seq":1}\n');
    const torn = frame('{"seq":2}\n');
    const source = Buffer.concat([complete, torn.subarray(0, torn.byteLength - 4)]);

    const result = await readZstdFramedText(source);

    expect(result.frames).toBe(2);
    expect(result.truncatedBytes).toBe(torn.byteLength - 4);
    expect(result.text).toBe('{"type":"session"}\n{"seq":1}\n');
  });

  it('stops at a complete frame that fails its checksum', async () => {
    const header = frame('{"type":"session"}\n');
    const corrupted = frame('{"seq":1}\n');
    corrupted[corrupted.byteLength - 1] ^= 0xff;
    const source = Buffer.concat([header, corrupted, frame('{"seq":2}\n')]);

    const result = await readZstdFramedText(source);

    expect(result.frames).toBe(1);
    expect(result.text).toBe('{"type":"session"}\n');
    expect(result.truncatedBytes).toBe(source.byteLength - header.byteLength);
  });

  it('reports no frame for bytes that are not a Zstandard stream', async () => {
    const result = await readZstdFramedText(Buffer.from('{"type":"session"}\n', 'utf8'));

    expect(result).toMatchObject({ text: '', frames: 0 });
    expect(result.truncatedBytes).toBeGreaterThan(0);
  });

  it('decodes an empty artifact as no content', async () => {
    expect(await readZstdFramedText(Buffer.alloc(0))).toEqual({
      text: '',
      frames: 0,
      truncatedBytes: 0
    });
  });
});
