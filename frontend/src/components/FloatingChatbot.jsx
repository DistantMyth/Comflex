import React, { useState, useEffect, useRef, useMemo } from 'react';
import { X, Send, Paperclip, FileText, UploadCloud, Trash2, ChevronLeft, Bot, Sparkles, HardDrive, Zap } from 'lucide-react';
import api from '../api/client';
import { resourceApi } from '../api/resourceApi';
import { useAuth } from '../hooks/useAuth';

function MarkdownMessage({ content }) {
  if (!content || typeof content !== 'string') return null;

  // Split into lines for simple block parsing
  const lines = content.split('\n');
  const elements = [];
  let inCodeBlock = false;
  let codeBlockContent = [];

  lines.forEach((line, lineIdx) => {
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${lineIdx}`} className="p-2.5 my-2 rounded-xl bg-black/40 border border-white/10 text-xs font-mono overflow-x-auto text-emerald-300">
            <code>{codeBlockContent.join('\n')}</code>
          </pre>
        );
        codeBlockContent = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      return;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      return;
    }

    // Headers
    if (line.startsWith('### ')) {
      elements.push(<h5 key={lineIdx} className="font-bold text-sm mt-2 mb-1 text-[var(--color-accent)]">{renderInline(line.slice(4))}</h5>);
      return;
    }
    if (line.startsWith('## ')) {
      elements.push(<h4 key={lineIdx} className="font-bold text-base mt-2 mb-1">{renderInline(line.slice(3))}</h4>);
      return;
    }
    if (line.startsWith('# ')) {
      elements.push(<h3 key={lineIdx} className="font-extrabold text-base mt-2 mb-1">{renderInline(line.slice(2))}</h3>);
      return;
    }

    // Bullet points
    if (/^[-*]\s+/.test(line)) {
      elements.push(
        <div key={lineIdx} className="flex gap-2 items-start my-0.5 ml-2">
          <span className="text-[var(--color-accent)] leading-none mt-1.5">•</span>
          <span className="flex-1">{renderInline(line.replace(/^[-*]\s+/, ''))}</span>
        </div>
      );
      return;
    }

    // Numbered points
    if (/^\d+\.\s+/.test(line)) {
      const numMatch = line.match(/^(\d+)\.\s+(.*)/);
      if (numMatch) {
        elements.push(
          <div key={lineIdx} className="flex gap-2 items-start my-0.5 ml-2">
            <span className="font-semibold text-[var(--color-accent)] text-xs min-w-[14px]">{numMatch[1]}.</span>
            <span className="flex-1">{renderInline(numMatch[2])}</span>
          </div>
        );
        return;
      }
    }

    // Empty line
    if (!line.trim()) {
      elements.push(<div key={lineIdx} className="h-1.5" />);
      return;
    }

    // Normal paragraph
    elements.push(<p key={lineIdx} className="my-0.5">{renderInline(line)}</p>);
  });

  if (inCodeBlock && codeBlockContent.length > 0) {
    elements.push(
      <pre key="code-unclosed" className="p-2.5 my-2 rounded-xl bg-black/40 border border-white/10 text-xs font-mono overflow-x-auto text-emerald-300">
        <code>{codeBlockContent.join('\n')}</code>
      </pre>
    );
  }

  return <div className="space-y-0.5 leading-relaxed">{elements}</div>;
}

function renderInline(text) {
  if (!text) return '';
  const parts = [];
  // Tokenize bold (**text**) and inline code (`code`)
  const regex = /(\*\*.*?\*\*|`.*?`)/g;
  let lastIdx = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.substring(lastIdx, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(<strong key={match.index} className="font-semibold text-white">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(<code key={match.index} className="px-1 py-0.5 mx-0.5 rounded bg-black/30 text-emerald-300 text-xs font-mono">{token.slice(1, -1)}</code>);
    }
    lastIdx = regex.lastIndex;
  }

  if (lastIdx < text.length) {
    parts.push(text.substring(lastIdx));
  }

  return parts;
}

export default function FloatingChatbot() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [limits, setLimits] = useState(null);
  const [notes, setNotes] = useState([]);
  const [selectedNoteId, setSelectedNoteId] = useState(null);
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

  useEffect(() => {
    try {
      sessionStorage.setItem('cf_chatbot_msgs', JSON.stringify(messagesByNote));
    } catch { /* ignore */ }
  }, [messagesByNote]);

  useEffect(() => {
    if (isOpen) {
      fetchLimits();
      fetchNotes();
    }
  }, [isOpen]);

  const activeMessages = useMemo(
    () => (selectedNoteId && messagesByNote[selectedNoteId]) || [],
    [selectedNoteId, messagesByNote]
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages, loading]);

  const fetchLimits = async () => {
    try {
      const res = await api.get('/chatbot/limits');
      setLimits(res.data.data);
    } catch (err) {
      console.error('Failed to fetch limits', err);
    }
  };

  const fetchNotes = async () => {
    try {
      const res = await api.get('/chatbot');
      const data = res.data.data || [];
      setNotes(data);
      if (data.length > 0) {
        setSelectedNoteId((prev) => {
          if (prev && data.some((n) => n.id === prev)) return prev;
          return data[0].id;
        });
      } else {
        setSelectedNoteId(null);
      }
    } catch (err) {
      console.error('Failed to fetch notes', err);
    }
  };

  const handleLocalUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    setLoading(true);
    try {
      const res = await api.post('/chatbot/upload/local', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      });
      const created = res.data.data;
      await fetchLimits();
      await fetchNotes();
      if (created?.id) setSelectedNoteId(created.id);
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.response?.data?.error || 'Upload failed';
      setAlertInfo({ type: 'alert', message: typeof msg === 'object' ? JSON.stringify(msg) : msg });
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  };

  const handleResourceUpload = async (resourceId) => {
    setShowResourcePicker(false);
    if (!resourceId) return;
    setLoading(true);
    try {
      const res = await api.post('/chatbot/upload/resource', { resourceId }, { timeout: 120000 });
      const created = res.data.data;
      await fetchLimits();
      await fetchNotes();
      if (created?.id) setSelectedNoteId(created.id);
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.response?.data?.error || 'Upload failed';
      setAlertInfo({ type: 'alert', message: typeof msg === 'object' ? JSON.stringify(msg) : msg });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteNote = (id, title) => {
    setAlertInfo({
      type: 'confirm',
      message: `Delete note "${title}"? This will free up storage and remove this note.`,
      onConfirm: () => executeDeleteNote(id)
    });
  };

  const executeDeleteNote = async (id) => {
    setAlertInfo(null);
    try {
      await api.delete(`/chatbot/${id}`);
      setMessagesByNote((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
      await fetchLimits();
      await fetchNotes();
    } catch {
      setAlertInfo({ type: 'alert', message: 'Delete failed.' });
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || !selectedNoteId) return;
    const userQuery = input.trim();
    const userMsg = { role: 'user', text: userQuery };

    const currentHistory = messagesByNote[selectedNoteId] || [];
    setMessagesByNote((prev) => ({
      ...prev,
      [selectedNoteId]: [...(prev[selectedNoteId] || []), userMsg]
    }));
    setInput('');
    setLoading(true);

    try {
      const res = await api.post('/chatbot/chat', {
        noteId: selectedNoteId,
        query: userQuery,
        history: currentHistory.map((m) => ({ role: m.role, text: m.text }))
      }, { timeout: 120000 });

      const botMsg = { role: 'bot', text: res.data.data.answer };
      setMessagesByNote((prev) => ({
        ...prev,
        [selectedNoteId]: [...(prev[selectedNoteId] || []), botMsg]
      }));
      setLimits((prev) => prev ? ({ ...prev, dailyChatTokens: res.data.data.remainingTokens }) : prev);
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.response?.data?.error || 'Error contacting AI assistant.';
      const errorMsg = { role: 'bot', text: typeof msg === 'object' ? JSON.stringify(msg) : String(msg) };
      setMessagesByNote((prev) => ({
        ...prev,
        [selectedNoteId]: [...(prev[selectedNoteId] || []), errorMsg]
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

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        aria-label="Open AI Notes Assistant"
        className="fixed bottom-6 right-6 p-4 rounded-full bg-gradient-to-br from-[var(--color-accent-light)] via-[var(--color-accent)] to-[#2563eb] text-white shadow-[0_10px_34px_-6px_rgba(124,58,237,0.6)] hover:scale-110 active:scale-95 transition-transform z-50 focus:outline-none"
        title="AI Notes Assistant"
      >
        <Bot size={26} />
      </button>
    );
  }

  const storagePct = limits?.maxStorage ? Math.min(100, Math.round((limits.storageUsed / limits.maxStorage) * 100)) : 0;
  const storageMb = limits ? (limits.storageUsed / (1024 * 1024)).toFixed(1) : '0';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="AI Notes Assistant"
      className="fixed bottom-6 right-6 w-96 max-w-[calc(100vw-2rem)] h-[620px] max-h-[calc(100vh-3rem)] glass-card rounded-3xl shadow-2xl flex flex-col overflow-hidden z-50 border border-white/15 animate-fade-in"
    >
      {/* Header */}
      <div className="bg-gradient-to-r from-[var(--color-accent)] to-[#2563eb] text-white p-3.5 flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
              <Sparkles size={16} />
            </div>
            <div>
              <h3 className="font-bold text-sm leading-none">Notes AI</h3>
              <p className="text-[11px] text-white/80 mt-0.5 flex items-center gap-2">
                <span className="flex items-center gap-0.5"><Zap size={11} /> {limits?.dailyChatTokens ?? 20} tokens</span>
                <span>•</span>
                <span>{limits?.dailyUploadCount ?? 0}/{limits?.maxUploads ?? 2} uploads</span>
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            aria-label="Close Assistant"
            className="hover:bg-white/20 p-1.5 rounded-lg transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Storage usage bar */}
        <div className="bg-black/20 rounded-lg p-1.5 text-[10px]">
          <div className="flex justify-between text-white/90 font-medium mb-1">
            <span className="flex items-center gap-1"><HardDrive size={10} /> Storage Used</span>
            <span>{storageMb} / 50 MB ({storagePct}%)</span>
          </div>
          <div className="w-full h-1.5 bg-white/20 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${storagePct > 90 ? 'bg-red-400' : 'bg-emerald-400'}`}
              style={{ width: `${storagePct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Note Selection Area */}
      <div className="p-2.5 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex items-center gap-1.5 overflow-x-auto">
        <span className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase shrink-0">Notes:</span>
        {notes.map((n) => {
          const displayTitle = n.title.length > 14 ? `${n.title.slice(0, 14)}...` : n.title;
          return (
            <button
              key={n.id}
              onClick={() => setSelectedNoteId(n.id)}
              title={n.title}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs whitespace-nowrap transition-all ${
                selectedNoteId === n.id
                  ? 'bg-[var(--color-accent)] text-white shadow-sm font-medium'
                  : 'bg-[var(--color-bg-card)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-glass)]'
              }`}
            >
              <FileText size={12} />
              <span>{displayTitle}</span>
              <Trash2
                size={12}
                aria-label={`Delete ${n.title}`}
                className="ml-1 hover:text-red-300 opacity-75 hover:opacity-100 transition-opacity"
                onClick={(e) => { e.stopPropagation(); handleDeleteNote(n.id, n.title); }}
              />
            </button>
          );
        })}
        <button
          title="Import from Resources"
          onClick={() => setShowResourcePicker(true)}
          disabled={loading}
          aria-label="Import from Resources"
          className="p-1.5 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] disabled:opacity-50 shrink-0"
        >
          <UploadCloud size={14} />
        </button>
        <label
          title="Upload Local File (.pdf, .txt, .md, .csv)"
          aria-label="Upload Local File"
          className="p-1.5 rounded-lg bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/25 cursor-pointer hover:bg-[var(--color-accent)]/20 disabled:opacity-50 flex items-center shrink-0"
        >
          <Paperclip size={14} />
          <input type="file" className="hidden" accept=".pdf,.txt,.csv,.md" onChange={handleLocalUpload} />
        </label>
      </div>

      {/* Chat Area */}
      <div className="flex-1 p-3.5 overflow-y-auto bg-[var(--color-bg-secondary)] flex flex-col gap-3">
        {activeMessages.length === 0 && (
          <div className="text-center text-[var(--color-text-muted)] my-auto text-xs px-6 py-8">
            <Bot size={32} className="mx-auto mb-2 text-[var(--color-accent)] opacity-60" />
            <p className="font-semibold text-sm text-[var(--color-text-primary)]">
              {notes.length === 0 ? 'No Notes Uploaded' : 'Ask Anything About This Note'}
            </p>
            <p className="mt-1 leading-relaxed">
              {notes.length === 0
                ? 'Upload a PDF, Markdown, CSV, or text note above to get started.'
                : 'Questions will be answered strictly using the content of your selected note.'}
            </p>
          </div>
        )}
        {activeMessages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`p-3 rounded-2xl max-w-[88%] text-xs leading-relaxed ${
              m.role === 'user'
                ? 'bg-gradient-to-br from-[var(--color-accent)] to-[#2563eb] text-white rounded-br-sm shadow-sm'
                : 'bg-[var(--color-bg-card)] border border-[var(--color-border)] text-[var(--color-text-primary)] rounded-bl-sm shadow-sm'
            }`}>
              {m.role === 'user' ? m.text : <MarkdownMessage content={m.text} />}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="p-3 rounded-2xl bg-[var(--color-bg-card)] border border-[var(--color-border)] text-xs flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-bounce" />
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-bounce [animation-delay:0.15s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-bounce [animation-delay:0.3s]" />
              <span className="text-[11px] text-[var(--color-text-muted)] ml-1">Analyzing notes...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-2.5 bg-[var(--color-bg-card)] border-t border-[var(--color-border)] flex gap-2 items-center">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading || notes.length === 0}
          placeholder={notes.length === 0 ? 'Upload notes above to chat...' : 'Ask a question about your notes...'}
          className="flex-1 bg-[var(--color-bg-input)] border border-[var(--color-border)] rounded-xl resize-none max-h-24 p-2 text-xs outline-none focus:border-[var(--color-accent)] transition-colors"
          rows={1}
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim() || notes.length === 0}
          aria-label="Send query"
          className="bg-gradient-to-br from-[var(--color-accent)] to-[#2563eb] text-white p-2.5 rounded-xl hover:opacity-90 disabled:opacity-40 transition-opacity flex-shrink-0"
        >
          <Send size={16} />
        </button>
      </div>

      {showResourcePicker && (
        <ResourcePickerModal
          onClose={() => setShowResourcePicker(false)}
          onSelect={handleResourceUpload}
        />
      )}

      {/* Confirmation & Notice Dialog */}
      {alertInfo && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4 text-center animate-fade-in">
          <div className="glass-card p-5 rounded-2xl w-full max-w-[290px] border border-white/10 shadow-2xl">
            <h3 className="font-bold text-sm mb-1.5">{alertInfo.type === 'confirm' ? 'Confirm Deletion' : 'Notice'}</h3>
            <p className="text-xs text-[var(--color-text-secondary)] mb-5 leading-relaxed">{alertInfo.message}</p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => setAlertInfo(null)}
                className="btn btn-secondary text-xs px-3 py-1.5"
              >
                {alertInfo.type === 'confirm' ? 'Cancel' : 'Dismiss'}
              </button>
              {alertInfo.type === 'confirm' && (
                <button
                  onClick={alertInfo.onConfirm}
                  className="btn bg-[var(--color-danger)] text-white hover:bg-red-600 text-xs px-3 py-1.5 font-semibold"
                >
                  Delete Note
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ResourcePickerModal({ onClose, onSelect }) {
  const [subjects, setSubjects] = useState([]);
  const [selectedSubject, setSelectedSubject] = useState(null);
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSubjects();
  }, []);

  const fetchSubjects = async () => {
    try {
      const res = await resourceApi.getSubjects({});
      setSubjects(res.data.data || []);
    } catch (err) {
      console.error('Failed to load subjects', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchResources = async (subject) => {
    setSelectedSubject(subject);
    setLoading(true);
    try {
      const res = await resourceApi.getResources(subject.id);
      const allowedMimes = ['application/pdf', 'application/rtf'];
      const supportedOnly = (res.data.data || []).filter(
        (r) => r.mimetype && (r.mimetype.startsWith('text/') || allowedMimes.includes(r.mimetype))
      );
      setResources(supportedOnly);
    } catch (err) {
      console.error('Failed to load resources', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="absolute inset-0 bg-[var(--color-bg-primary)]/95 backdrop-blur-xl z-20 flex flex-col p-4 animate-fade-in">
      <div className="flex justify-between items-center mb-3">
        {selectedSubject ? (
          <button onClick={() => setSelectedSubject(null)} className="flex items-center text-xs font-semibold text-[var(--color-accent)] hover:underline">
            <ChevronLeft size={14} /> Back to Subjects
          </button>
        ) : (
          <h3 className="font-bold text-sm">Select Platform Resource</h3>
        )}
        <button onClick={onClose} aria-label="Close Resource Picker" className="p-1 hover:bg-white/10 rounded-lg">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2">
        {loading ? (
          <div className="text-center py-10 text-[var(--color-text-muted)] text-xs">Loading resources...</div>
        ) : selectedSubject ? (
          resources.length === 0 ? (
            <p className="text-xs text-[var(--color-text-muted)] text-center mt-6">No compatible text or PDF resources in this subject.</p>
          ) : (
            resources.map((r) => (
              <div
                key={r.id}
                onClick={() => onSelect(r.id)}
                className="p-2.5 border border-[var(--color-border)] rounded-xl bg-[var(--color-bg-card)] hover:border-[var(--color-accent)] cursor-pointer flex gap-2.5 items-center transition-colors"
              >
                <FileText size={20} className="text-[var(--color-accent)] shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-xs truncate">{r.title}</p>
                  <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{(r.fileSize / 1048576).toFixed(2)} MB</p>
                </div>
              </div>
            ))
          )
        ) : subjects.length === 0 ? (
          <p className="text-xs text-[var(--color-text-muted)] text-center mt-6">No subjects available for your batch.</p>
        ) : (
          subjects.map((s) => (
            <div
              key={s.id}
              onClick={() => fetchResources(s)}
              className="p-2.5 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl hover:border-[var(--color-accent)] cursor-pointer flex gap-2.5 items-center transition-colors"
            >
              <span className="text-lg">📁</span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-xs truncate">{s.name}</p>
                {s.subCategory && <p className="text-[10px] text-[var(--color-text-muted)]">{s.category} • {s.subCategory}</p>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
