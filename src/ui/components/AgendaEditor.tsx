'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useCallback } from 'react';

interface AgendaEditorProps {
  content: string;
  onChange: (content: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

function ToolbarButton({
  onClick,
  isActive,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-2 rounded text-sm font-medium transition-colors ${isActive
          ? 'bg-blue-500 text-white'
          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

export function AgendaEditor({ content, onChange, disabled, placeholder }: AgendaEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: content,
    editable: !disabled,
    onUpdate: ({ editor }) => {
      onChange(editor.getText());
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[200px] p-3',
      },
    },
  });

  // Update content when prop changes externally
  useEffect(() => {
    if (editor && content !== editor.getText()) {
      editor.commands.setContent(content);
    }
  }, [content, editor]);

  // Update editable state
  useEffect(() => {
    if (editor) {
      editor.setEditable(!disabled);
    }
  }, [disabled, editor]);

  const insertNumberedStep = useCallback(() => {
    if (!editor) return;
    const text = editor.getText();
    const lines = text.split('\n');
    const lastLine = lines[lines.length - 1];
    const match = lastLine.match(/^(\d+)\./);
    const nextNum = match ? parseInt(match[1]) + 1 : 1;
    editor.chain().focus().insertContent(`\n${nextNum}. `).run();
  }, [editor]);

  if (!editor) {
    return (
      <div className="border rounded-lg dark:border-gray-600 p-3 min-h-[200px] bg-gray-50 dark:bg-gray-700/50">
        <p className="text-gray-400">{placeholder || 'Loading editor...'}</p>
      </div>
    );
  }

  return (
    <div className={`border rounded-lg dark:border-gray-600 overflow-hidden ${disabled ? 'opacity-50' : ''}`}>
      {/* Toolbar */}
      <div className="flex flex-wrap gap-1 p-2 border-b dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive('bold')}
          disabled={disabled}
          title="Bold (Ctrl+B)"
        >
          <strong>B</strong>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive('italic')}
          disabled={disabled}
          title="Italic (Ctrl+I)"
        >
          <em>I</em>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          isActive={editor.isActive('strike')}
          disabled={disabled}
          title="Strikethrough"
        >
          <s>S</s>
        </ToolbarButton>

        <div className="w-px bg-gray-300 dark:bg-gray-600 mx-1" />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          isActive={editor.isActive('heading', { level: 2 })}
          disabled={disabled}
          title="Heading"
        >
          H
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive('bulletList')}
          disabled={disabled}
          title="Bullet List"
        >
          •
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive('orderedList')}
          disabled={disabled}
          title="Numbered List"
        >
          1.
        </ToolbarButton>
        <ToolbarButton
          onClick={insertNumberedStep}
          disabled={disabled}
          title="Add Numbered Step"
        >
          +Step
        </ToolbarButton>

        <div className="w-px bg-gray-300 dark:bg-gray-600 mx-1" />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          isActive={editor.isActive('blockquote')}
          disabled={disabled}
          title="Quote"
        >
          &quot;
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          disabled={disabled}
          title="Horizontal Rule"
        >
          —
        </ToolbarButton>

        <div className="flex-1" />

        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={disabled || !editor.can().undo()}
          title="Undo (Ctrl+Z)"
        >
          ↩
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={disabled || !editor.can().redo()}
          title="Redo (Ctrl+Y)"
        >
          ↪
        </ToolbarButton>
      </div>

      {/* Editor Content */}
      <EditorContent
        editor={editor}
        className="bg-white dark:bg-gray-800 min-h-[200px]"
      />
    </div>
  );
}
