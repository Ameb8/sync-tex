import { loadWASM } from 'vscode-oniguruma';
import { Registry } from 'monaco-textmate';
import { wireTmGrammars } from 'monaco-editor-textmate';

let initialized = false;

async function initOniguruma() {
  if (initialized) return;
  const response = await fetch('/assets/onig.wasm');
  if (!response.ok) throw new Error(`Failed to load onig.wasm: ${response.status}`);
  const buffer = await response.arrayBuffer();
  await loadWASM(buffer);
  initialized = true;
}

function createRegistry() {
  return new Registry({
    getGrammarDefinition: async (scopeName) => {
      console.log('[textmate] grammar requested for scope:', scopeName);
      if (scopeName === 'text.tex.latex' || scopeName === 'text.tex') {
        const response = await fetch('/assets/grammars/latex.tmLanguage.json');
        if (!response.ok) throw new Error(`Failed to load grammar: ${response.status}`);
        const grammar = await response.text();
        return { format: 'json', content: grammar };
      }
      // Return a minimal empty grammar for embedded scopes we don't support.
      // monaco-textmate treats null as a fatal error, but an empty grammar
      // is accepted and simply produces no highlighting for that language.
      return {
        format: 'json',
        content: JSON.stringify({
          name: scopeName,
          scopeName,
          patterns: [],
        }),
      };
    },
  });
}

export async function activateTextmate(monaco) {
  try {
    await initOniguruma();
    const grammars = new Map([['latex', 'text.tex.latex']]);
    const registry = createRegistry();
    await wireTmGrammars(monaco, registry, grammars);
    console.log('[textmate] LaTeX grammar activated');
  } catch (err) {
    console.warn('[textmate] Failed to activate grammar:', err);
  }
}

export function registerLatexLanguage(monaco) {
  const already = monaco.languages.getLanguages().some(l => l.id === 'latex');
  if (!already) {
    monaco.languages.register({ id: 'latex', extensions: ['.tex', '.bib'] });
    console.log('[textmate] latex language pre-registered');
  }
}