import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { toast } from "sonner";

import { fetchRecoverableImageTasks, type RecoverableImageTaskItem } from "@/lib/api";
import { clearImageConversations, deleteImageConversation, listImageConversations, normalizeConversation, saveImageConversation, updateImageConversation, type ImageConversation } from "@/store/image-conversations";
import { listActiveImageTasks } from "@/store/image-active-tasks";

import { normalizeConversationHistory, type ActiveRequestState } from "./utils";

type CachedWorkspaceState = {
  selectedConversationId: string | null;
  isDraftSelection: boolean;
};

type PersistConversationContext = {
  mountedRef: MutableRefObject<boolean>;
  setConversations: Dispatch<SetStateAction<ImageConversation[]>>;
};

type UpdateConversationContext = {
  mountedRef: MutableRefObject<boolean>;
  setConversations: Dispatch<SetStateAction<ImageConversation[]>>;
};

type RuntimeTaskContext = {
  setIsSubmitting: Dispatch<SetStateAction<boolean>>;
  setActiveRequest: Dispatch<SetStateAction<ActiveRequestState | null>>;
  setSubmitStartedAt: Dispatch<SetStateAction<number | null>>;
  setSubmitElapsedSeconds: Dispatch<SetStateAction<number>>;
};

type RefreshHistoryContext = {
  mountedRef: MutableRefObject<boolean>;
  draftSelectionRef: MutableRefObject<boolean>;
  setConversations: Dispatch<SetStateAction<ImageConversation[]>>;
  setRecoverableTasks: Dispatch<SetStateAction<RecoverableImageTaskItem[]>>;
  setSelectedConversationId: Dispatch<SetStateAction<string | null>>;
  setIsLoadingHistory: Dispatch<SetStateAction<boolean>>;
  setCachedWorkspaceState: (state: CachedWorkspaceState) => void;
};

type DeleteConversationContext = {
  draftSelectionRef: MutableRefObject<boolean>;
  setConversations: Dispatch<SetStateAction<ImageConversation[]>>;
  setSelectedConversationId: Dispatch<SetStateAction<string | null>>;
};

type ClearHistoryContext = {
  draftSelectionRef: MutableRefObject<boolean>;
  setConversations: Dispatch<SetStateAction<ImageConversation[]>>;
  setSelectedConversationId: Dispatch<SetStateAction<string | null>>;
};

function sortConversations(items: ImageConversation[]) {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function persistConversation(ctx: PersistConversationContext, conversation: ImageConversation) {
  const normalizedConversation = normalizeConversation(conversation);
  await saveImageConversation(normalizedConversation);
  if (!ctx.mountedRef.current) {
    return;
  }

  ctx.setConversations((prev) => {
    const next = [normalizedConversation, ...prev.filter((item) => item.id !== normalizedConversation.id)];
    return sortConversations(next);
  });
}

export async function updateConversation(
  ctx: UpdateConversationContext,
  conversationId: string,
  updater: (current: ImageConversation) => ImageConversation,
) {
  const nextConversation = await updateImageConversation(conversationId, updater);
  if (!ctx.mountedRef.current) {
    return;
  }

  ctx.setConversations((prev) => {
    const next = [nextConversation, ...prev.filter((item) => item.id !== conversationId)];
    return sortConversations(next);
  });
}

export function syncRuntimeTaskState(ctx: RuntimeTaskContext, preferredConversationId?: string | null) {
  const tasks = listActiveImageTasks();
  const nextTask =
    tasks.find((task) => preferredConversationId && task.conversationId === preferredConversationId) ?? tasks[0] ?? null;

  ctx.setIsSubmitting(tasks.length > 0);
  ctx.setActiveRequest(
    nextTask
      ? {
        conversationId: nextTask.conversationId,
        turnId: nextTask.turnId,
        mode: nextTask.mode,
        count: nextTask.count,
        variant: nextTask.variant,
      }
      : null,
  );
  ctx.setSubmitStartedAt(nextTask?.startedAt ?? null);
  if (!nextTask) {
    ctx.setSubmitElapsedSeconds(0);
  }
}

export async function refreshHistory(
  ctx: RefreshHistoryContext,
  options: { normalize?: boolean; silent?: boolean; withLoading?: boolean } = {},
) {
  const { normalize = false, silent = false, withLoading = false } = options;

  try {
    if (withLoading && ctx.mountedRef.current) {
      ctx.setIsLoadingHistory(true);
    }

    const [items, recoverableResponse] = await Promise.all([
      listImageConversations(),
      fetchRecoverableImageTasks(30).catch(() => ({ items: [] as RecoverableImageTaskItem[] })),
    ]);
    const nextItems = normalize ? await normalizeConversationHistory(items) : items;
    if (!ctx.mountedRef.current) {
      return;
    }

    ctx.setConversations(nextItems);
    ctx.setRecoverableTasks(Array.isArray(recoverableResponse.items) ? recoverableResponse.items : []);
    ctx.setSelectedConversationId((current) => {
      let nextSelectedConversationId: string | null = current;
      if (current && nextItems.some((item) => item.id === current)) {
        nextSelectedConversationId = current;
      } else if (ctx.draftSelectionRef.current) {
        nextSelectedConversationId = null;
      } else {
        const activeTaskConversationId = listActiveImageTasks()[0]?.conversationId;
        if (activeTaskConversationId && nextItems.some((item) => item.id === activeTaskConversationId)) {
          nextSelectedConversationId = activeTaskConversationId;
        } else {
          nextSelectedConversationId = nextItems[0]?.id ?? null;
        }
      }

      ctx.setCachedWorkspaceState({
        selectedConversationId: nextSelectedConversationId,
        isDraftSelection: ctx.draftSelectionRef.current && nextSelectedConversationId === null,
      });
      return nextSelectedConversationId;
    });
  } catch (error) {
    if (!silent) {
      const message = error instanceof Error ? error.message : "读取会话记录失败";
      toast.error(message);
    }
  } finally {
    if (withLoading && ctx.mountedRef.current) {
      ctx.setIsLoadingHistory(false);
    }
  }
}

export async function deleteConversation(ctx: DeleteConversationContext, conversations: ImageConversation[], id: string) {
  const nextConversations = conversations.filter((item) => item.id !== id);
  ctx.setConversations(nextConversations);
  ctx.setSelectedConversationId((prev) => {
    if (prev !== id) {
      return prev;
    }
    ctx.draftSelectionRef.current = false;
    return nextConversations[0]?.id ?? null;
  });

  try {
    await deleteImageConversation(id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除会话失败";
    toast.error(message);
    const items = await listImageConversations();
    ctx.setConversations(items);
  }
}

export async function clearHistory(ctx: ClearHistoryContext) {
  try {
    await clearImageConversations();
    ctx.draftSelectionRef.current = true;
    ctx.setConversations([]);
    ctx.setSelectedConversationId(null);
    toast.success("已清空历史记录");
  } catch (error) {
    const message = error instanceof Error ? error.message : "清空历史记录失败";
    toast.error(message);
  }
}
