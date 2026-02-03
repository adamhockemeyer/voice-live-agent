'use client';

import { useRef } from 'react';

interface AgendaEditorProps {
  content: string;
  onChange: (content: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

function MarkdownButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded text-sm font-medium transition-colors"
    >
      {children}
    </button>
  );
}

export function AgendaEditor({ content, onChange, disabled, placeholder }: AgendaEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertMarkdown = (before: string, after: string = '', defaultText: string = 'text') => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = content.substring(start, end) || defaultText;
    const newContent =
      content.substring(0, start) +
      before +
      selectedText +
      after +
      content.substring(end);

    onChange(newContent);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(
        start + before.length,
        start + before.length + selectedText.length
      );
    }, 0);
  };

  const insertAtLineStart = (prefix: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const lineStart = content.lastIndexOf('\n', start - 1) + 1;
    const newContent = content.substring(0, lineStart) + prefix + ' ' + content.substring(lineStart);

    onChange(newContent);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length + 1, start + prefix.length + 1);
    }, 0);
  };

  return (
    <div className="border rounded-lg dark:border-gray-600 overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 p-2 border-b dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50">
        <MarkdownButton
          onClick={() => insertMarkdown('**', '**', 'bold')}
          title="Bold (Ctrl+B)"
        >
          <strong>B</strong>
        </MarkdownButton>
        <MarkdownButton
          onClick={() => insertMarkdown('*', '*', 'italic')}
          title="Italic"
        >
          <em>I</em>
        </MarkdownButton>
        <MarkdownButton
          onClick={() => insertMarkdown('~~', '~~', 'strikethrough')}
          title="Strikethrough"
        >
          <s>S</s>
        </MarkdownButton>

        <div className="w-px bg-gray-300 dark:bg-gray-600" />

        <MarkdownButton
          onClick={() => insertMarkdown('# ', '', 'Heading')}
          title="Heading"
        >
          H1
        </MarkdownButton>
        <MarkdownButton
          onClick={() => insertAtLineStart('-')}
          title="Bullet List"
        >
          •
        </MarkdownButton>
        <MarkdownButton
          onClick={() => insertAtLineStart('1.')}
          title="Numbered List"
        >
          1.
        </MarkdownButton>

        <div className="w-px bg-gray-300 dark:bg-gray-600" />

        <MarkdownButton
          onClick={() => insertMarkdown('`', '`', 'code')}
          title="Inline Code"
        >
          {'</>'}
        </MarkdownButton>
        <MarkdownButton
          onClick={() => insertMarkdown('```\n', '\n```', 'code block')}
          title="Code Block"
        >
          {'</>'}
        </MarkdownButton>
      </div>

      {/* Editor */}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder || 'Enter agent instructions in markdown...'}
        className="w-full min-h-[300px] p-4 border-0 rounded-lg font-mono text-sm dark:bg-gray-800 dark:text-white resize-none focus:outline-none disabled:opacity-50"
      />
    </div>
  );
}
