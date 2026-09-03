/**
 * MessageBubble — Chat message bubble component for Comflex.
 * Features:
 * - Author information & anonymous alias tag (#XXXX) support
 * - Ring indicator badge & user showcase badges
 * - Content parser with auto-linkified URLs and clickable @mentions
 * - Full attachment support: Images, PDFs/Documents, Audio player, and Stickers
 * - Reactions tray & active emoji counts with interactive toggle & emoji picker
 * - Quoted reply preview banner with click-to-scroll
 * - Inline message editing & message deletion with RBAC
 * - Message pinning indicator & toggle action
 * - Read receipts (single check for sent, teal double check for read)
 * - Timestamp formatting & edited tag
 * - Frosted glass aesthetic with Comflex palette (#efc7c2, #ffe5d4, #bfd3c1, #68a691, #694f5d)
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import {
  Reply,
  Forward,
  Copy,
  Pencil,
  Pin,
  Trash2,
  FileText,
  Flag,
  Check,
  CheckCheck,
  Download,
  Smile,
  X,
  Music,
  ShieldCheck,
  Shield,
  Award,
} from 'lucide-react';
import resolveAsset from '../utils/resolveAsset';

const RING_COLORS = {
  0: 'var(--color-ring-0)',
  1: 'var(--color-ring-1)',
  2: 'var(--color-ring-2)',
  3: 'var(--color-ring-3)',
};

const RING_LABELS = {
  0: 'Admin',
  1: 'Manager',
  2: 'Elevated',
  3: 'Member',
};

const POPULAR_REACTIONS = ['👍', '❤️', '🔥', '😂', '🎉', '😮', '😢', '🚀', '👏', '💯'];

/**
 * Format bytes into human-readable size
 */
function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Format message timestamp into clean 12h time string
 */
function formatTime(dateString) {
  if (!dateString) return '';
  try {
    const d = new Date(dateString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/**
 * Format message full date for tooltip
 */
function formatFullDate(dateString) {
  if (!dateString) return '';
  try {
    const d = new Date(dateString);
    return d.toLocaleString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

/**
 * Parse text to convert URLs to links and @mentions to interactive chips
 */
function renderContentWithMentions(content, mentionData = [], onUserClick) {
  if (!content) return null;
  if (typeof content !== 'string') return content;

  const mentionMap = {};
  mentionData.forEach((m) => {
    if (m.displayName) {
      mentionMap[m.displayName.toLowerCase()] = m.userId;
    }
  });

  const mentionNames = mentionData
    .filter((m) => m.displayName)
    .map((m) => m.displayName)
    .sort((a, b) => b.length - a.length);

  const escaped = mentionNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const mentionPattern = escaped.length > 0 ? `@(${escaped.join('|')})` : null;
  const urlPattern = '(https?:\\/\\/[^\\s]+)';
  const combinedPattern = mentionPattern ? `${urlPattern}|${mentionPattern}` : urlPattern;
  const regex = new RegExp(combinedPattern, 'gi');

  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }

    if (match[1]) {
      // URL match
      const url = match[1];
      parts.push(
        <a
          key={`url-${match.index}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--color-accent)] hover:underline break-all font-medium transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          {url}
        </a>
      );
    } else if (match[2]) {
      // Mention match
      const matchedName = match[2];
      const userId = mentionMap[matchedName.toLowerCase()];
      parts.push(
        <span
          key={`mention-${match.index}`}
          onClick={(e) => {
            e.stopPropagation();
            if (userId && onUserClick) onUserClick(userId);
          }}
          className={`inline-flex items-center px-1.5 py-0.2 rounded-md font-semibold text-xs mx-0.5 transition-all select-none ${
            userId
              ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/25 cursor-pointer'
              : 'bg-[var(--palette-rose)]/20 text-[var(--palette-plum)] cursor-default'
          }`}
          title={userId ? `View ${matchedName}'s profile` : undefined}
        >
          @{matchedName}
        </span>
      );
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return parts.length > 0 ? parts : content;
}

export default function MessageBubble({
  message,
  currentUserId,
  permissions = {},
  isAdmin = false,
  onEdit,
  onDelete,
  onPin,
  onReact,
  onReply,
  onForward,
  onUserClick,
  replyMessage,
  members = [],
  badgeMap = {},
  anonMode = false,
  myIdentityId = null,
  isAnonCreator = false,
  onReport = null,
}) {
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content || '');
  const [copied, setCopied] = useState(false);
  const [showEmojiTray, setShowEmojiTray] = useState(false);
  const emojiTrayRef = useRef(null);

  const author = message.author || {};
  const isAnonMsg = Boolean(author.isAnonymous) || (anonMode && !message.authorId);

  const isOwn = isAnonMsg
    ? (author.id === myIdentityId || message.anonAuthorId === myIdentityId)
    : (message.authorId === currentUserId);

  const canDelete = isOwn || (anonMode ? isAnonCreator : (permissions.can_delete_others_messages || isAdmin));
  const canPin = anonMode ? isAnonCreator : (permissions.can_pin_messages || isAdmin);

  const ringIndex = Math.min(author.globalRing ?? 3, 3);
  const ringColor = isAnonMsg ? 'var(--color-text-muted)' : (RING_COLORS[ringIndex] || 'var(--color-text-muted)');
  const ringLabel = RING_LABELS[ringIndex] || 'Member';

  // Format author display label
  const authorLabel = isAnonMsg
    ? `${author.displayName || 'Anonymous'}${author.aliasTag ? `#${author.aliasTag}` : ''}`
    : (author.displayName || 'Unknown');

  // Close emoji tray when clicking outside
  useEffect(() => {
    if (!showEmojiTray) return;
    const handleClickOutside = (e) => {
      if (emojiTrayRef.current && !emojiTrayRef.current.contains(e.target)) {
        setShowEmojiTray(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showEmojiTray]);

  // Synchronize edit content when message changes
  useEffect(() => {
    setEditContent(message.content || '');
  }, [message.content]);

  const handleSaveEdit = () => {
    const trimmed = editContent.trim();
    if (trimmed && trimmed !== message.content) {
      onEdit?.(message.id, trimmed);
    }
    setEditing(false);
  };

  const handleCancelEdit = () => {
    setEditContent(message.content || '');
    setEditing(false);
  };

  const handleAuthorClick = () => {
    if (isAnonMsg) return;
    if (!isOwn && onUserClick) {
      onUserClick(message.authorId || author.id);
    }
  };

  const handleCopy = () => {
    const textToCopy = message.content || message.fileUrl || '';
    if (!textToCopy) return;

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(textToCopy).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => {});
    } else {
      const textArea = document.createElement('textarea');
      textArea.value = textToCopy;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Fallback error ignored
      }
      textArea.remove();
    }
  };

  const handleToggleReaction = (emoji) => {
    onReact?.(message.id, emoji);
    setShowEmojiTray(false);
  };

  // Build mention lookup data
  const mentionData = useMemo(() => {
    const mentionIds = message.mentions || [];
    if (!mentionIds.length || !members.length) return [];
    return mentionIds
      .map((id) => members.find((m) => m.id === id))
      .filter(Boolean)
      .map((member) => ({ userId: member.id, displayName: member.displayName }));
  }, [message.mentions, members]);

  // Render message text with mentions & URLs
  const renderedContent = useMemo(() => {
    if (message.isDeleted) return message.content;
    return renderContentWithMentions(message.content, mentionData, onUserClick);
  }, [message.content, message.isDeleted, mentionData, onUserClick]);

  // Main file attachment url
  const fileSrc = resolveAsset(message.fileUrl);

  // Multi-attachment normalized list
  const attachmentsList = useMemo(() => {
    if (Array.isArray(message.attachments) && message.attachments.length > 0) {
      return message.attachments.map((att, idx) => {
        if (typeof att === 'string') {
          return { id: idx, url: att, name: 'Attachment', size: null, type: 'file' };
        }
        return {
          id: att.id || idx,
          url: att.url || att.fileUrl,
          name: att.name || att.fileName || 'Attachment',
          size: att.size || att.fileSize,
          type: att.type || att.msgType || 'file',
          mimetype: att.mimetype,
        };
      });
    }
    return [];
  }, [message.attachments]);

  // Reactions calculations: active emojis & reactor flags
  const reactionsList = useMemo(() => {
    const raw = message.reactions || {};
    return Object.entries(raw)
      .map(([emoji, userIds]) => {
        const ids = Array.isArray(userIds) ? userIds : [];
        const hasReacted = ids.some(
          (id) =>
            id === currentUserId ||
            id === myIdentityId ||
            id === `anon:${myIdentityId}`
        );
        return {
          emoji,
          count: ids.length,
          hasReacted,
        };
      })
      .filter((r) => r.count > 0);
  }, [message.reactions, currentUserId, myIdentityId]);

  // Read receipts status: single check (sent) vs double check (read)
  const isRead = Boolean(
    message.isRead ||
    message.readAt ||
    (Array.isArray(message.readBy) && message.readBy.length > 0)
  );

  // Scroll to referenced message when clicking quote
  const scrollToRepliedMessage = () => {
    if (!replyMessage?.id) return;
    const targetElement = document.getElementById(`msg-${replyMessage.id}`);
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      targetElement.classList.add('ring-2', 'ring-[var(--color-accent)]');
      setTimeout(() => {
        targetElement.classList.remove('ring-2', 'ring-[var(--color-accent)]');
      }, 1500);
    }
  };

  return (
    <div
      id={`msg-${message.id}`}
      className={`group relative flex gap-3.5 p-3 rounded-2xl transition-all duration-200 ${
        message.isDeleted ? 'opacity-55 italic' : ''
      } ${message.isPinned ? 'bg-[var(--palette-bisque)]/15 dark:bg-[var(--palette-plum)]/20 border-l-4 border-[var(--color-warning)]' : 'hover:bg-[var(--color-bg-secondary)]'}`}
    >
      {/* Author Avatar */}
      <div
        className={`flex-shrink-0 select-none ${isAnonMsg ? 'cursor-default' : 'cursor-pointer hover:opacity-90 transition-opacity'}`}
        onClick={handleAuthorClick}
      >
        {author.avatarUrl ? (
          <img
            src={resolveAsset(author.avatarUrl)}
            alt=""
            className="w-10 h-10 rounded-full object-cover ring-2 ring-[var(--color-border)] shadow-xs"
            loading="lazy"
          />
        ) : (
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-xs select-none"
            style={{ backgroundColor: ringColor }}
          >
            {isAnonMsg ? '🎭' : (author.displayName?.charAt(0)?.toUpperCase() || '?')}
          </div>
        )}
      </div>

      {/* Main Message Body */}
      <div className="flex-1 min-w-0">
        {/* Forwarded Header Banner */}
        {message.forwarded && (
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)] mb-1 font-medium select-none">
            <Forward size={12} className="text-[var(--color-text-muted)]" />
            <span>Forwarded message</span>
          </div>
        )}

        {/* Quoted Reply Preview */}
        {replyMessage && (
          <div
            onClick={scrollToRepliedMessage}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && scrollToRepliedMessage()}
            className="flex flex-col px-3 py-1.5 mb-2 rounded-xl border-l-3 bg-[var(--color-bg-card)] border-[var(--color-accent)] text-xs cursor-pointer hover:bg-[var(--color-bg-matte)] transition-all shadow-xs"
            title="Jump to message"
          >
            <div className="flex items-center gap-1.5 font-semibold text-[11px]">
              <Reply size={11} className="text-[var(--color-accent)]" />
              <span
                style={{
                  color:
                    RING_COLORS[Math.min(replyMessage.author?.globalRing ?? 3, 3)] ||
                    'var(--color-text-primary)',
                }}
              >
                {replyMessage.author?.displayName || 'Unknown'}
              </span>
            </div>
            <span className="text-[var(--color-text-secondary)] truncate mt-0.5">
              {replyMessage.msgType === 'text' || !replyMessage.msgType
                ? replyMessage.content
                : `[${replyMessage.msgType}] ${replyMessage.fileName || replyMessage.content || ''}`}
            </span>
          </div>
        )}

        {/* Message Header: Author, Badges, Timestamp, Pin, Read Receipts */}
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          {/* Author Name */}
          <span
            className={`font-bold text-sm select-none ${isAnonMsg ? 'text-[var(--palette-plum)] dark:text-[var(--palette-rose)]' : 'cursor-pointer hover:underline'}`}
            style={{ color: isAnonMsg ? undefined : ringColor }}
            onClick={handleAuthorClick}
          >
            {authorLabel}
            {isOwn && <span className="font-normal text-xs text-[var(--color-text-muted)]"> (you)</span>}
          </span>

          {/* Anonymous Tag Chip */}
          {isAnonMsg && (
            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-[var(--palette-rose)]/20 text-[var(--palette-plum)] dark:text-[var(--palette-rose)] border border-[var(--palette-rose)]/40 select-none">
              Anon
            </span>
          )}

          {/* Ring Role Badge (for regular users) */}
          {!isAnonMsg && author.globalRing !== undefined && author.globalRing !== 3 && (
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.2 rounded-full text-[10px] font-bold ring-badge-${author.globalRing} select-none`}
              title={ringLabel}
            >
              {author.globalRing === 0 ? (
                <ShieldCheck size={11} />
              ) : author.globalRing === 1 ? (
                <Shield size={11} />
              ) : (
                <Award size={11} />
              )}
              <span>{ringLabel}</span>
            </span>
          )}

          {/* Display Badges */}
          {!isAnonMsg &&
            author.displayBadges?.slice(0, 5).map((badgeId, i) => {
              const badge = badgeMap[badgeId];
              if (!badge?.imageUrl) return null;
              return (
                <img
                  key={i}
                  src={resolveAsset(badge.imageUrl)}
                  alt={badge.name || ''}
                  title={badge.name || 'Badge'}
                  className="w-4 h-4 object-contain drop-shadow-xs select-none"
                  loading="lazy"
                />
              );
            })}

          {/* Timestamp */}
          <span
            className="text-[11px] text-[var(--color-text-muted)] font-medium select-none"
            title={formatFullDate(message.createdAt)}
          >
            {formatTime(message.createdAt)}
          </span>

          {/* Edited indicator */}
          {message.editedAt && (
            <span
              className="text-[10px] text-[var(--color-text-muted)] italic select-none"
              title={`Edited at ${formatFullDate(message.editedAt)}`}
            >
              (edited)
            </span>
          )}

          {/* Pinned Icon */}
          {message.isPinned && (
            <span className="inline-flex items-center text-[var(--color-warning)]" title="Pinned message">
              <Pin size={12} className="fill-[var(--color-warning)]" />
            </span>
          )}

          {/* Read Receipts (for own messages) */}
          {isOwn && (
            <span
              className="inline-flex items-center select-none"
              title={isRead ? 'Read' : 'Sent'}
            >
              {isRead ? (
                <CheckCheck size={14} className="text-[var(--color-accent)]" />
              ) : (
                <Check size={14} className="text-[var(--color-text-muted)]" />
              )}
            </span>
          )}
        </div>

        {/* Message Content & Inline Editor */}
        {editing ? (
          <div className="mt-1.5 p-2 rounded-xl bg-[var(--color-bg-card)] border border-[var(--color-accent)] space-y-2">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSaveEdit();
                } else if (e.key === 'Escape') {
                  handleCancelEdit();
                }
              }}
              rows={2}
              className="w-full bg-transparent text-sm text-[var(--color-text-primary)] outline-none resize-none"
              autoFocus
            />
            <div className="flex items-center justify-end gap-2 text-xs">
              <button
                onClick={handleCancelEdit}
                className="btn btn-secondary px-3 py-1 text-xs"
                type="button"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={!editContent.trim()}
                className="btn btn-primary px-3 py-1 text-xs"
                type="button"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Text Content */}
            {message.content && (
              <p
                className={`text-sm text-[var(--color-text-secondary)] leading-relaxed break-words whitespace-pre-wrap ${
                  message.msgType === 'sticker' ? 'text-4xl' : ''
                }`}
              >
                {renderedContent}
              </p>
            )}

            {/* Single Attachment: Image */}
            {message.msgType === 'image' && fileSrc && (
              <div className="mt-2 rounded-2xl overflow-hidden max-w-sm md:max-w-md border border-[var(--color-border)] shadow-xs bg-[var(--color-bg-card)]">
                <img
                  src={fileSrc}
                  alt={message.fileName || 'Shared image'}
                  className="w-full max-h-80 object-cover cursor-pointer hover:opacity-95 transition-opacity"
                  onClick={() => window.open(fileSrc, '_blank', 'noopener,noreferrer')}
                  loading="lazy"
                />
              </div>
            )}

            {/* Single Attachment: Audio */}
            {message.msgType === 'audio' && fileSrc && (
              <div className="mt-2 p-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] max-w-md shadow-xs">
                <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-[var(--color-text-primary)]">
                  <Music size={14} className="text-[var(--color-accent)]" />
                  <span className="truncate">{message.fileName || 'Voice Note / Audio'}</span>
                </div>
                <audio controls src={fileSrc} preload="metadata" className="w-full h-8" />
              </div>
            )}

            {/* Single Attachment: Document / PDF */}
            {(message.msgType === 'document' || message.msgType === 'pdf') && fileSrc && (
              <a
                href={fileSrc}
                download={message.fileName || true}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 flex items-center justify-between p-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] hover:bg-[var(--color-bg-matte)] transition-all max-w-md shadow-xs group/doc"
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="w-10 h-10 rounded-xl bg-[var(--palette-teal)]/15 flex items-center justify-center text-[var(--palette-teal)] shrink-0">
                    <FileText size={18} />
                  </div>
                  <div className="truncate">
                    <p className="text-sm font-semibold truncate text-[var(--color-text-primary)] group-hover/doc:text-[var(--color-accent)] transition-colors">
                      {message.fileName || 'Document'}
                    </p>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                      {formatFileSize(message.fileSize)}
                    </p>
                  </div>
                </div>
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors ml-2">
                  <Download size={16} />
                </div>
              </a>
            )}

            {/* Single Attachment: Sticker */}
            {message.msgType === 'sticker' && fileSrc && (
              <div className="mt-2 select-none">
                <img
                  src={fileSrc}
                  alt="Sticker"
                  className="w-32 h-32 object-contain drop-shadow-md"
                  loading="lazy"
                />
              </div>
            )}

            {/* Multi-attachment list support */}
            {attachmentsList.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 max-w-lg">
                {attachmentsList.map((att) => {
                  const resolvedAttUrl = resolveAsset(att.url);
                  const isImg = att.type === 'image' || att.mimetype?.startsWith('image/');
                  const isAudio = att.type === 'audio' || att.mimetype?.startsWith('audio/');

                  if (isImg && resolvedAttUrl) {
                    return (
                      <div
                        key={att.id}
                        className="rounded-xl overflow-hidden border border-[var(--color-border)] shadow-xs"
                      >
                        <img
                          src={resolvedAttUrl}
                          alt={att.name}
                          className="w-full h-36 object-cover cursor-pointer hover:opacity-95"
                          onClick={() => window.open(resolvedAttUrl, '_blank', 'noopener,noreferrer')}
                          loading="lazy"
                        />
                      </div>
                    );
                  }

                  if (isAudio && resolvedAttUrl) {
                    return (
                      <div
                        key={att.id}
                        className="col-span-full p-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)]"
                      >
                        <p className="text-xs font-semibold truncate mb-1 text-[var(--color-text-primary)]">
                          {att.name}
                        </p>
                        <audio controls src={resolvedAttUrl} preload="metadata" className="w-full h-8" />
                      </div>
                    );
                  }

                  return (
                    <a
                      key={att.id}
                      href={resolvedAttUrl}
                      download={att.name}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between p-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] hover:bg-[var(--color-bg-matte)] transition-all"
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <FileText size={16} className="text-[var(--color-accent)] shrink-0" />
                        <span className="text-xs font-semibold truncate text-[var(--color-text-primary)]">
                          {att.name}
                        </span>
                      </div>
                      <Download size={14} className="text-[var(--color-accent)] shrink-0 ml-1.5" />
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Active Reactions Pills Tray */}
        {reactionsList.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {reactionsList.map(({ emoji, count, hasReacted }) => (
              <button
                key={emoji}
                type="button"
                onClick={() => handleToggleReaction(emoji)}
                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold transition-all select-none border cursor-pointer ${
                  hasReacted
                    ? 'bg-[var(--palette-teal)]/20 border-[var(--palette-teal)] text-[var(--palette-teal)] dark:text-[var(--palette-sage)] shadow-xs'
                    : 'bg-[var(--color-bg-card)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]'
                }`}
                title={hasReacted ? `Remove ${emoji}` : `React with ${emoji}`}
              >
                <span>{emoji}</span>
                <span className="text-[11px] font-bold">{count}</span>
              </button>
            ))}

            {/* Plus reaction quick button */}
            <button
              type="button"
              onClick={() => setShowEmojiTray((prev) => !prev)}
              className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-dashed border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-hover)] hover:bg-[var(--color-bg-card)] transition-all text-xs"
              title="Add reaction"
            >
              +
            </button>
          </div>
        )}
      </div>

      {/* Floating Emoji Picker Popup Tray */}
      {showEmojiTray && (
        <div
          ref={emojiTrayRef}
          className="absolute right-4 top-10 z-30 p-1.5 rounded-2xl bg-[var(--color-bg-matte)] backdrop-blur-xl border border-[var(--color-border)] shadow-xl flex items-center gap-1 animate-in fade-in zoom-in-95 duration-150"
        >
          {POPULAR_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => handleToggleReaction(emoji)}
              className="w-8 h-8 rounded-xl flex items-center justify-center text-base hover:bg-[var(--color-bg-secondary)] hover:scale-120 transition-all cursor-pointer select-none"
            >
              {emoji}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowEmojiTray(false)}
            className="w-7 h-7 rounded-xl flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Hover Action Bar */}
      {!message.isDeleted && (
        <div className="absolute right-3 top-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none group-hover:pointer-events-auto z-20">
          <div className="flex items-center p-0.5 rounded-xl bg-[var(--color-bg-matte)] backdrop-blur-xl border border-[var(--color-border)] shadow-lg gap-0.5">
            {/* Reaction button */}
            <button
              onClick={() => setShowEmojiTray((prev) => !prev)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:bg-[var(--color-bg-secondary)] transition-colors"
              title="Add reaction"
              type="button"
            >
              <Smile size={14} />
            </button>

            {/* Reply button */}
            <button
              onClick={() => onReply?.(message)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] transition-colors"
              title="Reply"
              type="button"
            >
              <Reply size={14} />
            </button>

            {/* Forward button */}
            <button
              onClick={() => onForward?.(message)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] transition-colors"
              title="Forward"
              type="button"
            >
              <Forward size={14} />
            </button>

            {/* Copy button */}
            <button
              onClick={handleCopy}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] transition-colors"
              title={copied ? 'Copied!' : 'Copy'}
              type="button"
            >
              {copied ? <Check size={14} className="text-[var(--color-success)]" /> : <Copy size={14} />}
            </button>

            {/* Edit button (Own message only) */}
            {isOwn && !editing && (
              <button
                onClick={() => setEditing(true)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] transition-colors"
                title="Edit"
                type="button"
              >
                <Pencil size={14} />
              </button>
            )}

            {/* Pin / Unpin button */}
            {canPin && (
              <button
                onClick={() => onPin?.(message.id, !message.isPinned)}
                className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                  message.isPinned
                    ? 'text-[var(--color-warning)] hover:bg-[var(--color-warning)]/15'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-warning)] hover:bg-[var(--color-bg-secondary)]'
                }`}
                title={message.isPinned ? 'Unpin message' : 'Pin message'}
                type="button"
              >
                <Pin size={14} />
              </button>
            )}

            {/* Anonymous Report button */}
            {isAnonMsg && !isOwn && onReport && (
              <button
                onClick={() => onReport(author.id, authorLabel)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 transition-colors"
                title="Report anonymous identity"
                type="button"
              >
                <Flag size={14} />
              </button>
            )}

            {/* Delete button */}
            {canDelete && (
              <button
                onClick={() => onDelete?.(message.id)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 transition-colors"
                title="Delete message"
                type="button"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
