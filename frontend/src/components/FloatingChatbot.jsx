import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Send,
  Paperclip,
  FileText,
  UploadCloud,
  Trash2,
  ChevronLeft,
  ChevronDown,
  Bot,
  Sparkles,
  HardDrive,
  Zap,
  Maximize2,
  Minimize2,
  Minus,
  Copy,
  Check,
  Globe,
  RotateCcw,
  AlertCircle,
  FolderOpen,
} from 'lucide-react';
import client from '../api/client';
import { resourceApi } from '../api/resourceApi';
import { useAuth } from '../hooks/useAuth';

// ============================================================================
// File Magic Bytes & Header Validator
// ============================================================================
async function validateFileMagicBytes(file) {
  if (!file) return { valid: false, error: 'No file selected.' };

  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const allowedExts = ['pdf', 'txt', 'csv', 'md', 'markdown', 'rtf'];

  if (!allowedExts.includes(ext)) {
    return {
      valid: false,
      error: 'Unsupported file type. Please upload a PDF, Markdown (.md), CSV, RTF, or plain text (.txt) note.',
    };
  }

  // File size check (50MB maximum)
  if (file.size > 50 * 1024 * 1024) {
    return {
      valid: false,
      error: 'File size exceeds the 50 MB maximum limit.',
    };
  }

  try {
    const slice = file.slice(0, 16);
    const buffer = await slice.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // PDF Magic Bytes: %PDF (0x25 0x50 0x44 0x46)
    if (ext === 'pdf') {
      if (
        bytes.length < 4 ||
        bytes[0] !== 0x25 ||
        bytes[1] !== 0x50 ||
        bytes[2] !== 0x44 ||
        bytes[3] !== 0x46
      ) {
        return {
          valid: false,
          error: 'Corrupted or invalid PDF header. Please provide an authentic PDF document.',
        };
      }
    }

    // Windows Executable (MZ header: 0x4D 0x5A)
    if (bytes[0] === 0x4d && bytes[1] === 0x5a) {
      return {
        valid: false,
        error: 'Security alert: Executable binary detected disguised as a document.',
      };
    }

    // Linux ELF Header (0x7F 0x45 0x4C 0x46)
    if (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) {
      return {
        valid: false,
        error: 'Security alert: Executable binary detected disguised as a document.',
      };
    }

    // Plain text / Markdown / CSV: check for null bytes indicating binary content
    if (['txt', 'csv', 'md', 'markdown'].includes(ext)) {
      const inspectLen = Math.min(bytes.length, 16);
      for (let i = 0; i < inspectLen; i++) {
        if (bytes[i] === 0x00) {
          return {
            valid: false,
            error: 'Binary data detected in text file. Please ensure the file is valid UTF-8 plain text.',
          };
        }
      }
    }

    return { valid: true };
  } catch (err) {
    console.error('File validation failed:', err);
    return { valid: false, error: 'Failed to inspect file headers.' };
  }
}

// ============================================================================
// Code Block with Copy Button
// ============================================================================
function CodeBlock({ code, language }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative my-2 rounded-xl overflow-hidden bg-[#151114]/90 border border-white/10 font-mono text-xs shadow-inner">
      <div className="flex items-center justify-between px-3 py-1.5 bg-black/40 border-b border-white/10 text-[11px] text-white/70">
        <span className="font-semibold tracking-wide uppercase text-[10px] text-[var(--palette-sage)]">
          {language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[11px] text-white/75 hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded-md cursor-pointer"
          title="Copy code to clipboard"
        >
          {copied ? (
            <>
              <Check size={12} className="text-emerald-400" />
              <span className="text-emerald-400 font-medium">Copied</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-[var(--palette-sage)] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// ============================================================================
// Inline Text Formatter
// ============================================================================
function renderInline(text) {
  if (!text) return '';
  const parts = [];
  // Tokenize bold (**text**), inline code (`code`), and links [text](url)
  const regex = /(\*\*.*?\*\*|`.*?`|\[.*?\]\(.*?\))/g;
  let lastIdx = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.substring(lastIdx, match.index));
    }
    const token = match[0];

    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(
        <strong key={match.index} className="font-bold text-[var(--color-text-primary)]">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code
          key={match.index}
          className="px-1.5 py-0.5 mx-0.5 rounded-md bg-black/20 text-[var(--palette-teal)] dark:text-emerald-300 text-xs font-mono border border-[var(--color-border)]"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('[') && token.includes('](') && token.endsWith(')')) {
      const linkMatch = token.match(/^\[(.*?)\]\((.*?)\)$/);
      if (linkMatch) {
        parts.push(
          <a
            key={match.index}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--palette-teal)] underline underline-offset-2 hover:opacity-80"
          >
            {linkMatch[1]}
          </a>
        );
      } else {
        parts.push(token);
      }
    }

    lastIdx = regex.lastIndex;
  }

  if (lastIdx < text.length) {
    parts.push(text.substring(lastIdx));
  }

  return parts;
}

// ============================================================================
// Markdown Renderer
// ============================================================================
function MarkdownMessage({ content }) {
  if (!content || typeof content !== 'string') return null;

  const lines = content.split('\n');
  const elements = [];
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockContent = [];

  lines.forEach((line, lineIdx) => {
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <CodeBlock
            key={`code-${lineIdx}`}
            code={codeBlockContent.join('\n')}
            language={codeBlockLang}
          />
        );
        codeBlockContent = [];
        codeBlockLang = '';
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeBlockLang = line.slice(3).trim();
      }
      return;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      return;
    }

    // Headers
    if (line.startsWith('### ')) {
      elements.push(
        <h5
          key={lineIdx}
          className="font-bold text-xs mt-2.5 mb-1 text-[var(--palette-teal)] uppercase tracking-wider"
        >
          {renderInline(line.slice(4))}
        </h5>
      );
      return;
    }
    if (line.startsWith('## ')) {
      elements.push(
        <h4
          key={lineIdx}
          className="font-bold text-sm mt-3 mb-1 text-[var(--color-text-primary)]"
        >
          {renderInline(line.slice(3))}
        </h4>
      );
      return;
    }
    if (line.startsWith('# ')) {
      elements.push(
        <h3
          key={lineIdx}
          className="font-extrabold text-base mt-3 mb-1.5 text-gradient font-display"
        >
          {renderInline(line.slice(2))}
        </h3>
      );
      return;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      elements.push(
        <blockquote
          key={lineIdx}
          className="border-l-2 border-[var(--palette-teal)] pl-2.5 my-1.5 italic text-xs text-[var(--color-text-secondary)] opacity-90"
        >
          {renderInline(line.slice(2))}
        </blockquote>
      );
      return;
    }

    // Bullet points
    if (/^[-*]\s+/.test(line)) {
      elements.push(
        <div key={lineIdx} className="flex gap-2 items-start my-1 ml-1.5">
          <span className="text-[var(--palette-teal)] font-bold text-base leading-none mt-0.5">•</span>
          <span className="flex-1 text-xs leading-relaxed">{renderInline(line.replace(/^[-*]\s+/, ''))}</span>
        </div>
      );
      return;
    }

    // Numbered lists
    if (/^\d+\.\s+/.test(line)) {
      const numMatch = line.match(/^(\d+)\.\s+(.*)/);
      if (numMatch) {
        elements.push(
          <div key={lineIdx} className="flex gap-2 items-start my-1 ml-1.5">
            <span className="font-bold text-[var(--palette-teal)] text-[11px] min-w-[16px]">
              {numMatch[1]}.
            </span>
            <span className="flex-1 text-xs leading-relaxed">{renderInline(numMatch[2])}</span>
          </div>
        );
        return;
      }
    }

    // Empty line spacer
    if (!line.trim()) {
      elements.push(<div key={lineIdx} className="h-1.5" />);
      return;
    }

    // Regular paragraph
    elements.push(
      <p key={lineIdx} className="my-0.5 text-xs leading-relaxed">
        {renderInline(line)}
      </p>
    );
  });

  if (inCodeBlock && codeBlockContent.length > 0) {
    elements.push(
      <CodeBlock
        key="code-unclosed"
        code={codeBlockContent.join('\n')}
        language={codeBlockLang}
      />
    );
  }

  return <div className="space-y-0.5 leading-relaxed">{elements}</div>;
}

// ============================================================================
// Academic Resource Picker Modal
// ============================================================================
function ResourcePickerModal({ onClose, onSelect }) {
  const [subjects, setSubjects] = useState([]);
  const [selectedSubject, setSelectedSubject] = useState(null);
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchSubjects = async () => {
    setLoading(true);
    try {
      const res = await resourceApi.getSubjects({});
      setSubjects(res.data.data || []);
    } catch (err) {
      console.error('Failed to load subjects', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSubjects();
  }, []);

  const fetchResources = async (subject) => {
    setSelectedSubject(subject);
    setLoading(true);
    try {
      const res = await resourceApi.getResources(subject.id);
      const allowedMimes = ['application/pdf', 'application/rtf'];
      const supported = (res.data.data || []).filter(
        (r) =>
          (r.mimetype && (r.mimetype.startsWith('text/') || allowedMimes.includes(r.mimetype))) ||
          /\.(pdf|txt|md|csv)$/i.test(r.fileName || '')
      );
      setResources(supported);
    } catch (err) {
      console.error('Failed to load resources', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="absolute inset-0 bg-[var(--color-bg-primary)]/95 backdrop-blur-xl z-50 flex flex-col p-4 animate-fade-in">
      <div className="flex justify-between items-center pb-3 border-b border-[var(--color-border)]">
        {selectedSubject ? (
          <button
            onClick={() => setSelectedSubject(null)}
            className="flex items-center gap-1 text-xs font-semibold text-[var(--palette-teal)] hover:opacity-80 transition-opacity cursor-pointer"
          >
            <ChevronLeft size={16} /> Back to Subjects
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <FolderOpen size={16} className="text-[var(--palette-teal)]" />
            <h3 className="font-bold text-sm text-[var(--color-text-primary)]">Import Campus Resource</h3>
          </div>
        )}
        <button
          onClick={onClose}
          aria-label="Close Resource Picker"
          className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-3 space-y-2">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-xs text-[var(--color-text-muted)]">
            <div className="w-6 h-6 border-2 border-[var(--palette-teal)] border-t-transparent rounded-full animate-spin" />
            <span>Loading academic vault...</span>
          </div>
        ) : selectedSubject ? (
          resources.length === 0 ? (
            <div className="text-center py-12 px-4 text-xs text-[var(--color-text-muted)]">
              <FileText size={28} className="mx-auto mb-2 opacity-40 text-[var(--palette-teal)]" />
              <p>No compatible documents (PDF, TXT, CSV, MD) found in this subject.</p>
            </div>
          ) : (
            resources.map((r) => (
              <div
                key={r.id}
                onClick={() => onSelect(r.id)}
                className="group p-3 border border-[var(--color-border)] rounded-2xl bg-[var(--color-bg-card)] hover:border-[var(--palette-teal)] hover:shadow-sm cursor-pointer flex gap-3 items-center transition-all"
              >
                <div className="w-8 h-8 rounded-xl bg-[var(--palette-sage)]/20 text-[var(--palette-teal)] flex items-center justify-center shrink-0">
                  <FileText size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-xs text-[var(--color-text-primary)] truncate group-hover:text-[var(--palette-teal)] transition-colors">
                    {r.title || r.fileName}
                  </p>
                  <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                    {(r.fileSize / (1024 * 1024)).toFixed(2)} MB • {r.mimetype || 'document'}
                  </p>
                </div>
                <span className="text-[11px] font-semibold text-[var(--palette-teal)] opacity-0 group-hover:opacity-100 transition-opacity">
                  Import →
                </span>
              </div>
            ))
          )
        ) : subjects.length === 0 ? (
          <p className="text-xs text-[var(--color-text-muted)] text-center py-12">
            No subjects available for your batch cohort.
          </p>
        ) : (
          subjects.map((s) => (
            <div
              key={s.id}
              onClick={() => fetchResources(s)}
              className="group p-3 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-2xl hover:border-[var(--palette-teal)] hover:shadow-sm cursor-pointer flex gap-3 items-center transition-all"
            >
              <div className="w-8 h-8 rounded-xl bg-[var(--palette-rose)]/25 text-[var(--palette-plum)] flex items-center justify-center shrink-0 text-sm">
                📁
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-xs text-[var(--color-text-primary)] truncate group-hover:text-[var(--palette-teal)] transition-colors">
                  {s.name}
                </p>
                <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5 truncate">
                  {s.category} {s.subCategory ? `• ${s.subCategory}` : ''}
                </p>
              </div>
              <ChevronLeft size={16} className="rotate-180 text-[var(--color-text-muted)] group-hover:text-[var(--palette-teal)] transition-colors" />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main FloatingChatbot Component
// ============================================================================
export default function FloatingChatbot() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const [limits, setLimits] = useState(null);
  const [notes, setNotes] = useState([]);
  const [selectedNoteId, setSelectedNoteId] = useState('global');

  // Cached messages by note ID or 'global'
  const [messagesByNote, setMessagesByNote] = useState(() => {
    try {
      const stored = sessionStorage.getItem('cf_chatbot_msgs');
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showResourcePicker, setShowResourcePicker] = useState(false);
  const [alertInfo, setAlertInfo] = useState(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  const fetchLimits = async () => {
    try {
      const res = await client.get('/chatbot/limits');
      setLimits(res.data.data);
    } catch (err) {
      console.error('Failed to fetch chatbot limits', err);
    }
  };

  const fetchNotes = async () => {
    try {
      const res = await client.get('/chatbot');
      const data = res.data.data || [];
      setNotes(data);

      setSelectedNoteId((prev) => {
        if (prev === 'global') return 'global';
        if (prev && data.some((n) => n.id === prev)) return prev;
        return data.length > 0 ? data[0].id : 'global';
      });
    } catch (err) {
      console.error('Failed to fetch notes', err);
    }
  };

  // Sync messages to sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem('cf_chatbot_msgs', JSON.stringify(messagesByNote));
    } catch {
      /* ignore storage quota errors */
    }
  }, [messagesByNote]);

  // Fetch limits and notes whenever opened
  useEffect(() => {
    if (isOpen) {
      fetchLimits();
      fetchNotes();
    }
  }, [isOpen]);

  const activeMessages = useMemo(() => {
    return messagesByNote[selectedNoteId] || [];
  }, [selectedNoteId, messagesByNote]);

  // Smooth auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages, loading]);

  // Local file upload with Magic Bytes validation
  const handleLocalUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate headers & magic bytes before uploading
    const validation = await validateFileMagicBytes(file);
    if (!validation.valid) {
      setAlertInfo({
        type: 'alert',
        message: validation.error,
      });
      e.target.value = '';
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', file.name.replace(/\.[^/.]+$/, ''));

    setLoading(true);
    try {
      const res = await client.post('/chatbot/upload/local', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      });
      const created = res.data.data;
      await fetchLimits();
      await fetchNotes();

      if (created?.id) {
        setSelectedNoteId(created.id);
        // Seed initial friendly message
        setMessagesByNote((prev) => ({
          ...prev,
          [created.id]: [
            {
              role: 'bot',
              text: `✨ Note **"${created.title}"** indexed successfully! Ask me anything about this document.`,
            },
          ],
        }));
      }
    } catch (err) {
      const msg =
        err.response?.data?.error?.message ||
        err.response?.data?.error ||
        err.message ||
        'Local note upload failed';
      setAlertInfo({
        type: 'alert',
        message: typeof msg === 'object' ? JSON.stringify(msg) : String(msg),
      });
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  };

  // Import from academic platform resources
  const handleResourceUpload = async (resourceId) => {
    setShowResourcePicker(false);
    if (!resourceId) return;

    setLoading(true);
    try {
      const res = await client.post(
        '/chatbot/upload/resource',
        { resourceId },
        { timeout: 120000 }
      );
      const created = res.data.data;
      await fetchLimits();
      await fetchNotes();

      if (created?.id) {
        setSelectedNoteId(created.id);
        setMessagesByNote((prev) => ({
          ...prev,
          [created.id]: [
            {
              role: 'bot',
              text: `✨ Academic resource **"${created.title}"** linked! What would you like to review from it?`,
            },
          ],
        }));
      }
    } catch (err) {
      const msg =
        err.response?.data?.error?.message ||
        err.response?.data?.error ||
        err.message ||
        'Resource import failed';
      setAlertInfo({
        type: 'alert',
        message: typeof msg === 'object' ? JSON.stringify(msg) : String(msg),
      });
    } finally {
      setLoading(false);
    }
  };

  // Delete note with confirmation
  const handleDeleteNote = (id, title) => {
    setAlertInfo({
      type: 'confirm',
      message: `Delete note "${title}"? This will free up storage and remove all linked embeddings.`,
      onConfirm: () => executeDeleteNote(id),
    });
  };

  const executeDeleteNote = async (id) => {
    setAlertInfo(null);
    try {
      await client.delete(`/chatbot/${id}`);
      setMessagesByNote((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
      await fetchLimits();
      await fetchNotes();
      setSelectedNoteId((prev) => (prev === id ? 'global' : prev));
    } catch {
      setAlertInfo({ type: 'alert', message: 'Failed to delete note. Please try again.' });
    }
  };

  const clearCurrentChatHistory = () => {
    setMessagesByNote((prev) => ({
      ...prev,
      [selectedNoteId]: [],
    }));
  };

  // Send message
  const sendMessage = async () => {
    const userQuery = input.trim();
    if (!userQuery || loading) return;

    // Check if notes exist
    if (notes.length === 0) {
      setAlertInfo({
        type: 'alert',
        message: 'Please upload or import at least one note (PDF, TXT, CSV, MD) to start chatting.',
      });
      return;
    }

    // Determine note to query against:
    // If 'global' is selected, use the currently active note or first available note
    const targetNoteId = selectedNoteId === 'global' ? notes[0]?.id : selectedNoteId;
    if (!targetNoteId) return;

    const userMsg = { role: 'user', text: userQuery, timestamp: Date.now() };
    const currentHistory = messagesByNote[selectedNoteId] || [];

    setMessagesByNote((prev) => ({
      ...prev,
      [selectedNoteId]: [...(prev[selectedNoteId] || []), userMsg],
    }));
    setInput('');
    setLoading(true);

    try {
      const res = await client.post(
        '/chatbot/chat',
        {
          noteId: targetNoteId,
          query: userQuery,
          history: currentHistory.map((m) => ({ role: m.role, text: m.text })),
        },
        { timeout: 120000 }
      );

      const botMsg = {
        role: 'bot',
        text: res.data.data.answer,
        timestamp: Date.now(),
      };

      setMessagesByNote((prev) => ({
        ...prev,
        [selectedNoteId]: [...(prev[selectedNoteId] || []), botMsg],
      }));

      if (typeof res.data.data.remainingTokens === 'number') {
        setLimits((prev) =>
          prev ? { ...prev, dailyChatTokens: res.data.data.remainingTokens } : prev
        );
      }
    } catch (err) {
      const msg =
        err.response?.data?.error?.message ||
        err.response?.data?.error ||
        'Error contacting AI notes assistant.';
      const errorText = typeof msg === 'object' ? JSON.stringify(msg) : String(msg);
      const errorMsg = { role: 'bot', text: `⚠️ ${errorText}` };

      setMessagesByNote((prev) => ({
        ...prev,
        [selectedNoteId]: [...(prev[selectedNoteId] || []), errorMsg],
      }));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (!user) return null;

  // Storage calculations
  const storagePct = limits?.maxStorage
    ? Math.min(100, Math.round((limits.storageUsed / limits.maxStorage) * 100))
    : 0;
  const storageMb = limits ? (limits.storageUsed / (1024 * 1024)).toFixed(1) : '0';

  // Dynamic progress bar color transition based on percentage
  const getStorageBarColor = (pct) => {
    if (pct >= 85) return 'from-rose-400 to-rose-600 shadow-[0_0_8px_rgba(244,63,94,0.6)]';
    if (pct >= 60) return 'from-amber-300 to-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]';
    return 'from-[var(--palette-sage)] to-[var(--palette-teal)] shadow-[0_0_8px_rgba(104,166,145,0.4)]';
  };

  // 1. FLOATING PILL BUTTON (When closed)
  if (!isOpen) {
    return (
      <motion.button
        initial={{ scale: 0.8, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => {
          setIsOpen(true);
          setIsMinimized(false);
        }}
        aria-label="Open AI Notes Assistant"
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-full bg-gradient-to-r from-[var(--palette-teal)] via-[#568d7b] to-[var(--palette-plum)] text-white shadow-[0_10px_35px_-4px_rgba(104,166,145,0.5)] hover:shadow-[0_14px_45px_-4px_rgba(104,166,145,0.7)] border border-white/20 backdrop-blur-xl transition-all duration-300 group cursor-pointer"
        title="Notes AI Assistant — Chat with your documents"
      >
        <span className="relative flex items-center justify-center">
          <Bot size={20} className="relative z-10 transition-transform group-hover:scale-110" />
          <Sparkles
            size={12}
            className="absolute -top-1.5 -right-1.5 text-amber-200 animate-spin [animation-duration:5s]"
          />
        </span>
        <span className="font-semibold text-xs tracking-wide">Notes AI</span>

        {/* Live status dot / pulse indicator */}
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
        </span>

        {/* Remaining tokens badge */}
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/20 font-mono font-bold flex items-center gap-1 shadow-inner">
          <Zap size={10} className="text-amber-300 fill-amber-300" />
          {limits?.dailyChatTokens ?? 20}
        </span>
      </motion.button>
    );
  }

  // 2. MINIMIZED FLOATING DOCK BAR
  if (isMinimized) {
    return (
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-2.5 rounded-2xl glass-card bg-[var(--color-bg-glass)] border border-[var(--color-border)] shadow-2xl backdrop-blur-2xl text-xs"
      >
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-[var(--palette-teal)]/20 text-[var(--palette-teal)] flex items-center justify-center">
            <Sparkles size={14} />
          </div>
          <span className="font-bold text-[var(--color-text-primary)]">Notes AI (Docked)</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--palette-teal)]/15 text-[var(--palette-teal)] font-bold">
            {limits?.dailyChatTokens ?? 20} tokens
          </span>
        </div>
        <div className="flex items-center gap-1 border-l border-[var(--color-border)] pl-2">
          <button
            onClick={() => setIsMinimized(false)}
            aria-label="Restore chat window"
            className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition cursor-pointer"
            title="Restore chat"
          >
            <Maximize2 size={14} />
          </button>
          <button
            onClick={() => setIsOpen(false)}
            aria-label="Close assistant"
            className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition cursor-pointer"
            title="Close assistant"
          >
            <X size={14} />
          </button>
        </div>
      </motion.div>
    );
  }

  // 3. EXPANDABLE MATTE GLASS CHAT WINDOW
  const windowWidthClass = isExpanded
    ? 'w-[640px] max-w-[calc(100vw-2rem)] h-[740px] max-h-[calc(100vh-2.5rem)]'
    : 'w-[420px] max-w-[calc(100vw-2rem)] h-[620px] max-h-[calc(100vh-2.5rem)]';

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="AI Notes Assistant"
      initial={{ opacity: 0, scale: 0.92, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: 20 }}
      transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
      className={`fixed bottom-6 right-6 ${windowWidthClass} glass-card rounded-3xl shadow-[0_20px_50px_-10px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden z-50 border border-[var(--color-border)] backdrop-blur-2xl transition-[width,height] duration-300`}
    >
      {/* -------------------------------------------------------------
          Top Header: Matte Glass & Palette Gradient
          ------------------------------------------------------------- */}
      <div className="bg-gradient-to-r from-[var(--palette-teal)] via-[#528976] to-[var(--palette-plum)] text-white p-3.5 flex flex-col gap-2.5 shadow-sm select-none">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center border border-white/25 shadow-inner">
              <Sparkles size={16} className="text-amber-200" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="font-bold text-sm leading-none font-display">Notes AI</h3>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/20 font-bold uppercase tracking-wider text-white/90">
                  AI Assistant
                </span>
              </div>
              <p className="text-[11px] text-white/80 mt-0.5 flex items-center gap-2">
                <span className="flex items-center gap-0.5">
                  <Zap size={11} className="text-amber-300 fill-amber-300" />
                  <strong>{limits?.dailyChatTokens ?? 20}</strong> tokens left
                </span>
                <span>•</span>
                <span>
                  {limits?.dailyUploadCount ?? 0}/{limits?.maxUploads ?? 2} uploads
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              aria-label={isExpanded ? 'Collapse window size' : 'Expand window size'}
              className="hover:bg-white/20 p-1.5 rounded-lg transition-colors text-white/90 hover:text-white cursor-pointer"
              title={isExpanded ? 'Compact mode' : 'Expand window'}
            >
              {isExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button
              onClick={() => setIsMinimized(true)}
              aria-label="Minimize Assistant"
              className="hover:bg-white/20 p-1.5 rounded-lg transition-colors text-white/90 hover:text-white cursor-pointer"
              title="Minimize chat"
            >
              <Minus size={16} />
            </button>
            <button
              onClick={() => setIsOpen(false)}
              aria-label="Close Assistant"
              className="hover:bg-white/20 p-1.5 rounded-lg transition-colors text-white/90 hover:text-white cursor-pointer"
              title="Close chat"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Storage Meter Bar with Color Transitions */}
        <div className="bg-black/25 rounded-xl p-2 text-[10px] border border-white/10 backdrop-blur-sm">
          <div className="flex justify-between text-white/90 font-medium mb-1.5">
            <span className="flex items-center gap-1 font-semibold">
              <HardDrive size={11} className="text-[var(--palette-sage)]" /> Storage Allowance
            </span>
            <span className="font-mono">
              {storageMb} MB / 50 MB ({storagePct}%)
            </span>
          </div>
          <div className="w-full h-1.5 bg-white/20 rounded-full overflow-hidden p-[1px]">
            <div
              className={`h-full rounded-full transition-all duration-500 bg-gradient-to-r ${getStorageBarColor(
                storagePct
              )}`}
              style={{ width: `${Math.max(2, storagePct)}%` }}
            />
          </div>
        </div>
      </div>

      {/* -------------------------------------------------------------
          Note Selector: Dropdown & Pill Bar
          ------------------------------------------------------------- */}
      <div className="p-2.5 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          {/* Quick Dropdown Selector */}
          <div className="relative flex-1 min-w-0">
            <select
              value={selectedNoteId || 'global'}
              onChange={(e) => setSelectedNoteId(e.target.value)}
              aria-label="Select note context"
              className="w-full appearance-none bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl py-1.5 pl-2.5 pr-8 text-xs font-medium text-[var(--color-text-primary)] outline-none focus:border-[var(--palette-teal)] transition cursor-pointer"
            >
              <option value="global">🌐 Global Chat (All Notes Context)</option>
              {notes.map((n) => (
                <option key={n.id} value={n.id}>
                  📄 {n.title} ({(n.fileSize / (1024 * 1024)).toFixed(1)} MB)
                </option>
              ))}
            </select>
            <ChevronDown
              size={14}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--color-text-muted)]"
            />
          </div>

          {/* Action Buttons: Import Resource & Upload Local */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              title="Import from Campus Resources"
              onClick={() => setShowResourcePicker(true)}
              disabled={loading}
              aria-label="Import note from resources"
              className="p-1.5 rounded-xl bg-[var(--color-bg-card)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--palette-teal)] hover:border-[var(--palette-teal)] disabled:opacity-50 transition cursor-pointer"
            >
              <UploadCloud size={15} />
            </button>

            <button
              title="Upload Local Document (PDF, TXT, CSV, MD)"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              aria-label="Upload Local File"
              className="p-1.5 rounded-xl bg-[var(--palette-teal)]/15 text-[var(--palette-teal)] border border-[var(--palette-teal)]/30 hover:bg-[var(--palette-teal)]/25 disabled:opacity-50 transition cursor-pointer flex items-center"
            >
              <Paperclip size={15} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.txt,.csv,.md,.markdown,.rtf"
              onChange={handleLocalUpload}
            />

            {activeMessages.length > 0 && (
              <button
                title="Clear current note conversation"
                onClick={clearCurrentChatHistory}
                aria-label="Clear chat"
                className="p-1.5 rounded-xl bg-[var(--color-bg-card)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-rose-400 hover:border-rose-400/40 transition cursor-pointer"
              >
                <RotateCcw size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Direct Pill Bar for quick tapping */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
          <button
            onClick={() => setSelectedNoteId('global')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs whitespace-nowrap transition-all select-none cursor-pointer ${
              selectedNoteId === 'global'
                ? 'bg-gradient-to-r from-[var(--palette-teal)] to-[#528976] text-white shadow-sm font-semibold'
                : 'bg-[var(--color-bg-card)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-glass)]'
            }`}
          >
            <Globe size={12} />
            <span>Global</span>
          </button>

          {notes.map((n) => {
            const isSelected = selectedNoteId === n.id;
            const displayTitle = n.title.length > 15 ? `${n.title.slice(0, 15)}...` : n.title;
            return (
              <div
                key={n.id}
                onClick={() => setSelectedNoteId(n.id)}
                title={n.title}
                className={`group flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs whitespace-nowrap transition-all select-none cursor-pointer ${
                  isSelected
                    ? 'bg-gradient-to-r from-[var(--palette-teal)] to-[#528976] text-white shadow-sm font-semibold'
                    : 'bg-[var(--color-bg-card)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-glass)]'
                }`}
              >
                <FileText size={12} className={isSelected ? 'text-white' : 'text-[var(--palette-teal)]'} />
                <span>{displayTitle}</span>
                <Trash2
                  size={12}
                  aria-label={`Delete ${n.title}`}
                  className={`ml-1 transition-opacity ${
                    isSelected
                      ? 'text-white/75 hover:text-rose-200'
                      : 'text-[var(--color-text-muted)] hover:text-rose-500 opacity-60 group-hover:opacity-100'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteNote(n.id, n.title);
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* -------------------------------------------------------------
          Chat Messages Area
          ------------------------------------------------------------- */}
      <div className="flex-1 p-3.5 overflow-y-auto bg-[var(--color-bg-secondary)] flex flex-col gap-3">
        {activeMessages.length === 0 && (
          <div className="text-center text-[var(--color-text-muted)] my-auto text-xs px-6 py-8 select-none">
            <div className="w-12 h-12 rounded-2xl bg-[var(--palette-teal)]/15 text-[var(--palette-teal)] flex items-center justify-center mx-auto mb-3 shadow-inner">
              <Bot size={26} />
            </div>
            <p className="font-bold text-sm text-[var(--color-text-primary)] font-display">
              {notes.length === 0
                ? 'No Notes Uploaded'
                : selectedNoteId === 'global'
                ? 'Chat with All Uploaded Notes'
                : 'Ask Anything About This Note'}
            </p>
            <p className="mt-1.5 leading-relaxed text-[var(--color-text-secondary)] max-w-xs mx-auto">
              {notes.length === 0
                ? 'Upload a PDF, Markdown, CSV, or text note above to activate AI contextual reasoning.'
                : selectedNoteId === 'global'
                ? 'Your query will automatically leverage the contextual knowledge across your saved documents.'
                : 'Questions will be strictly verified and answered from the uploaded document.'}
            </p>

            {notes.length === 0 && (
              <div className="mt-4 flex justify-center gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="btn btn-primary text-xs py-1.5 px-3 cursor-pointer"
                >
                  <Paperclip size={13} /> Upload Local Note
                </button>
                <button
                  onClick={() => setShowResourcePicker(true)}
                  className="btn btn-secondary text-xs py-1.5 px-3 cursor-pointer"
                >
                  <UploadCloud size={13} /> Campus Vault
                </button>
              </div>
            )}
          </div>
        )}

        {/* Message Stream */}
        {activeMessages.map((m, i) => {
          const isUser = m.role === 'user';
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`p-3 rounded-2xl max-w-[88%] text-xs leading-relaxed ${
                  isUser
                    ? 'bg-gradient-to-br from-[var(--palette-teal)] via-[#568d7b] to-[var(--palette-plum)] text-white rounded-br-sm shadow-md'
                    : 'bg-[var(--color-bg-card)] border border-[var(--color-border)] text-[var(--color-text-primary)] rounded-bl-sm shadow-sm'
                }`}
              >
                {isUser ? m.text : <MarkdownMessage content={m.text} />}
              </div>
            </motion.div>
          );
        })}

        {/* Loading / Analyzing indicator */}
        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex justify-start"
          >
            <div className="p-3 rounded-2xl bg-[var(--color-bg-card)] border border-[var(--color-border)] text-xs flex items-center gap-2 shadow-sm">
              <span className="w-2 h-2 rounded-full bg-[var(--palette-teal)] animate-bounce" />
              <span className="w-2 h-2 rounded-full bg-[var(--palette-teal)] animate-bounce [animation-delay:0.15s]" />
              <span className="w-2 h-2 rounded-full bg-[var(--palette-teal)] animate-bounce [animation-delay:0.3s]" />
              <span className="text-[11px] text-[var(--color-text-muted)] font-medium ml-1">
                Analyzing note embeddings...
              </span>
            </div>
          </motion.div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* -------------------------------------------------------------
          Input Box & Controls
          ------------------------------------------------------------- */}
      <div className="p-2.5 bg-[var(--color-bg-card)] border-t border-[var(--color-border)] flex gap-2 items-center">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading || notes.length === 0}
          placeholder={
            notes.length === 0
              ? 'Upload a note above to chat...'
              : selectedNoteId === 'global'
              ? 'Ask across your notes...'
              : 'Ask a question about this note...'
          }
          className="flex-1 bg-[var(--color-bg-input)] border border-[var(--color-border)] rounded-2xl resize-none max-h-24 p-2.5 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--palette-teal)] transition-colors placeholder:text-[var(--color-text-muted)]"
          rows={1}
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim() || notes.length === 0}
          aria-label="Send query"
          className="btn btn-primary p-2.5 rounded-2xl disabled:opacity-40 transition-opacity flex-shrink-0 cursor-pointer"
        >
          <Send size={15} />
        </button>
      </div>

      {/* -------------------------------------------------------------
          Resource Picker Modal
          ------------------------------------------------------------- */}
      <AnimatePresence>
        {showResourcePicker && (
          <ResourcePickerModal
            onClose={() => setShowResourcePicker(false)}
            onSelect={handleResourceUpload}
          />
        )}
      </AnimatePresence>

      {/* -------------------------------------------------------------
          Confirmation & Notice Modal Dialog
          ------------------------------------------------------------- */}
      <AnimatePresence>
        {alertInfo && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4 text-center animate-fade-in">
            <div className="glass-card bg-[var(--color-bg-matte)] p-5 rounded-3xl w-full max-w-[300px] border border-white/15 shadow-2xl">
              <div className="w-10 h-10 rounded-2xl bg-[var(--palette-rose)]/25 text-[var(--palette-plum)] dark:text-rose-300 flex items-center justify-center mx-auto mb-3">
                <AlertCircle size={22} />
              </div>
              <h3 className="font-bold text-sm mb-1.5 text-[var(--color-text-primary)] font-display">
                {alertInfo.type === 'confirm' ? 'Confirm Deletion' : 'Notification'}
              </h3>
              <p className="text-xs text-[var(--color-text-secondary)] mb-5 leading-relaxed">
                {alertInfo.message}
              </p>
              <div className="flex gap-2 justify-center">
                <button
                  onClick={() => setAlertInfo(null)}
                  className="btn btn-secondary text-xs px-3.5 py-1.5 cursor-pointer"
                >
                  {alertInfo.type === 'confirm' ? 'Cancel' : 'Dismiss'}
                </button>
                {alertInfo.type === 'confirm' && (
                  <button
                    onClick={alertInfo.onConfirm}
                    className="btn btn-danger text-xs px-3.5 py-1.5 font-semibold shadow-sm cursor-pointer"
                  >
                    Delete Note
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
