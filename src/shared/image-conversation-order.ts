export type ImageConversationOrderTurn = {
  createdAt?: string | null;
};

export type ImageConversationOrderItem = {
  createdAt?: string | null;
  turns?: readonly ImageConversationOrderTurn[] | null;
};

function toTimestamp(value: string | null | undefined) {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

export function getImageConversationActivityAt(item: ImageConversationOrderItem) {
  let activityAt = typeof item.createdAt === "string" ? item.createdAt : "";
  let activityTime = toTimestamp(activityAt);

  for (const turn of item.turns ?? []) {
    const candidateAt = typeof turn?.createdAt === "string" ? turn.createdAt : "";
    const candidateTime = toTimestamp(candidateAt);
    if (candidateTime > activityTime) {
      activityAt = candidateAt;
      activityTime = candidateTime;
    }
  }

  return activityAt;
}

export function compareImageConversationsByActivityDesc(
  a: ImageConversationOrderItem,
  b: ImageConversationOrderItem,
) {
  const aTime = toTimestamp(getImageConversationActivityAt(a));
  const bTime = toTimestamp(getImageConversationActivityAt(b));

  if (aTime !== bTime) {
    return bTime > aTime ? 1 : -1;
  }

  const aCreatedAt = typeof a.createdAt === "string" ? a.createdAt : "";
  const bCreatedAt = typeof b.createdAt === "string" ? b.createdAt : "";
  return bCreatedAt.localeCompare(aCreatedAt);
}

export function sortImageConversationsByActivity<T extends ImageConversationOrderItem>(
  items: readonly T[],
) {
  return [...items].sort(compareImageConversationsByActivityDesc);
}
