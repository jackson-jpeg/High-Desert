/**
 * hasher.ts
 *
 * Browser-side file hashing using SparkMD5.
 * Reads the first N bytes of a file in chunks to produce
 * a hex MD5 fingerprint for duplicate detection.
 */

import SparkMD5 from "spark-md5";

/** Default: hash the first 10 MB of each file. */
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/** Read files in 64 KB chunks. */
const CHUNK_SIZE = 64 * 1024; // 64 KB

/**
 * Read a Blob slice as an ArrayBuffer using FileReader.
 * Returns a promise that resolves with the ArrayBuffer.
 */
function readSlice(blob: Blob): Promise<ArrayBuffer> {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Compute an MD5 hash of the first `maxBytes` of a File.
 *
 * Uses incremental SparkMD5 hashing with 64 KB chunks so that
 * large files do not need to be loaded entirely into memory.
 *
 * @param file     - The File to hash (from File API / drag-and-drop / input)
 * @param maxBytes - Maximum number of bytes to read (default: 10 MB).
 *                   Pass `Infinity` or `0` to hash the entire file.
 * @returns A hex-encoded MD5 string (32 characters)
 *
 * @example
 * const hash = await hashFile(file);
 * // "d41d8cd98f00b204e9800998ecf8427e"
 */
export async function hashFile(
  file: File,
  maxBytes: number = DEFAULT_MAX_BYTES
): Promise<string> {
  const spark = new SparkMD5.ArrayBuffer();
  const limit = maxBytes > 0 ? Math.min(maxBytes, file.size) : file.size;
  let offset = 0;

  while (offset < limit) {
    const end = Math.min(offset + CHUNK_SIZE, limit);
    const slice = file.slice(offset, end);
    const buffer = await readSlice(slice);
    spark.append(buffer);
    offset = end;
  }

  return spark.end();
}
