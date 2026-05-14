export const INTERRUPTED_IMAGE_ERROR = "页面已刷新，任务已中断";
export const PARTIAL_INTERRUPTED_TURN_ERROR = "任务已中断";

type RuntimeStatus = "generating" | "success" | "error";

function isRuntimeStatus(status: unknown): status is RuntimeStatus {
  return status === "generating" || status === "success" || status === "error";
}

type RuntimeImage = {
  id?: string;
  status?: string;
  startedAt?: number;
  durationMs?: number;
  error?: string;
  b64_json?: string;
  url?: string;
  [key: string]: unknown;
};

type RuntimeTurn = {
  id?: string;
  status?: string;
  images?: RuntimeImage[];
  error?: string;
  [key: string]: unknown;
};

type RuntimeConversation = {
  id?: string;
  status?: string;
  turns?: RuntimeTurn[];
  images?: RuntimeImage[];
  error?: string;
  [key: string]: unknown;
};

type NormalizeRuntimeStateOptions = {
  now?: () => number;
  isTurnActive?: (conversationId: string, turnId: string) => boolean;
};

function isSuccessImage(image: RuntimeImage) {
  return image.status === "success" || Boolean(image.b64_json || image.url);
}

function hasLoadingImage(turn: RuntimeTurn) {
  return (turn.images ?? []).some((image) => image.status === "loading");
}

function shouldArchiveInterruptedTurn(
  conversationId: string,
  turn: RuntimeTurn,
  isTurnActive: NormalizeRuntimeStateOptions["isTurnActive"],
) {
  if (turn.status !== "generating" && !hasLoadingImage(turn)) {
    return false;
  }
  return !isTurnActive?.(conversationId, String(turn.id || ""));
}

function archiveInterruptedTurn<TTurn extends RuntimeTurn>(turn: TTurn, now: () => number): TTurn {
  const images = turn.images ?? [];
  const hasSuccessfulImage = images.some(isSuccessImage);
  const interruptedAt = now();
  const errorMessage = hasSuccessfulImage
    ? turn.error || PARTIAL_INTERRUPTED_TURN_ERROR
    : INTERRUPTED_IMAGE_ERROR;

  return {
    ...turn,
    status: "error",
    error: errorMessage,
    images: images.map((image) =>
      image.status === "loading"
        ? {
          ...image,
          status: "error",
          durationMs:
            typeof image.startedAt === "number"
              ? Math.max(0, interruptedAt - image.startedAt)
              : image.durationMs,
          error: INTERRUPTED_IMAGE_ERROR,
        }
        : image,
    ),
  } as TTurn;
}

function getRuntimeTurns<TConversation extends RuntimeConversation>(conversation: TConversation) {
  if (Array.isArray(conversation.turns) && conversation.turns.length > 0) {
    return {
      turns: conversation.turns,
      derivedFromLegacyImages: false,
    };
  }
  if (Array.isArray(conversation.images) && conversation.images.length > 0) {
    return {
      turns: [
        {
          id: `${String(conversation.id || "conversation")}-legacy`,
          status: conversation.status,
          images: conversation.images,
          error: conversation.error,
        },
      ],
      derivedFromLegacyImages: true,
    };
  }
  return {
    turns: [],
    derivedFromLegacyImages: false,
  };
}

function deriveConversationStatus(turns: RuntimeTurn[], fallback?: string): RuntimeStatus {
  if (turns.some((turn) => turn.status === "generating" || hasLoadingImage(turn))) {
    return "generating";
  }
  if (turns.some((turn) => turn.status === "error" || (turn.images ?? []).some((image) => image.status === "error"))) {
    return "error";
  }
  if (turns.length > 0 && turns.every((turn) => turn.status === "success")) {
    return "success";
  }
  return isRuntimeStatus(fallback) ? fallback : "success";
}

function deriveConversationError(
  turns: RuntimeTurn[],
  status: RuntimeStatus,
  fallback?: string,
) {
  if (status !== "error") {
    return undefined;
  }
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.status === "error" && turn.error) {
      return turn.error;
    }
  }
  return fallback;
}

export function normalizeImageConversationRuntimeState<TConversation extends RuntimeConversation>(
  items: TConversation[],
  options: NormalizeRuntimeStateOptions = {},
) {
  const now = options.now ?? Date.now;
  const normalized = items.map((conversation) => {
    const conversationId = String(conversation.id || "");
    let archived = false;
    const runtimeTurns = getRuntimeTurns(conversation);
    const turns = runtimeTurns.turns.map((turn) => {
      if (!shouldArchiveInterruptedTurn(conversationId, turn, options.isTurnActive)) {
        return turn;
      }

      archived = true;
      return archiveInterruptedTurn(turn, now);
    });
    const status = deriveConversationStatus(turns, conversation.status);
    const error = deriveConversationError(turns, status, conversation.error);
    const nextConversation = {
      ...conversation,
      status,
      error,
      turns,
    } as TConversation;

    return {
      conversation: nextConversation,
      changed:
        archived ||
        status !== conversation.status ||
        error !== conversation.error ||
        runtimeTurns.derivedFromLegacyImages,
    };
  });

  return {
    items: normalized.map((item) => item.conversation),
    changedItems: normalized.filter((item) => item.changed).map((item) => item.conversation),
    changed: normalized.some((item) => item.changed),
  };
}
