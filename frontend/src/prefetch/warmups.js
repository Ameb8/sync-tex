let editorWarmupPromise = null;
let aiWarmupPromise = null;

export function warmEditorRoute() {
  if (!editorWarmupPromise) {
    editorWarmupPromise = import('../views/EditorView');
  }

  return editorWarmupPromise;
}

export function warmAIPanel() {
  if (!aiWarmupPromise) {
    aiWarmupPromise = Promise.all([
      import('../components/Editor/AIPanel/ChatSidebar'),
      import('../components/Editor/AIPanel/ChatWindow'),
      import('../components/Editor/AIPanel/MessageList'),
    ]);
  }

  return aiWarmupPromise;
}
