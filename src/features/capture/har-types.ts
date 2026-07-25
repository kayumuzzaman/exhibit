/**
 * Plain input attachment produced by the Chrome callback adapter. Chrome HAR
 * objects themselves remain untrusted until `normalizeObservation` copies the
 * fields it understands into domain DTOs.
 */
export type RetrievedContent = Readonly<{
  text: string;
  encoding: '' | 'base64';
  mimeType?: string;
  state?: 'streamed';
  unavailableReason?: string;
}>;

export type HarEntryLike = unknown;
