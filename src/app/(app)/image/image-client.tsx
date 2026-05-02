"use client";

import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";

import { ImageEditModal } from "@/components/image-edit-modal";
import { ImagePreviewModal } from "@/components/image-preview-modal";
import {
  imageModelOptions,
  imageQualityOptions,
  imageSizeOptions,
  inspirationExamples,
  modeOptions,
  upscaleQualityOptions,
} from "@/features/image-workbench/page-options";
import { useImagePage } from "@/features/image-workbench/use-image-page";
import type { RecoverableImageTaskItem } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ImageFileListItem } from "@/server/repositories/image/file-repository";
import type { ImageConversation } from "@/store/image-conversations";

import { ComposerPanel } from "./_components/composer-panel";
import { ConversationTurn } from "./_components/conversation-turn";
import { EmptyState } from "./_components/empty-state";
import { FilesSidebar } from "./_components/files-sidebar";
import { HistorySidebar } from "./_components/history-sidebar";

type ImageClientProps = {
  initialConversations: ImageConversation[];
  initialFiles: ImageFileListItem[];
  initialRecoverableTasks: RecoverableImageTaskItem[];
  initialAvailableQuota: string;
};

export function ImageClient({
  initialConversations,
  initialFiles,
  initialRecoverableTasks,
  initialAvailableQuota,
}: ImageClientProps) {
  const {
    uploadInputRef,
    maskInputRef,
    textareaRef,
    resultsViewportRef,
    mode,
    imagePrompt,
    setImagePrompt,
    imageCount,
    setImageCount,
    imageModel,
    setImageModel,
    imageSize,
    setImageSize,
    imageQuality,
    setImageQuality,
    upscaleQuality,
    setUpscaleQuality,
    historyCollapsed,
    setHistoryCollapsed,
    filesCollapsed,
    setFilesCollapsed,
    isLoadingHistory,
    isSubmitting,
    availableQuota,
    activeRequest,
    editorTarget,
    setEditorTarget,
    maskEditorTarget,
    setMaskEditorTarget,
    previewImage,
    setPreviewImage,
    selectedConversation,
    selectedConversationTurns,
    selectedConversationId,
    conversations,
    visibleSourceImages,
    hasGenerateReferences,
    canToggleLatestResultReference,
    isLatestResultReferenceEnabled,
    processingStatus,
    waitingDots,
    submitElapsedSeconds,
    focusConversation,
    handleCreateDraft,
    handleDeleteConversation,
    handleClearHistory,
    handleModeChange,
    applyPromptExample,
    appendFiles,
    handlePromptPaste,
    removeSourceImage,
    handleToggleLatestResultReference,
    seedFromResult,
    openSelectionEditor,
    handleSelectionEditSubmit,
    handleMaskEditorSubmit,
    handleRetryTurn,
    handleSubmit,
    handleComposerCancelAction,
    composerCancelLabel,
    composerCancelTitle,
    handleEditTurn,
    handleCopyTurnPrompt,
    openImageInNewTab,
    downloadImageFile,
  } = useImagePage({ initialConversations, initialRecoverableTasks, initialAvailableQuota });

  return (
    <section
      className={cn(
        "grid grid-cols-1 gap-1",
        historyCollapsed && filesCollapsed
          ? "lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)]"
          : historyCollapsed && !filesCollapsed
            ? "lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_240px]"
            : !historyCollapsed && filesCollapsed
              ? "lg:h-full lg:min-h-0 lg:grid-cols-[240px_minmax(0,1fr)]"
              : "lg:h-full lg:min-h-0 lg:grid-cols-[240px_minmax(0,1fr)_240px]",
      )}
    >
      {!historyCollapsed ? (
        <HistorySidebar
          conversations={conversations}
          selectedConversationId={selectedConversationId}
          isLoadingHistory={isLoadingHistory}
          onSelect={focusConversation}
          onDelete={(id) => {
            void handleDeleteConversation(id);
          }}
          onCreateDraft={handleCreateDraft}
          onClearHistory={() => {
            void handleClearHistory();
          }}
        />
      ) : null}

      <div className="order-1 flex flex-col overflow-visible rounded-[18px] border border-stone-200 bg-white shadow-[0_14px_40px_rgba(15,23,42,0.05)] lg:order-none lg:min-h-0 lg:overflow-hidden dark:border-stone-700 dark:bg-stone-900">
        <div className="shrink-0 border-b border-stone-200/80 bg-white px-4 py-2.5 sm:px-6 dark:border-stone-700 dark:bg-stone-900">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setHistoryCollapsed((current) => !current)}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-stone-200 text-stone-500 transition hover:bg-stone-50 hover:text-stone-900 dark:border-stone-700 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                title={historyCollapsed ? "展开历史" : "收起历史"}
              >
                {historyCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
              </button>
              <h1 className="shrink-0 text-sm font-medium text-stone-900 dark:text-stone-100">图片工作台</h1>
              <span className="text-stone-300 dark:text-stone-600">/</span>
              {selectedConversation?.title ? (
                <span className="truncate text-xs text-stone-500 dark:text-stone-400">
                  {selectedConversation.title}
                </span>
              ) : (
                <span className="truncate text-xs text-stone-400 dark:text-stone-500">新会话草稿</span>
              )}
            </div>

            <button
              type="button"
              onClick={() => setFilesCollapsed((current) => !current)}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-stone-200 text-stone-500 transition hover:bg-stone-50 hover:text-stone-900 dark:border-stone-700 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
              title={filesCollapsed ? "展开文件" : "收起文件"}
            >
              {filesCollapsed ? <PanelRightOpen className="size-4" /> : <PanelRightClose className="size-4" />}
            </button>
          </div>
        </div>

        <div
          ref={resultsViewportRef}
          className="hide-scrollbar min-h-0 flex-1 overflow-visible bg-[#fcfcfb] lg:overflow-y-auto dark:bg-stone-950"
        >
          {!selectedConversation ? (
            <EmptyState examples={inspirationExamples} onApplyExample={applyPromptExample} />
          ) : (
            <div className="mx-auto flex w-full max-w-[980px] flex-col gap-8 px-4 py-8 sm:px-6">
              {selectedConversationTurns.map((turn) => (
                <ConversationTurn
                  key={turn.id}
                  turn={turn}
                  conversationId={selectedConversation.id}
                  isProcessing={Boolean(
                    isSubmitting &&
                      activeRequest &&
                      activeRequest.conversationId === selectedConversation.id &&
                      activeRequest.turnId === turn.id,
                  )}
                  processingStatus={processingStatus}
                  waitingDots={waitingDots}
                  submitElapsedSeconds={submitElapsedSeconds}
                  isSubmitting={isSubmitting}
                  retryingImageId={
                    turn.images.find((image) => image.status === "loading")?.id ?? null
                  }
                  onOpenImageInNewTab={openImageInNewTab}
                  onOpenSelectionEditor={openSelectionEditor}
                  onSeedFromResult={seedFromResult}
                  onRetryTurn={(conversationId, currentTurn, imageId) => {
                    void handleRetryTurn(conversationId, currentTurn, imageId);
                  }}
                  onPreviewImage={(dataUrl) => setPreviewImage(dataUrl)}
                  onEditTurn={handleEditTurn}
                  onCopyPrompt={(prompt) => {
                    void handleCopyTurnPrompt(prompt);
                  }}
                  onDownloadImage={downloadImageFile}
                />
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0">
          <ComposerPanel
            imageModel={imageModel}
            imageModelOptions={imageModelOptions}
            modeOptions={modeOptions}
            mode={mode}
            onModeChange={handleModeChange}
            onImageModelChange={setImageModel}
            hasGenerateReferences={hasGenerateReferences}
            imageCount={imageCount}
            onImageCountChange={setImageCount}
            imageSize={imageSize}
            imageSizeOptions={imageSizeOptions}
            onImageSizeChange={setImageSize}
            imageQuality={imageQuality}
            imageQualityOptions={imageQualityOptions}
            onImageQualityChange={setImageQuality}
            upscaleQuality={upscaleQuality}
            upscaleQualityOptions={upscaleQualityOptions}
            onUpscaleQualityChange={setUpscaleQuality}
            availableQuota={availableQuota}
            sourceImages={visibleSourceImages}
            onRemoveSourceImage={removeSourceImage}
            canToggleLatestResultReference={canToggleLatestResultReference}
            useLatestResultAsReference={isLatestResultReferenceEnabled}
            onToggleLatestResultReference={handleToggleLatestResultReference}
            onOpenImageInNewTab={openImageInNewTab}
            textareaRef={textareaRef}
            imagePrompt={imagePrompt}
            onImagePromptChange={setImagePrompt}
            onPromptPaste={handlePromptPaste}
            onSubmit={() => {
              void handleSubmit();
            }}
            onCancel={handleComposerCancelAction}
            cancelButtonLabel={composerCancelLabel}
            cancelButtonTitle={composerCancelTitle}
            isSubmitting={isSubmitting}
            uploadInputRef={uploadInputRef}
            maskInputRef={maskInputRef}
            onUploadFiles={(files, role) => {
              void appendFiles(files, role);
            }}
            onOpenMaskEditor={() => {
              void handleMaskEditorSubmit("open");
            }}
          />
        </div>
      </div>

      {!filesCollapsed ? (
        <FilesSidebar
          initialFiles={initialFiles}
          onOpenImage={(publicPath) => {
            setPreviewImage(publicPath);
          }}
        />
      ) : null}

      <ImagePreviewModal
        open={previewImage !== null}
        imageSrc={previewImage || ""}
        onClose={() => setPreviewImage(null)}
      />

      <ImageEditModal
        key={editorTarget?.turnId || "image-edit-modal"}
        open={Boolean(editorTarget)}
        imageName={editorTarget?.imageName || "image.png"}
        imageSrc={editorTarget?.sourceDataUrl || ""}
        isSubmitting={isSubmitting}
        onClose={() => {
          if (!isSubmitting) {
            setEditorTarget(null);
          }
        }}
        onSubmit={handleSelectionEditSubmit}
      />

      <ImageEditModal
        key={maskEditorTarget?.imageName || "mask-editor-modal"}
        open={Boolean(maskEditorTarget)}
        mode="mask-only"
        imageName={maskEditorTarget?.imageName || "source.png"}
        imageSrc={maskEditorTarget?.sourceDataUrl || ""}
        isSubmitting={isSubmitting}
        onClose={() => {
          if (!isSubmitting) {
            setMaskEditorTarget(null);
          }
        }}
        onSubmitMask={handleMaskEditorSubmit}
      />
    </section>
  );
}
