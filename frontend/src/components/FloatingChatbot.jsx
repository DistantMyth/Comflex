import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, X, Send, Paperclip, FileText, UploadCloud, Trash2, Search, ChevronLeft, Bot, Sparkles } from 'lucide-react';
import api from '../api/client';
import { resourceApi } from '../api/resourceApi';
import { useAuth } from '../hooks/useAuth';

export default function FloatingChatbot() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [limits, setLimits] = useState(null);
  const [notes, setNotes] = useState([]);
  const [selectedNoteId, setSelectedNoteId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showResourcePicker, setShowResourcePicker] = useState(false);
  const [alertInfo, setAlertInfo] = useState(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      fetchLimits();
      fetchNotes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
      setNotes(res.data.data);
      if (res.data.data.length > 0 && !selectedNoteId) {
        setSelectedNoteId(res.data.data[0].id);
      }
    } catch (err) {
      console.error('Failed to fetch notes', err);
    }
  };

  const handleLocalUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (limits?.plan !== 'ultra') {
      setAlertInfo({ type: 'alert', message: 'Local uploads are only available on the Ultra plan.' });
      return;
    }
    const formData = new FormData();
    formData.append('file', file);
    setLoading(true);
    try {
      await api.post('/chatbot/upload/local', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      });
      fetchLimits();
      fetchNotes();
    } catch (err) {
      setAlertInfo({ type: 'alert', message: err.response?.data?.error || 'Upload failed' });
    } finally {
      setLoading(false);
    }
  };

  const handleResourceUpload = async (resourceId) => {
    setShowResourcePicker(false);
    if (!resourceId) return;
    setLoading(true);
    try {
      await api.post('/chatbot/upload/resource', { resourceId }, { timeout: 120000 });
      fetchLimits();
      fetchNotes();
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.response?.data?.error || 'Upload failed';
      setAlertInfo({ type: 'alert', message: typeof msg === 'object' ? JSON.stringify(msg) : msg });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteNote = (id) => {
    setAlertInfo({ type: 'confirm', message: 'Are you sure you want to delete this note?', onConfirm: () => executeDeleteNote(id) });
  };

  const executeDeleteNote = async (id) => {
    setAlertInfo(null);
    try {
      await api.delete(`/chatbot/${id}`);
      if (selectedNoteId === id) setSelectedNoteId(null);
      fetchLimits();
      fetchNotes();
    } catch (err) {
      setAlertInfo({ type: 'alert', message: 'Delete failed' });
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || !selectedNoteId) return;
    const userMsg = { role: 'user', text: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    try {
      const res = await api.post('/chatbot/chat', { noteId: selectedNoteId, query: userMsg.text }, { timeout: 120000 });
      setMessages((prev) => [...prev, { role: 'bot', text: res.data.data.answer }]);
      if (limits?.plan === 'free') {
        setLimits((prev) => ({ ...prev, dailyChatTokens: res.data.data.remainingTokens }));
      }
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.response?.data?.error || 'Error contacting AI.';
      setMessages((prev) => [...prev, { role: 'bot', text: typeof msg === 'object' ? JSON.stringify(msg) : msg }]);
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
        className="fixed bottom-6 right-6 p-4 rounded-full bg-gradient-to-br from-[var(--color-accent-light)] via-[var(--color-accent)] to-[#2563eb] text-white shadow-[0_10px_34px_-6px_rgba(124,58,237,0.6)] hover:scale-110 active:scale-95 transition-transform z-50"
        title="AI Notes Assistant"
      >
        <Bot size={26} />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-96 max-w-[calc(100vw-2rem)] h-[600px] max-h-[calc(100vh-4rem)] glass-card rounded-3xl shadow-2xl flex flex-col overflow-hidden z-50 transition-all">
      {/* Header */}
      <div className="bg-gradient-to-r from-[var(--color-accent)] to-[#2563eb] text-white p-4 flex justify-between items-center">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center">
            <Sparkles size={17} />
          </div>
          <div>
            <h3 className="font-bold leading-none">Notes AI</h3>
            {limits && (
              <p className="text-xs text-white/75 mt-1">
                Plan: <span className="uppercase font-semibold">{limits.plan}</span>
                {limits.plan === 'free' && ` · Tokens: ${limits.dailyChatTokens}`}
              </p>
            )}
          </div>
        </div>
        <button onClick={() => setIsOpen(false)} className="hover:bg-white/15 p-1.5 rounded-lg transition">
          <X size={20} />
        </button>
      </div>

      {/* Note Selection Area */}
      <div className="p-3 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex items-center gap-2 overflow-x-auto">
        <span className="text-xs font-semibold text-[var(--color-text-muted)] uppercase shrink-0">Notes:</span>
        {notes.map((n) => (
          <button
            key={n.id}
            onClick={() => setSelectedNoteId(n.id)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap transition-all ${
              selectedNoteId === n.id
                ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] border border-[var(--color-accent)]/30'
                : 'bg-[var(--color-bg-card)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-glass)]'
            }`}
          >
            <FileText size={12} />
            {n.title.substring(0, 15)}...
            <Trash2 size={12} className="ml-0.5 text-[var(--color-danger)] hover:opacity-80" onClick={(e) => { e.stopPropagation(); handleDeleteNote(n.id); }} />
          </button>
        ))}
        <button
          title="Import from Resources"
          onClick={() => setShowResourcePicker(true)}
          disabled={loading}
          className="p-1.5 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] disabled:opacity-50 shrink-0"
        >
          <UploadCloud size={14} />
        </button>
        {limits?.plan === 'ultra' && (
          <label className="p-1.5 rounded-lg bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/25 cursor-pointer disabled:opacity-50 flex items-center shrink-0">
            <Paperclip size={14} />
            <input type="file" className="hidden" accept=".pdf,.txt,.csv,.md" onChange={handleLocalUpload} />
          </label>
        )}
      </div>

      {/* Chat Area */}
      <div className="flex-1 p-4 overflow-y-auto bg-[var(--color-bg-secondary)] flex flex-col gap-3">
        {messages.length === 0 && (
          <div className="text-center text-[var(--color-text-muted)] mt-10 text-sm">
            {notes.length === 0 ? 'Upload notes above to get started.' : 'Ask anything about your notes!'}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`p-3 rounded-2xl max-w-[85%] text-sm leading-relaxed ${
              m.role === 'user'
                ? 'bg-gradient-to-br from-[var(--color-accent)] to-[#2563eb] text-white rounded-br-md'
                : 'bg-[var(--color-bg-card)] border border-[var(--color-border)] text-[var(--color-text-primary)] rounded-bl-md'
            }`}>
              {m.text}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="p-3 rounded-2xl bg-[var(--color-bg-card)] border border-[var(--color-border)] animate-pulse text-sm flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-bounce" />
              <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-bounce [animation-delay:0.15s]" />
              <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-bounce [animation-delay:0.3s]" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 bg-[var(--color-bg-card)] border-t border-[var(--color-border)] flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading || notes.length === 0}
          placeholder={notes.length === 0 ? 'Upload notes to chat...' : 'Ask a question...'}
          className="flex-1 bg-[var(--color-bg-input)] border border-[var(--color-border)] rounded-xl resize-none h-10 p-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
          rows={1}
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim() || notes.length === 0}
          className="bg-gradient-to-br from-[var(--color-accent)] to-[#2563eb] text-white p-2.5 rounded-xl hover:opacity-90 disabled:opacity-40 transition"
        >
          <Send size={18} />
        </button>
      </div>

      {showResourcePicker && <ResourcePickerModal onClose={() => setShowResourcePicker(false)} onSelect={handleResourceUpload} />}

      {/* Alert Popup */}
      {alertInfo && (
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm z-[60] flex flex-col justify-center items-center p-6 text-center">
          <div className="glass-card p-6 rounded-2xl w-full max-w-[280px]">
            <h3 className="font-bold mb-2">{alertInfo.type === 'confirm' ? 'Confirmation' : 'Notice'}</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-6">{alertInfo.message}</p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setAlertInfo(null)} className="px-4 py-2 rounded-lg text-sm font-semibold bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition">
                {alertInfo.type === 'confirm' ? 'Cancel' : 'OK'}
              </button>
              {alertInfo.type === 'confirm' && (
                <button onClick={alertInfo.onConfirm} className="px-4 py-2 rounded-lg text-sm font-semibold bg-[var(--color-danger)] text-white hover:opacity-90 transition">
                  Delete
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
  const { user } = useAuth();
  const [subjects, setSubjects] = useState([]);
  const [selectedSubject, setSelectedSubject] = useState(null);
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);

  let myYear = 29;
  if (user?.cohortTags) {
    for (const tag of user.cohortTags) {
      if (tag.startsWith('cohort-') && !tag.includes('-', 7)) {
        const p = parseInt(tag.split('-')[1], 10);
        if (p) myYear = p;
      }
    }
  }

  useEffect(() => {
    fetchSubjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchSubjects = async () => {
    try {
      const res = await resourceApi.getSubjects({});
      let allSubs = res.data.data;
      if (user?.globalRing !== 0) {
        allSubs = allSubs.filter((s) => {
          if (s.name === 'Technical' || s.category === 'Technical') return true;
          if (s.subCategory === `Batch ${myYear}` || s.subCategory === `Batch ${myYear + 1}`) return true;
          return false;
        });
      }
      setSubjects(allSubs);
    } catch (err) {
      console.error(err);
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
      const supportedOnly = res.data.data.filter((r) => r.mimetype && (r.mimetype.startsWith('text/') || allowedMimes.includes(r.mimetype)));
      setResources(supportedOnly);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="absolute inset-0 bg-[var(--color-bg-glass)] backdrop-blur-xl z-20 flex flex-col p-4">
      <div className="flex justify-between items-center mb-4">
        {selectedSubject ? (
          <button onClick={() => setSelectedSubject(null)} className="flex items-center text-sm font-semibold text-[var(--color-accent)] hover:underline">
            <ChevronLeft size={16} /> Back to Folders
          </button>
        ) : (
          <h3 className="font-bold">Select Resource</h3>
        )}
        <button onClick={onClose}><X size={20} /></button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2">
        {loading ? (
          <div className="text-center py-10 text-[var(--color-text-muted)] text-sm">Loading...</div>
        ) : selectedSubject ? (
          resources.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)] text-center mt-4">Empty folder.</p>
          ) : (
            resources.map((r) => (
              <div key={r.id} onClick={() => onSelect(r.id)} className="p-3 border border-[var(--color-border)] rounded-xl bg-[var(--color-bg-card)] hover:border-[var(--color-accent)] cursor-pointer flex gap-3 items-center transition">
                <FileText size={22} className="text-[var(--color-accent)] shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{r.title}</p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{(r.fileSize / 1048576).toFixed(2)} MB</p>
                </div>
              </div>
            ))
          )
        ) : subjects.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)] text-center mt-4">No subjects found.</p>
        ) : (
          subjects.map((s) => (
            <div key={s.id} onClick={() => fetchResources(s)} className="p-3 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl hover:border-[var(--color-accent)] cursor-pointer flex gap-3 items-center transition">
              <span className="text-xl">📁</span>
              <div>
                <p className="font-medium text-sm">{s.name}</p>
                {s.subCategory && <p className="text-[10px] text-[var(--color-text-muted)] uppercase">{s.category} • {s.subCategory}</p>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
