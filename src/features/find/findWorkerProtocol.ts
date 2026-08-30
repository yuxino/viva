import type { FindMatch, FindOptions } from "./find";

export interface FindWorkerInitializeRequest {
  activeIndex: number;
  generation: number;
  options: FindOptions;
  query: string;
  requestId: number;
  selectionOffset?: number;
  source: string;
  type: "initialize";
}

export interface FindWorkerSelectRequest {
  activeIndex: number;
  generation: number;
  requestId: number;
  type: "select";
}

export type FindWorkerRequest =
  | FindWorkerInitializeRequest
  | FindWorkerSelectRequest;

export interface FindWorkerResponse {
  activeIndex: number;
  count: number;
  generation: number;
  match?: FindMatch;
  requestId: number;
}
