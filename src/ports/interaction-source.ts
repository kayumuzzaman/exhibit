import type { InteractionEvent } from '../domain/model';

export type InteractionStartContext = Readonly<{
  tabId: number;
  url: string;
}>;

export type InteractionUnavailableReason =
  | 'injection-failed'
  | 'invalid-request'
  | 'invalid-response'
  | 'invalid-sender'
  | 'navigation-race'
  | 'permission-denied'
  | 'permission-error'
  | 'restricted-page'
  | 'superseded';

export type InteractionStartResult =
  | Readonly<{
      status: 'active';
      tabId: number;
      origin: string;
      documentId: string;
      leaseId: string;
    }>
  | Readonly<{
      status: 'network-only';
      reason: InteractionUnavailableReason;
    }>;

export interface InteractionSource {
  start(context: InteractionStartContext): Promise<InteractionStartResult>;
  stop(): Promise<void>;
  subscribe(listener: (event: InteractionEvent) => void): () => void;
}
