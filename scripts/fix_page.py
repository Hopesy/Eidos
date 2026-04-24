"""Replace the render section of src/app/image/page.tsx with subcomponent calls."""
from pathlib import Path

path = Path('src/app/image/page.tsx')
text = path.read_text(encoding='utf-8')

MARKER = '  // \u2500\u2500\u2500 Render \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'

if MARKER not in text:
    print('ERROR: marker not found')
    raise SystemExit(1)

prefix = text[:text.index(MARKER)]

new_tail = r"""  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <section
      className={cn(
        "grid grid-cols-1 gap-3",
        historyCollapsed
          ? "lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)]"
          : "lg:h-full lg:min-h-0 lg:grid-cols-[320px_minmax(0,1fr)]",
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

      <div className="order-1 flex flex-col overflow-visible rounded-[30px] border border-stone-200 bg-white shadow-[0_14px_40px_rgba(15,23,42,0.05)] lg:order-none lg:min-h-0 lg:overflow-hidden">
        <ComposerPanel
          historyCollapsed={historyCollapsed}
          onToggleHistoryCollapsed={() => setHistoryCollapsed((current) => !current)}
          selectedConversationTitle={selectedConversation?.title ?? null}
          imageModel={imageModel}
          imageModelOptions={imageModelOptions as ImageModelOption[]}
          modeOptions={modeOptions as ModeOption[]}
          mode={mode}
          onModeChange={setMode}
          onImageModelChange={setImageModel}
          hasGenerateReferences={hasGenerateReferences}
          imageCount={imageCount}
          onImageCountChange={setImageCount}
          upscaleScale={upscaleScale}
          upscaleOptions={upscaleOptions}
          onUpscaleScaleChange={setUpscaleScale}
          availableQuota={availableQuota}
          sourceImages={sourceImages}
          onRemoveSourceImage={removeSourceImage}
          onOpenImageInNewTab={openImageInNewTab}
          textareaRef={textareaRef}
          imagePrompt={imagePrompt}
          onImagePromptChange={setImagePrompt}
          onPromptPaste={handlePromptPaste}
          onSubmit={() => {
            void handleSubmit();
          }}
          isSubmitting={isSubmitting}
          uploadInputRef={uploadInputRef}
          maskInputRef={maskInputRef}
          onUploadFiles={(files, role) => {
            void appendFiles(files, role);
          }}
        />

        <div
          ref={resultsViewportRef}
          className="hide-scrollbar overflow-visible bg-[#fcfcfb] lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
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
                  onOpenImageInNewTab={openImageInNewTab}
                  onOpenSelectionEditor={openSelectionEditor}
                  onSeedFromResult={seedFromResult}
                  onRetryTurn={(conversationId, currentTurn) => {
                    void handleRetryTurn(conversationId, currentTurn);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

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
    </section>
  );
}
"""

path.write_text(prefix + new_tail, encoding='utf-8')
lines = (prefix + new_tail).count('\n')
print(f'done – wrote {lines} lines')
