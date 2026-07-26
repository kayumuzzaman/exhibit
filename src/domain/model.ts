export type RetentionMode = 'ephemeral' | 'persistent';

export type RecordingPhase = 'stopped' | 'starting' | 'recording' | 'stopping';

export type CaptureIssueCode =
  | 'classification-failed'
  | 'content-api-unavailable'
  | 'content-callback-timeout'
  | 'explanation-failed'
  | 'har-api-unavailable'
  | 'har-callback-timeout'
  | 'invalid-content-encoding'
  | 'invalid-har'
  | 'invalid-started-time'
  | 'interaction-start-failed'
  | 'normalization-failed'
  | 'redaction-failed'
  | 'sink-failed';

export type SessionWarningCode =
  | CaptureIssueCode
  | 'capture-failed'
  | 'corrupt-session'
  | 'migration-cleanup-failed'
  | 'migration-failed'
  | 'persistence-disabled'
  | 'request-too-large';

export type SessionWarning = Readonly<{
  code: SessionWarningCode;
  message: string;
  requestId?: string;
}>;

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
  sslMs?: number;
  sendMs?: number;
  waitMs?: number;
  receiveMs?: number;
}>;

export type CaptureEvidence = Readonly<{
  fromCache?: boolean;
  fromServiceWorker?: boolean;
  redirectUrl?: string;
  redirectParentId?: string;
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

export type ElementDescriptor = Readonly<{
  tag: string;
  role?: string;
  name?: string;
  id?: string;
  text?: string;
}>;

export type InteractionTrust = 'trusted' | 'untrusted-hint';

export type InteractionEvent = Readonly<{
  id: string;
  tabId: string;
  kind: 'click' | 'submit' | 'navigation' | 'history';
  occurredAt: number;
  trust: InteractionTrust;
  target?: ElementDescriptor;
  url?: string;
}>;

export type EventInteractionGroup = Readonly<{
  id: string;
  kind: 'event';
  event: InteractionEvent;
  requestIds: readonly string[];
}>;

export type UnattributedInteractionGroup = Readonly<{
  id: 'unattributed';
  kind: 'unattributed';
  event: null;
  requestIds: readonly string[];
}>;

export type InteractionGroup = EventInteractionGroup | UnattributedInteractionGroup;

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
  requestBytes: readonly number[];
  byteCount: number;
  interactions: readonly InteractionEvent[];
  evictedCount: number;
  warnings: readonly SessionWarning[];
}>;
