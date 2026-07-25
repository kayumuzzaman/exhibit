export type RetentionMode = 'ephemeral' | 'persistent';

export type RecordingPhase = 'recording' | 'stopped';

export type SessionLimits = Readonly<{
  maxRequests: number;
  maxBytes: number;
  maxBodyBytes: number;
}>;

export type Header = Readonly<{
  name: string;
  value: string;
}>;

export type BodyContentState =
  'available' | 'unavailable' | 'truncated' | 'binary' | 'streamed';

export type BodyContent = Readonly<{
  state: BodyContentState;
  size: number;
  capturedSize: number;
  text?: string;
  mimeType?: string;
  reason?: string;
}>;

export type RequestData = Readonly<{
  headers: readonly Header[];
  body?: BodyContent;
}>;

export type ResponseData = Readonly<{
  status: number;
  statusText?: string;
  headers: readonly Header[];
  body: BodyContent;
}>;

export type RequestTiming = Readonly<{
  totalMs: number;
  blockedMs?: number;
  dnsMs?: number;
  connectMs?: number;
  sendMs?: number;
  waitMs?: number;
  receiveMs?: number;
}>;

export type CaptureEvidence = Readonly<{
  fromCache?: boolean;
  fromServiceWorker?: boolean;
  redirectUrl?: string;
  initiator?: string;
}>;

export type Classification = Readonly<{
  kind: string;
  confidence: 'confirmed' | 'likely' | 'unknown';
  evidence: readonly string[];
  actionId?: string;
}>;

export type Explanation = Readonly<{
  outcome: string;
  summary: string;
  guidance: readonly string[];
  evidence: readonly string[];
}>;

export type CapturedRequest = Readonly<{
  id: string;
  url: string;
  method: string;
  startedAt: number;
  request: RequestData;
  response: ResponseData;
  timing: RequestTiming;
  evidence: CaptureEvidence;
  classification?: Classification;
  explanation?: Explanation;
}>;

export type InteractionEvent = Readonly<{
  id: string;
  tabId: string;
  kind: 'click' | 'submit' | 'navigation' | 'history';
  occurredAt: number;
  target?: string;
  url?: string;
}>;

export type InteractionGroup = Readonly<{
  id: string;
  event: InteractionEvent;
  requestIds: readonly string[];
}>;

export type RecordingSession = Readonly<{
  id: string;
  tabId: string;
  origin: string;
  phase: RecordingPhase;
  retention: RetentionMode;
  limits: SessionLimits;
  startedAt: number | null;
  stoppedAt: number | null;
  requests: readonly CapturedRequest[];
  interactions: readonly InteractionEvent[];
  evictedCount: number;
  warnings: readonly string[];
}>;
