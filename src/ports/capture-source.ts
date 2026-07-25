import type { HarEntryLike, RetrievedContent } from '../features/capture/har-types';
import type { CaptureIssueCode } from '../domain/model';

export type CaptureObservation = Readonly<{
  entry: HarEntryLike;
  content?: RetrievedContent;
  observedAt: number;
}>;

export type CaptureIssue = Readonly<{
  code: CaptureIssueCode;
  message: string;
  requestId?: string;
}>;

export type CaptureEvent =
  | Readonly<{ type: 'observation'; observation: CaptureObservation }>
  | Readonly<{ type: 'issue'; issue: CaptureIssue }>;

export type CaptureOptions = Readonly<{
  includeStatic?: boolean;
}>;

export interface CaptureSource {
  subscribe(listener: (event: CaptureEvent) => void): () => void;
  begin(startedAt: number, options?: CaptureOptions): Promise<void>;
  reconcile(): Promise<void>;
  visibility(visible: boolean): void;
  stop(stoppedAt: number): Promise<void>;
  dispose(): Promise<void>;
}
