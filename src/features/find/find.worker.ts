import { buildLiteralFindIndex, type LiteralFindIndex } from "./findIndex";
import type {
  FindWorkerRequest,
  FindWorkerResponse,
} from "./findWorkerProtocol";

interface FindWorkerCache {
  generation: number;
  index: LiteralFindIndex;
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<FindWorkerRequest>) => void) | null;
  postMessage: (message: FindWorkerResponse) => void;
};

let cache: FindWorkerCache | null = null;

function matchFromCache(activeIndex: number): {
  activeIndex: number;
  match?: { end: number; start: number };
} {
  return cache?.index.select(activeIndex) ?? { activeIndex: -1 };
}

function initialize(request: Extract<FindWorkerRequest, { type: "initialize" }>) {
  const index = buildLiteralFindIndex(
    request.source,
    request.query,
    request.options,
    request.selectionOffset,
  );
  cache = {
    generation: request.generation,
    index,
  };
  const selected = matchFromCache(
    index.offsetIndex >= 0 ? index.offsetIndex : request.activeIndex,
  );
  workerScope.postMessage({
    ...selected,
    count: index.count,
    generation: request.generation,
    requestId: request.requestId,
  });
}

workerScope.onmessage = (event) => {
  const request = event.data;
  if (request.type === "initialize") {
    initialize(request);
    return;
  }
  if (!cache || cache.generation !== request.generation) return;
  workerScope.postMessage({
    ...matchFromCache(request.activeIndex),
    count: cache.index.count,
    generation: request.generation,
    requestId: request.requestId,
  });
};
