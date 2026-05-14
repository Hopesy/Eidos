import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { ImageGenerationQuality, ImageModel, ImageOutputFormat } from "@/lib/api";
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

export type RetryAbortControllerEntry = {
  controller: AbortController;
  conversationId: string;
  turnId: string;
  imageIds: string[];
  retractOnCancel?: boolean;
};

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
  resetComposer: (
    nextMode?: ImageMode,
    options?: {
      preserveImageSize?: boolean;
      preserveImageQuality?: boolean;
      preserveUpscaleQuality?: boolean;
      preserveImageFormat?: boolean;
    },
  ) => void;
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
  imageSize: ImageRatioOption;
  imageQuality: ImageGenerationQuality;
  imageFormat: ImageOutputFormat;
};

export type RetryTurnContext = Pick<SubmissionContext, "focusConversation" | "updateConversation"> & {
  retryAbortControllersRef: MutableRefObject<Map<string, RetryAbortControllerEntry>>;
  retractTurnAfterAbort: (conversationId: string, turnId: string) => Promise<boolean>;
};

export type SubmitContext = SubmissionContext & {
  selectedConversationId: string | null;
  usesImageApiService: boolean;
  mode: ImageMode;
  imagePrompt: string;
  imageSources: StoredSourceImage[];
  maskSource: StoredSourceImage | null;
  parsedCount: number;
  imageModel: ImageModel;
  imageSize: ImageRatioOption;
  imageQuality: ImageGenerationQuality;
  imageFormat: ImageOutputFormat;
  upscaleQuality: ImageGenerationQuality;
  sourceImages: StoredSourceImage[];
};
