export type CaptureObservation = Readonly<{
  entry: unknown;
  content?: unknown;
  observedAt: number;
}>;

export interface CaptureSource {
  subscribe(listener: (observation: CaptureObservation) => void): () => void;
  snapshot(): Promise<CaptureObservation[]>;
}
