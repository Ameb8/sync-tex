export function registerLatexLanguage(monaco) {
  monaco.languages.register({ id: 'latex' });

  monaco.languages.setMonarchTokensProvider('latex', {
    tokenizer: {
      root: [
        // Comments
        [/%.*/, 'comment'],

        // Commands: \command
        [/\\[a-zA-Z@]+/, 'keyword'],

        // Brackets
        [/[{}[\]()]/, '@brackets'],

        // Math mode (inline)
        [/\$/, { token: 'delimiter.math', next: '@math' }],

        // Numbers
        [/\d+/, 'number'],

        // Text
        [/[^\\%${}\[\]()]+/, 'text'],
      ],

      math: [
        // Exit math mode
        [/\$/, { token: 'delimiter.math', next: '@pop' }],

        // Commands inside math
        [/\\[a-zA-Z@]+/, 'keyword'],

        // Numbers in math
        [/\d+/, 'number'],

        // Operators
        [/[=+\-*/^_]/, 'operator'],

        [/[^\\$]+/, 'string.math'],
      ],
    },
  });

  // Optional: define language config (brackets, auto-close, etc.)
  monaco.languages.setLanguageConfiguration('latex', {
    comments: {
      lineComment: '%',
    },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '$', close: '$' },
    ],
  });
}