import type { InteractionEvent } from '../domain/model';

export interface InteractionSource {
  start(tabId: string): Promise<void>;
  stop(): Promise<void>;
  subscribe(listener: (event: InteractionEvent) => void): () => void;
}
