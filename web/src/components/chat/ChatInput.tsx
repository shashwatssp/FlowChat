'use client';

import { Send, Paperclip } from 'lucide-react';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onFileUpload?: (file: File) => void;
  disabled?: boolean;
  placeholder?: string;
}

export default function ChatInput({
  value,
  onChange,
  onSend,
  onFileUpload,
  disabled,
  placeholder = "Type your message...",
}: ChatInputProps) {
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onFileUpload) {
      onFileUpload(file);
    }
    e.target.value = '';
  };

  return (
    <div className="border-t bg-white p-4">
      <div className="container mx-auto">
        <div className="flex gap-3">
          {onFileUpload && (
            <label className="flex items-center justify-center w-10 h-10 text-gray-500 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
              <input
                type="file"
                className="hidden"
                accept=".txt,.pdf,.docx,.md,.csv,.json"
                onChange={handleFileUpload}
                disabled={disabled}
              />
              <Paperclip size={20} />
            </label>
          )}
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={placeholder}
            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
            rows={1}
            disabled={disabled}
          />
          <button
            onClick={onSend}
            disabled={disabled || !value.trim()}
            className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
          >
            <Send size={20} />
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2 text-center">
          Powered by FlowChat
        </p>
      </div>
    </div>
  );
}
