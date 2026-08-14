import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { resourceApi } from '../api/resourceApi';
import resolveAsset from '../utils/resolveAsset';

const getDynamicFolderTree = (user, myYear) => {
  const tree = {
    'Academics': {},
    'Technical': 'SUBJECTS'
  };

  const isAdminId = user?.globalRing === 0;
  // Admin sees more batches for prep, typical user only sees their own and their immediate junior
  const startYear = isAdminId ? myYear - 2 : myYear;
  const count = isAdminId ? 6 : 2;

  for (let i = 0; i < count; i++) {
    const year = startYear + i;
    
    // Non-admins can only see "Last Year" for their junior's batch
    if (!isAdminId && year === myYear + 1) {
      tree['Academics'][`Batch ${year}`] = {
        'Notes': {
          'Last Year': 'SUBJECTS',
        },
        'Past Year Paper': 'SUBJECTS'
      };
    } else {
      tree['Academics'][`Batch ${year}`] = {
        'Notes': {
          'This Year': 'SUBJECTS',
          'Last Year': 'SUBJECTS',
        },
        'Past Year Paper': 'SUBJECTS'
      };
    }
  }
  
  return tree;
};

export default function ResourcesPage() {
  const { user } = useAuth();
  
  const [path, setPath] = useState([]); // Array of path segments
  const [subjects, setSubjects] = useState([]);
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(false);

  // Modals
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showSubjectModal, setShowSubjectModal] = useState(false);

  const isAdminOrManager = user?.globalRing === 0 || user?.canManageResources;

  let myYear = 29; // fallback
  if (user?.cohortTags && Array.isArray(user.cohortTags)) {
    for (const tag of user.cohortTags) {
      if (tag.startsWith('cohort-') && !tag.includes('-', 7)) {
        const year = parseInt(tag.split('-')[1], 10);
        if (!isNaN(year)) myYear = year;
      }
    }
  }

  const dynamicTree = getDynamicFolderTree(user, myYear);

  const currentLevel = path.reduce((tree, node) => {
    if (node.type === 'subject') return 'FILES';
    if (tree === 'SUBJECTS' || tree === 'FILES') return tree;
    return tree[node.name] || 'FILES';
  }, dynamicTree);

  const getCurrentCategory = useCallback(() => path[0]?.name, [path]);
  const getCurrentSubCategory = useCallback(() => {
    if (path[0]?.name === 'Technical') return null;
    return path[1]?.name; // e.g. "Batch 29"
  }, [path]);
  const getCurrentYearGroup = useCallback(() => {
    if (path[0]?.name === 'Technical') return null;
    if (path[2]?.name === 'Notes') {
      return `Notes - ${path[3]?.name}`;
    }
    if (path[2]?.name === 'Past Year Paper') {
      return 'Past Year Paper';
    }
    return null;
  }, [path]);
  const getCurrentSubject = useCallback(() => path.find(p => p.type === 'subject'), [path]);

  const fetchSubjects = useCallback(async () => {
    if (currentLevel !== 'SUBJECTS') return;
    setLoading(true);
    try {
      const res = await resourceApi.getSubjects({
        category: getCurrentCategory(),
        subCategory: getCurrentSubCategory(),
        yearGroup: getCurrentYearGroup()
      });
      setSubjects(res.data.data);
    } catch(err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [currentLevel, getCurrentCategory, getCurrentSubCategory, getCurrentYearGroup]);

  const fetchResources = useCallback(async () => {
    const subj = getCurrentSubject();
    if (!subj) return;
    setLoading(true);
    try {
      const res = await resourceApi.getResources(subj.id);
      setResources(res.data.data);
    } catch(err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [getCurrentSubject]);

  useEffect(() => {
    if (currentLevel === 'SUBJECTS') {
      fetchSubjects();
    } else if (currentLevel === 'FILES') {
      fetchResources();
    }
  }, [currentLevel, fetchSubjects, fetchResources]);

  const navigateTo = (index) => {
    if (index === -1) setPath([]);
    else setPath(path.slice(0, index + 1));
  };

  const handleFolderClick = (name, type = 'folder', id = null) => {
    setPath([...path, { name, type, id }]);
  };

  const handleDeleteSubject = async (e, id) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this subject and ALL its files?')) return;
    try {
      await resourceApi.deleteSubject(id);
      fetchSubjects();
    } catch(err) {
      alert(err.response?.data?.error?.message || 'Failed to delete');
    }
  };

  const handleDeleteResource = async (id) => {
    if (!confirm('Are you sure you want to delete this file?')) return;
    try {
      await resourceApi.deleteResource(id);
      fetchResources();
    } catch(err) {
      alert(err.response?.data?.error?.message || 'Failed to delete');
    }
  };

  // UI Renderers
  const renderFolders = () => {
    if (currentLevel === 'SUBJECTS') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {subjects.length === 0 && !loading && (
            <p className="text-[var(--color-text-muted)] col-span-3 py-8 text-center bg-[var(--color-bg-primary)] rounded-xl border border-[var(--color-border)]">No subjects created yet.</p>
          )}
          {loading && <div className="col-span-3 text-center py-4">Loading...</div>}
          {!loading && subjects.map(subj => (
            <div key={subj.id} onClick={() => handleFolderClick(subj.name, 'subject', subj.id)}
              className="glass-card p-4 flex items-center justify-between cursor-pointer hover:border-[var(--color-accent)] transition-colors group">
              <div className="flex items-center gap-3">
                <span className="text-2xl">📁</span>
                <span className="font-medium text-sm">{subj.name}</span>
              </div>
              {isAdminOrManager && (
                <button onClick={(e) => handleDeleteSubject(e, subj.id)} className="text-xs text-[var(--color-danger)] opacity-0 group-hover:opacity-100 transition-opacity">
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>
      );
    }
    
    if (typeof currentLevel === 'object') {
      const keys = Object.keys(currentLevel);
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {keys.map(k => {
            const isJuniorBadge = !isAdminOrManager && k === `Batch ${myYear + 1}`;
            return (
              <div key={k} onClick={() => handleFolderClick(k)}
                className={`glass-card p-5 flex items-center gap-4 cursor-pointer transition-all transform hover:-translate-y-1 ${isJuniorBadge ? 'border-[var(--color-primary)] shadow-[0_0_10px_rgba(var(--color-primary-rgb),0.2)]' : 'hover:border-[var(--color-accent)]'}`}>
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-light)] flex items-center justify-center text-white text-xl">
                  📂
                </div>
                <span className="font-semibold flex items-center gap-2">
                  {k}
                  {isJuniorBadge && (
                    <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--color-primary)] px-2 py-0.5 rounded-full border border-[var(--color-primary)] bg-[var(--color-bg-primary)]">
                      Junior
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      );
    }

    return null;
  };

  const renderFiles = () => {
    if (currentLevel !== 'FILES') return null;
    
    return (
      <div className="space-y-3">
        {loading && <div className="text-center py-4">Loading files...</div>}
        {!loading && resources.length === 0 && (
          <p className="text-[var(--color-text-muted)] text-center py-8 bg-[var(--color-bg-primary)] rounded-xl border border-[var(--color-border)]">This folder is empty. Be the first to upload notes!</p>
        )}
        {!loading && resources.map(res => {
          const canDelete = user.id === res.uploaderId || isAdminOrManager;
          const mbSize = (res.fileSize / (1024 * 1024)).toFixed(1);
          return (
            <div key={res.id} className="glass-card p-4 flex items-center gap-4">
              <div className="text-3xl text-[var(--color-primary)]">📄</div>
              <div className="flex-1 min-w-0">
                <a href={resolveAsset(res.fileUrl)} target="_blank" rel="noreferrer" 
                   className="font-medium hover:text-[var(--color-accent)] hover:underline block truncate">
                  {res.title}
                </a>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  {mbSize} MB • Uploaded by {res.uploader?.displayName}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <a href={resolveAsset(res.fileUrl)} download={res.fileName} className="btn btn-secondary text-xs px-3 py-1">
                  Download
                </a>
                {canDelete && (
                  <button onClick={() => handleDeleteResource(res.id)} className="btn btn-danger text-xs px-3 py-1 bg-[rgba(239,68,68,0.1)] text-red-500 hover:bg-red-500 hover:text-white border-none">
                    Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <>
    <div className="max-w-5xl mx-auto py-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
          <div className="flex-1">
            <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-primary)]">
              Resources Library
            </h1>
            
            {/* Breadcrumbs */}
            <div className="flex items-center gap-2 mt-3 text-sm overflow-x-auto pb-2 whitespace-nowrap">
              <button onClick={() => navigateTo(-1)} className={`hover:text-[var(--color-accent)] ${path.length === 0 ? 'text-[var(--color-accent)] font-semibold' : 'text-[var(--color-text-secondary)]'}`}>
                Library Home
              </button>
              {path.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[var(--color-text-muted)]">/</span>
                  <button onClick={() => navigateTo(i)} 
                    className={`hover:text-[var(--color-accent)] ${i === path.length - 1 ? 'text-[var(--color-accent)] font-semibold' : 'text-[var(--color-text-secondary)]'}`}>
                    {p.name}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {currentLevel === 'SUBJECTS' && isAdminOrManager && (
              <button onClick={() => setShowSubjectModal(true)} className="btn btn-secondary shadow-md">
                + New Subject
              </button>
            )}
            {currentLevel === 'FILES' && (
              <button onClick={() => setShowUploadModal(true)} className="btn btn-primary shadow-lg transform transition-transform hover:scale-105">
                ☁ Upload File
              </button>
            )}
          </div>
        </div>

        <div className="mt-6 animation-fade-in">
          {renderFolders()}
          {renderFiles()}
        </div>
      </div>

      {showSubjectModal && (
        <SubjectModal 
          onClose={() => setShowSubjectModal(false)} 
          category={getCurrentCategory()}
          subCategory={getCurrentSubCategory()}
          yearGroup={getCurrentYearGroup()}
          onSuccess={fetchSubjects}
        />
      )}

      {showUploadModal && (
        <UploadModal 
          onClose={() => setShowUploadModal(false)}
          subjectId={getCurrentSubject()?.id}
          onSuccess={fetchResources}
        />
      )}
    </>
  );
}

function SubjectModal({ onClose, category, subCategory, yearGroup, onSuccess }) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await resourceApi.createSubject({ name, category, subCategory, yearGroup });
      onSuccess();
      onClose();
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to create subject');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex justify-center items-center z-50 p-4 animate-fade-in">
      <div className="bg-[var(--color-bg-primary)] p-6 rounded-2xl max-w-sm w-full border border-[var(--color-border)] shadow-2xl">
        <h3 className="text-lg font-bold mb-4">Create New Subject</h3>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Subject Name</label>
            <input type="text" autoFocus value={name} onChange={e => setName(e.target.value)} 
              className="w-full bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg px-3 py-2 outline-none focus:border-[var(--color-accent)]" placeholder="e.g. Data Structures" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
            <button type="submit" disabled={submitting || !name.trim()} className="btn btn-primary">{submitting ? 'Creating...' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function UploadModal({ onClose, subjectId, onSuccess }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const abortCtrl = useRef(null);

  const handleFile = (e) => {
    const selected = e.target.files[0];
    if (selected) {
      if (selected.size > 75 * 1024 * 1024) {
        alert('File size exceeds the 75MB limit.');
        e.target.value = '';
        return;
      }
      setFile(selected);
      if (!title) setTitle(selected.name);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file || !subjectId) return;

    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('title', title || file.name);
    fd.append('subjectId', subjectId);

    abortCtrl.current = new AbortController();

    try {
      await resourceApi.uploadResource(fd, (evt) => {
        if (evt.total) {
          setProgress(Math.round((evt.loaded * 100) / evt.total));
        }
      });
      onSuccess();
      onClose();
    } catch(err) {
      if (err.name !== 'CanceledError') {
         alert(err.response?.data?.error?.message || 'Upload failed');
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex justify-center items-center z-50 p-4 animate-fade-in">
      <div className="bg-[var(--color-bg-primary)] p-6 rounded-2xl max-w-md w-full border border-[var(--color-border)] shadow-2xl">
        <h3 className="text-lg font-bold mb-4">Upload File</h3>
        
        {uploading ? (
          <div className="space-y-4 py-6">
            <div className="text-center font-medium">Uploading... {progress}%</div>
            <div className="w-full bg-[var(--color-bg-card)] rounded-full h-3 overflow-hidden">
              <div className="bg-[var(--color-accent)] h-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1 border-b border-[var(--color-border)] pb-2 cursor-pointer
                hover:border-[var(--color-accent)] transition-colors group">
                <div className="py-6 flex flex-col items-center justify-center text-[var(--color-text-secondary)] group-hover:text-[var(--color-primary)] bg-[var(--color-bg-card)] rounded-xl border border-dashed border-[var(--color-border)]">
                  <span className="text-3xl mb-2">☁</span>
                  <span className="text-sm font-semibold">{file ? file.name : 'Click to select file (Max 75MB)'}</span>
                </div>
                <input type="file" required onChange={handleFile} className="hidden" />
              </label>
            </div>
            
            {file && (
              <div>
                <label className="block text-sm font-medium mb-1">Display Title (optional)</label>
                <input type="text" value={title} onChange={e => setTitle(e.target.value)} 
                  className="w-full bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg px-3 py-2 outline-none focus:border-[var(--color-accent)]" />
              </div>
            )}
            
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
              <button type="submit" disabled={!file} className="btn btn-primary shadow-md">Start Upload</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
