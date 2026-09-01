import { zstdDecompressSync } from 'node:zlib';

/** Byte range of one structurally complete Zstandard frame. */
interface ZstdFrameRange {
  start: number;
  end: number;
}

/**
 * Result of decoding one concatenated-frame Zstandard artifact.
 */
export interface ZstdFramedRead {
  /** Plaintext of every complete frame, in file order. */
  text: string;
  /** How many complete frames decoded. */
  frames: number;
  /** Trailing bytes that are not a complete frame: a mid-append or torn tail. */
  truncatedBytes: number;
}

const FRAME_MAGIC = 0xfd2fb528;
const SKIPPABLE_MAGIC_LOW = 0x184d2a50;
const SKIPPABLE_MAGIC_HIGH = 0x184d2a5f;
const FRAME_CONTENT_SIZE_BYTES = [0, 2, 4, 8];
const DICTIONARY_ID_BYTES = [0, 1, 2, 4];
const BLOCK_HEADER_BYTES = 3;
const CHECKSUM_BYTES = 4;
/**
 * Frames decoded between event-loop yields.
 *
 * Decoding is synchronous per frame, and a long log holds thousands of them, so
 * the loop steps aside often enough that a dashboard request never waits on a
 * background scan.
 */
const YIELD_EVERY_FRAMES = 256;

/**
 * Decode a standard concatenation of independent Zstandard frames.
 *
 * dsh session logs are one checksummed frame per append batch, so a single log
 * routinely holds thousands of frames. Node's streaming Zstandard API decodes
 * only the first frame of such a container, so the frames are located
 * structurally — reading frame and block headers without decompressing them —
 * and each complete frame is then decoded on its own, which is also what
 * validates its checksum.
 *
 * A tail that is not a complete frame is reported rather than decoded. The
 * writer appends and fsyncs whole frames, so a reader arriving mid-append — or
 * after a crash — legitimately sees an unfinished final frame, and the
 * documented recovery is to keep the complete frames before it. Decoding it
 * anyway would accept records no checksum ever covered.
 */
export async function readZstdFramedText(source: Buffer): Promise<ZstdFramedRead> {
  const scan = scanZstdFrames(source);
  const parts: string[] = [];
  let frames = 0;
  for (const frame of scan.frames) {
    let plaintext: Buffer;
    try {
      plaintext = zstdDecompressSync(source.subarray(frame.start, frame.end));
    } catch {
      // A complete frame that fails its checksum ends the readable prefix: the
      // bytes after it can no longer be trusted to be the records they claim.
      break;
    }
    parts.push(plaintext.toString('utf8'));
    frames += 1;
    if (frames % YIELD_EVERY_FRAMES === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  const decodedEnd = frames === 0 ? 0 : scan.frames[frames - 1].end;
  return {
    text: parts.join(''),
    frames,
    truncatedBytes: source.byteLength - decodedEnd
  };
}

/**
 * Locate complete frames without decompressing their blocks.
 * @param source - bytes currently present in the artifact.
 * @returns complete frame ranges in file order; scanning stops at the first
 * byte that is not the start of a complete frame.
 */
function scanZstdFrames(source: Buffer): { frames: ZstdFrameRange[] } {
  const frames: ZstdFrameRange[] = [];
  let offset = 0;
  while (offset < source.byteLength) {
    const end = frameEnd(source, offset);
    if (end === null) break;
    frames.push({ start: offset, end });
    offset = end;
  }
  return { frames };
}

/**
 * Where the frame starting at `offset` ends.
 * @returns the exclusive end offset, or `null` when the frame is incomplete or
 * not a frame at all.
 */
function frameEnd(source: Buffer, offset: number): number | null {
  if (offset + 4 > source.byteLength) return null;
  const magic = source.readUInt32LE(offset);
  if (magic >= SKIPPABLE_MAGIC_LOW && magic <= SKIPPABLE_MAGIC_HIGH) {
    if (offset + 8 > source.byteLength) return null;
    const end = offset + 8 + source.readUInt32LE(offset + 4);
    return end <= source.byteLength ? end : null;
  }
  if (magic !== FRAME_MAGIC) return null;

  let cursor = offset + 4;
  if (cursor >= source.byteLength) return null;
  const descriptor = source[cursor];
  cursor += 1;
  const singleSegment = (descriptor & 0b0010_0000) !== 0;
  const hasChecksum = (descriptor & 0b0000_0100) !== 0;
  const contentSizeCode = descriptor >> 6;
  // A zero content-size code still carries one byte when the frame is a single
  // segment, which is the only place the two fields interact.
  const contentSizeBytes =
    contentSizeCode === 0 ? (singleSegment ? 1 : 0) : FRAME_CONTENT_SIZE_BYTES[contentSizeCode];
  cursor += singleSegment ? 0 : 1;
  cursor += DICTIONARY_ID_BYTES[descriptor & 0b0000_0011];
  cursor += contentSizeBytes;

  for (;;) {
    if (cursor + BLOCK_HEADER_BYTES > source.byteLength) return null;
    const header = source.readUIntLE(cursor, BLOCK_HEADER_BYTES);
    cursor += BLOCK_HEADER_BYTES;
    const lastBlock = (header & 0b1) !== 0;
    const blockType = (header >> 1) & 0b11;
    const blockSize = header >> 3;
    if (blockType === 3) return null;
    // An RLE block stores one repeated byte; raw and compressed blocks store
    // their declared size.
    cursor += blockType === 1 ? 1 : blockSize;
    if (cursor > source.byteLength) return null;
    if (lastBlock) break;
  }
  const end = cursor + (hasChecksum ? CHECKSUM_BYTES : 0);
  return end <= source.byteLength ? end : null;
}
