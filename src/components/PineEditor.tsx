'use client';

import { useRef, useEffect } from 'react';
import Editor, { useMonaco, Monaco } from '@monaco-editor/react';

interface PineEditorProps {
  value: string;
  onChange: (value: string | undefined) => void;
  readOnly?: boolean;
}

export function PineEditor({ value, onChange, readOnly = false }: PineEditorProps) {
  const monaco = useMonaco();
  
  useEffect(() => {
    // Ignore Monaco Editor cancellation errors which cause Next.js to crash with [object Object]
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      // Monaco editor frequently throws generic objects or "cancelation" errors
      if (typeof event.reason === 'object' && !(event.reason instanceof Error)) {
        event.preventDefault();
        console.warn('Suppressed Monaco Editor unhandled rejection:', event.reason);
      }
    };
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => window.removeEventListener('unhandledrejection', handleUnhandledRejection);
  }, []);
  
  useEffect(() => {
    if (monaco) {
      // Register custom language for syntax highlighting
      monaco.languages.register({ id: 'pine' });
      
      monaco.languages.setMonarchTokensProvider('pine', {
        keywords: [
          'if', 'else', 'for', 'to', 'and', 'or', 'not', 'true', 'false', 'null',
          'var', 'varip', 'switch', 'while', 'continue', 'break', 'return', 'import', 'export'
        ],
        builtins: [
          'open', 'high', 'low', 'close', 'volume', 'time', 'hl2', 'hlc3', 'ohlc4'
        ],
        functions: [
          'strategy', 'indicator', 'library',
          'ta.sma', 'ta.ema', 'ta.rsi', 'ta.macd', 'ta.crossover', 'ta.crossunder',
          'ta.highest', 'ta.lowest', 'ta.atr', 'ta.stoch',
          'strategy.entry', 'strategy.close', 'strategy.exit', 'strategy.cancel',
          'strategy.long', 'strategy.short', 'strategy.position_size'
        ],
        operators: [
          '=', ':=', '==', '!=', '>', '<', '>=', '<=', '+', '-', '*', '/'
        ],
        tokenizer: {
          root: [
            // Identifiers and keywords
            [/[a-zA-Z_][\w.]*/, {
              cases: {
                '@keywords': 'keyword',
                '@builtins': 'type.identifier',
                '@functions': 'support.function',
                '@default': 'identifier'
              }
            }],
            // Whitespace
            { include: '@whitespace' },
            // Numbers
            [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
            [/\d+/, 'number'],
            // Strings
            [/"([^"\\]|\\.)*$/, 'string.invalid'],
            [/"/, { token: 'string.quote', bracket: '@open', next: '@string' }],
            [/'([^'\\]|\\.)*$/, 'string.invalid'],
            [/'/, { token: 'string.quote', bracket: '@open', next: '@string_single' }],
          ],
          whitespace: [
            [/[ \t\r\n]+/, 'white'],
            [/\/\/.*$/, 'comment'],
          ],
          string: [
            [/[^\\"]+/, 'string'],
            [/\\./, 'string.escape.invalid'],
            [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
          ],
          string_single: [
            [/[^\\']+/, 'string'],
            [/\\./, 'string.escape.invalid'],
            [/'/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
          ],
        }
      });
      
      // Define a custom theme that matches our premium dark mode
      monaco.editor.defineTheme('pine-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'keyword', foreground: 'C678DD' },
          { token: 'type.identifier', foreground: 'E5C07B' },
          { token: 'support.function', foreground: '61AFEF' },
          { token: 'number', foreground: 'D19A66' },
          { token: 'string', foreground: '98C379' },
          { token: 'comment', foreground: '5C6370', fontStyle: 'italic' },
        ],
        colors: {
          'editor.background': '#161920', // matches --panel-bg
          'editor.foreground': '#e1e4e8',
          'editorLineNumber.foreground': '#4b5263',
          'editor.selectionBackground': '#2c313a',
          'editor.inactiveSelectionBackground': '#2c313a',
        }
      });
    }
  }, [monaco]);

  return (
    <Editor
      height="100%"
      defaultLanguage="pine"
      theme="pine-dark"
      value={value}
      onChange={onChange}
      options={{
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontSize: 14,
        fontFamily: "'Fira Code', 'JetBrains Mono', 'Courier New', monospace",
        fontLigatures: true,
        padding: { top: 16 },
        readOnly,
        renderLineHighlight: 'all',
        hideCursorInOverviewRuler: true,
        overviewRulerBorder: false,
        scrollbar: {
          vertical: 'hidden',
          horizontal: 'hidden'
        }
      }}
    />
  );
}
