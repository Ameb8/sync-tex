import { loader } from '@monaco-editor/react';

import { registerLatexLanguage } from './monarchLatex';
import darkTheme from './themes/monokai.json';
import lightTheme from './themes/github-light.json';

let setupPromise = null;

export function setupMonaco() {
  if (!setupPromise) {
    setupPromise = loader.init().then((monaco) => {
      registerLatexLanguage(monaco);
      monaco.editor.defineTheme('app-dark', darkTheme);
      monaco.editor.defineTheme('app-light', lightTheme);
      return monaco;
    });
  }

  return setupPromise;
}
