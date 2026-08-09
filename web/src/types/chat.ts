export interface Source {
  content: string;
  score: number;
  name: string;
  url?: string;
  chunk_id?: string;
}

export type MessageStatus = 'sending' | 'streaming' | 'sent' | 'error';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: MessageStatus;
  error?: string;
  sources?: Source[];
  createdAt: number;
}

export interface ChatState {
  messages: ChatMessage[];
  input: string;
  isLoading: boolean;
  isStreaming: boolean;
  isTyping: boolean;
  conversationId: string;
  error: string | null;
}

export interface ChatInterfaceProps {
  botSlug: string;
}

export interface MessageListProps {
  messages: ChatMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  onRetry: (messageId: string) => void;
  onRegenerate: (messageId: string) => void;
  onCopy: (content: string) => void;
  onSendFeedback: (messageId: string, helpful: boolean) => void;
}

export interface ChatMessageProps {
  message: ChatMessage;
  isStreaming: boolean;
  onRetry: () => void;
  onRegenerate: () => void;
  onCopy: () => void;
  onSendFeedback: (helpful: boolean) => void;
  onSourceClick: (source: Source) => void;
}

export interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onFileUpload?: (file: File) => void;
  onVoiceInput?: (text: string) => void;
  disabled?: boolean;
  isStreaming?: boolean;
  isVoiceRecording?: boolean;
  onVoiceStart?: () => void;
  onVoiceEnd?: () => void;
  placeholder?: string;
}
