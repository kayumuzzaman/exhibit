import type { HarEntryLike, RetrievedContent } from '../features/capture/har-types';

export type CaptureObservation = Readonly<{
  entry: HarEntryLike;
  content?: RetrievedContent;
  observedAt: number;
}>;

export interface CaptureSource {
  subscribe(listener: (observation: CaptureObservation) => void): () => void;
  snapshot(): Promise<CaptureObservation[]>;
}
