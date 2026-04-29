import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { ImageGenerationQuality, ImageModel } from "@/lib/api";
import type {
  ImageConversation,
  ImageConversationTurn,
  ImageMode,
  StoredImage,
  StoredSourceImage,
} from "@/store/image-conversations";
import type { ImageRatioOption } from "@/shared/image-generation";

import type { ActiveRequestState } from "./utils";

export type PendingAbortAction = {
  conversationId: string;
  turnId: string;
  retractTurn: boolean;
};

export type ActiveRequestMeta = {
  conversationId: string;
  turnId: string;
  retractOnEdit: boolean;
};

export type EditorTarget = {
  conversationId: string;
  turnId: string;
  image: StoredImage;
  imageName: string;
  sourceDataUrl: string;
};

export type UpdateConversationFn = (
  conversationId: string,
  updater: (current: ImageConversation) => ImageConversation,
) => Promise<void>;

export type PersistConversationFn = (conversation: ImageConversation) => Promise<void>;

export type RestoreComposerFn = (
  conversationId: string | null,
  turn: ImageConversationTurn,
  successMessage?: string,
) => void;

export type SubmissionContext = {
  mountedRef: MutableRefObject<boolean>;
  requestAbortControllerRef: MutableRefObject<AbortController | null>;
  pendingAbortActionRef: MutableRefObject<PendingAbortAction | null>;
  activeRequestMetaRef: MutableRefObject<ActiveRequestMeta | null>;
  setIsSubmitting: Dispatch<SetStateAction<boolean>>;
  setActiveRequest: Dispatch<SetStateAction<ActiveRequestState | null>>;
  setSubmitElapsedSeconds: Dispatch<SetStateAction<number>>;
  setSubmitStartedAt: Dispatch<SetStateAction<number | null>>;
  setConversations: Dispatch<SetStateAction<ImageConversation[]>>;
  setImagePrompt: Dispatch<SetStateAction<string>>;
  setSourceImages: Dispatch<SetStateAction<StoredSourceImage[]>>;
  setEditorTarget: Dispatch<SetStateAction<EditorTarget | null>>;
  focusConversation: (conversationId: string) => void;
  updateConversation: UpdateConversationFn;
  persistConversation: PersistConversationFn;
  resetComposer: (nextMode?: ImageMode) => void;
  retractTurnAfterAbort: (conversationId: string, turnId: string) => Promise<boolean>;
  restoreComposerFromTurn: RestoreComposerFn;
};

export type SelectionEditParams = {
  prompt: string;
  mask: {
    file: File;
    previewDataUrl: string;
  };
};

export type SelectionEditContext = SubmissionContext & {
  editorTarget: EditorTarget | null;
  imageModel: ImageModel;
};

export type RetryTurnContext = SubmissionContext & {
  isSubmitting: boolean;
};

export type SubmitContext = SubmissionContext & {
  selectedConversationId: string | null;
  mode: ImageMode;
  imagePrompt: string;
  imageSources: StoredSourceImage[];
  maskSource: StoredSourceImage | null;
  parsedCount: number;
  imageModel: ImageModel;
  imageSize: ImageRatioOption;
  imageQuality: ImageGenerationQuality;
  upscaleQuality: ImageGenerationQuality;
  sourceImages: StoredSourceImage[];
};
