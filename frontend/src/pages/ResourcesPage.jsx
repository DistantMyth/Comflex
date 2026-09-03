import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Folder, FolderOpen, FileText, Upload, Plus, Download, Trash2,
  Search, ArrowRight, ChevronRight, X, Loader2, BookOpen, Clock, HardDrive, CheckCircle2
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { resourceApi } from '../api/resourceApi';

const getDynamicFolderTree = (user, myYear) => {
  const tree = {
    'Academics': {},
    'Technical': 'SUBJECTS',
  };

  const isAdminId = user?.globalRing === 0;
  const startYear = isAdminId ? myYear - 2 : myYear;
  const count = isAdminId ? 6 : 2;

  for (let i = 0; i < count; i++) {
    const year = startYear + i;
    if (!isAdminId && year === myYear + 1) {
      tree['Academics'][`Batch ${year}`] = {
        'Notes': {
          'Last Year': 'SUBJECTS',
        },
        'Past Year Paper': 'SUBJECTS',
      };
    } else {
      tree['Academics'][`Batch ${year}`] = {
        'Notes': {
          'This Year': 'SUBJECTS',
          'Last Year': 'SUBJECTS',
        },
        'Past Year Paper': 'SUBJECTS',
      };
    }
  }

  return tree;
};

export default function ResourcesPage() {
  const { user } = useAuth();

  const [path, setPath] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('newest');

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showSubjectModal, setShowSubjectModal] = useState(false);

  // Upload Form State
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // Subject Form State
  const [subjectName, setSubjectName] = useState('');
  const [creatingSubject, setCreatingSubject] = useState(false);
  const [subjectError, setSubjectError] = useState('');

  const isAdminOrManager = user?.globalRing === 0 || user?.canManageResources;

  let myYear = 29;
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
    return path[1]?.name;
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
        yearGroup: getCurrentYearGroup(),
      });
      setSubjects(res.data?.data || []);
    } catch (err) {
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
      setResources(res.data?.data || []);
    } catch (err) {
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
    setSearchQuery('');
    if (index === -1) setPath([]);
    else setPath(path.slice(0, index + 1));
  };

  const handleFolderClick = (name, type = 'folder', id = null) => {
    setSearchQuery('');
    setPath([...path, { name, type, id }]);
  };

  const handleDeleteSubject = async (e, id) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this subject and all its files?')) return;
    try {
      await resourceApi.deleteSubject(id);
      fetchSubjects();
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to delete');
    }
  };

  const handleDeleteResource = async (id) => {
    if (!confirm('Are you sure you want to delete this file?')) return;
    try {
      await resourceApi.deleteResource(id);
      fetchResources();
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to delete');
    }
  };

  const handleDownloadResource = async (resObj, preview = false) => {
    try {
      setDownloadingId(resObj.id);
      const res = await resourceApi.downloadResource(resObj.id);
      const blob = new Blob([res.data], { type: resObj.mimetype || 'application/octet-stream' });
      const url = window.URL.createObjectURL(blob);
      if (preview) {
        window.open(url, '_blank');
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.download = resObj.fileName || resObj.title || 'download';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
      setTimeout(() => window.URL.revokeObjectURL(url), 15000);
    } catch (err) {
      alert(err.response?.data?.error?.message || err.message || 'Failed to download file.');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleFileUpload = async (e) => {
    e.preventDefault();
    if (!uploadFile || !uploadTitle.trim()) return;
    if (uploadFile.size > 75 * 1024 * 1024) {
      setUploadError('File exceeds 75MB limit.');
      return;
    }

    const subj = getCurrentSubject();
    if (!subj) return;

    setUploading(true);
    setUploadError('');
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('title', uploadTitle.trim());
    formData.append('subjectId', subj.id);
    formData.append('file', uploadFile);

    try {
      await resourceApi.uploadResource(formData, (progressEvent) => {
        const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        setUploadProgress(percent);
      });
      setShowUploadModal(false);
      setUploadTitle('');
      setUploadFile(null);
      fetchResources();
    } catch (err) {
      setUploadError(err.response?.data?.error?.message || 'Failed to upload resource.');
    } finally {
      setUploading(false);
    }
  };

  const handleCreateSubject = async (e) => {
    e.preventDefault();
    if (!subjectName.trim()) return;

    setCreatingSubject(true);
    setSubjectError('');
    try {
      await resourceApi.createSubject({
        name: subjectName.trim(),
        category: getCurrentCategory(),
        subCategory: getCurrentSubCategory(),
        yearGroup: getCurrentYearGroup(),
      });
      setShowSubjectModal(false);
      setSubjectName('');
      fetchSubjects();
    } catch (err) {
      setSubjectError(err.response?.data?.error?.message || 'Failed to create subject.');
    } finally {
      setCreatingSubject(false);
    }
  };

  const filteredSubjects = subjects.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredResources = resources
    .filter(r =>
      r.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.fileName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.uploader?.displayName && r.uploader.displayName.toLowerCase().includes(searchQuery.toLowerCase()))
    )
    .sort((a, b) => {
      if (sortBy === 'newest') return new Date(b.createdAt) - new Date(a.createdAt);
      if (sortBy === 'oldest') return new Date(a.createdAt) - new Date(b.createdAt);
      if (sortBy === 'name') return a.title.localeCompare(b.title);
      if (sortBy === 'size') return (b.fileSize || 0) - (a.fileSize || 0);
      return 0;
    });

  return (
    <div className="max-w-5xl mx-auto pb-12">
      {/* Header & Breadcrumb Nav */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold font-display text-[var(--color-text-primary)]">
            Academic Resources
          </h1>
          {/* Breadcrumb pills */}
          <div className="flex items-center gap-1.5 mt-2 text-xs overflow-x-auto pb-1">
            <button
              onClick={() => navigateTo(-1)}
              className={`px-2.5 py-1 rounded-xl transition-colors ${
                path.length === 0
                  ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] font-bold'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              Home
            </button>
            {path.map((p, i) => (
              <div key={i} className="flex items-center gap-1.5 flex-shrink-0">
                <ChevronRight size={12} className="text-[var(--color-text-muted)]" />
                <button
                  onClick={() => navigateTo(i)}
                  className={`px-2.5 py-1 rounded-xl transition-colors ${
                    i === path.length - 1
                      ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] font-bold'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  {p.name}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {currentLevel === 'SUBJECTS' && isAdminOrManager && (
            <button onClick={() => setShowSubjectModal(true)} className="btn btn-secondary text-xs py-2 px-3.5 flex items-center gap-1.5">
              <Plus size={14} />
              <span>Add Subject</span>
            </button>
          )}
          {currentLevel === 'FILES' && (
            <button onClick={() => setShowUploadModal(true)} className="btn btn-primary text-xs py-2 px-4 shadow-md flex items-center gap-1.5">
              <Upload size={14} />
              <span>Upload Notes</span>
            </button>
          )}
        </div>
      </div>

      {/* Directory Content Area */}
      {currentLevel === 'SUBJECTS' && (
        <div className="space-y-4">
          <div className="relative max-w-sm">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              type="text"
              placeholder="Search subjects..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="matte-input pl-10 text-xs py-2"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {filteredSubjects.length === 0 && !loading && (
              <div className="glass-card p-10 text-center col-span-3 border border-[var(--color-border)]">
                <Folder size={32} className="mx-auto text-[var(--color-text-muted)] mb-2 opacity-50" />
                <p className="text-xs text-[var(--color-text-muted)]">
                  {searchQuery ? 'No matching subjects found.' : 'No subjects registered in this folder.'}
                </p>
              </div>
            )}
            {loading && (
              <div className="col-span-3 py-10 flex items-center justify-center gap-2 text-xs text-[var(--color-text-muted)]">
                <Loader2 size={16} className="animate-spin text-[var(--color-accent)]" />
                <span>Loading subjects...</span>
              </div>
            )}
            {!loading && filteredSubjects.map(subj => (
              <div
                key={subj.id}
                onClick={() => handleFolderClick(subj.name, 'subject', subj.id)}
                className="glass-card p-4 flex items-center justify-between cursor-pointer hover-lift border border-[var(--color-border)] group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-2xl bg-[var(--palette-teal)]/15 text-[var(--palette-teal)] flex items-center justify-center flex-shrink-0">
                    <Folder size={18} />
                  </div>
                  <span className="font-bold text-xs text-[var(--color-text-primary)] truncate">{subj.name}</span>
                </div>
                {isAdminOrManager && (
                  <button
                    onClick={(e) => handleDeleteSubject(e, subj.id)}
                    className="p-1.5 rounded-lg text-[var(--color-danger)] opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[var(--color-danger)]/10"
                    title="Delete subject"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {typeof currentLevel === 'object' && currentLevel !== 'SUBJECTS' && currentLevel !== 'FILES' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {Object.keys(currentLevel).map((k) => {
            const isJuniorBadge = !isAdminOrManager && k === `Batch ${myYear + 1}`;
            return (
              <div
                key={k}
                onClick={() => handleFolderClick(k)}
                className="glass-card p-5 flex items-center gap-4 cursor-pointer hover-lift border border-[var(--color-border)] group"
              >
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[var(--palette-teal)] to-[var(--palette-plum)] flex items-center justify-center text-white shadow-sm flex-shrink-0">
                  <FolderOpen size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-[var(--color-text-primary)] truncate">{k}</span>
                    {isJuniorBadge && (
                      <span className="text-[9px] uppercase font-bold tracking-wider text-[var(--palette-teal)] px-2 py-0.5 rounded-full bg-[var(--palette-teal)]/15 border border-[var(--palette-teal)]/30">
                        Junior
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">Click to explore subjects</p>
                </div>
                <ChevronRight size={16} className="text-[var(--color-text-muted)] group-hover:translate-x-0.5 transition-transform" />
              </div>
            );
          })}
        </div>
      )}

      {currentLevel === 'FILES' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="relative w-full sm:w-72">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input
                type="text"
                placeholder="Search notes or uploaders..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="matte-input pl-9 text-xs py-1.5"
              />
            </div>
            <div className="flex items-center gap-2 self-end sm:self-auto">
              <span className="text-[11px] text-[var(--color-text-muted)] font-medium">Sort:</span>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                className="matte-input text-xs py-1 px-2.5"
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="name">Name (A-Z)</option>
                <option value="size">Size (Largest)</option>
              </select>
            </div>
          </div>

          <div className="space-y-2.5">
            {loading && (
              <div className="py-10 text-center flex items-center justify-center gap-2 text-xs text-[var(--color-text-muted)]">
                <Loader2 size={16} className="animate-spin text-[var(--color-accent)]" />
                <span>Fetching notes...</span>
              </div>
            )}
            {!loading && filteredResources.length === 0 && (
              <div className="glass-card p-10 text-center border border-[var(--color-border)]">
                <FileText size={32} className="mx-auto text-[var(--color-text-muted)] mb-2 opacity-50" />
                <p className="text-xs text-[var(--color-text-muted)]">
                  {searchQuery ? 'No matching notes found.' : 'This folder has no files yet. Upload notes to share with peers!'}
                </p>
              </div>
            )}
            {!loading && filteredResources.map((res) => {
              const canDelete = user?.id === res.uploaderId || isAdminOrManager;
              const mbSize = (res.fileSize / (1024 * 1024)).toFixed(1);
              const isDownloading = downloadingId === res.id;
              return (
                <div
                  key={res.id}
                  className="glass-card p-3.5 px-4 flex items-center gap-3.5 border border-[var(--color-border)] hover-lift"
                >
                  <div className="w-10 h-10 rounded-2xl bg-[var(--palette-teal)]/15 text-[var(--palette-teal)] flex items-center justify-center flex-shrink-0">
                    <FileText size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <button
                      onClick={() => handleDownloadResource(res, true)}
                      className="font-bold text-xs sm:text-sm text-left text-[var(--color-text-primary)] hover:text-[var(--color-accent)] hover:underline block truncate"
                    >
                      {res.title}
                    </button>
                    <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                      {mbSize} MB • Uploaded by {res.uploader?.displayName || 'Peer'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleDownloadResource(res, false)}
                      disabled={isDownloading}
                      className="btn btn-secondary text-xs py-1.5 px-3 flex items-center gap-1"
                    >
                      {isDownloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                      <span>{isDownloading ? 'Fetching...' : 'Download'}</span>
                    </button>
                    {canDelete && (
                      <button
                        onClick={() => handleDeleteResource(res.id)}
                        className="btn btn-secondary text-xs py-1.5 px-2.5 text-[var(--color-danger)]"
                        title="Delete resource"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Upload File Modal */}
      <AnimatePresence>
        {showUploadModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="glass-card p-6 rounded-3xl max-w-md w-full border border-[var(--color-border)] shadow-2xl"
            >
              <div className="flex items-center justify-between pb-3 border-b border-[var(--color-border)] mb-4">
                <div className="flex items-center gap-2 text-[var(--color-accent)]">
                  <Upload size={18} />
                  <h3 className="font-bold font-display text-sm text-[var(--color-text-primary)]">Upload Resource File</h3>
                </div>
                <button onClick={() => setShowUploadModal(false)} className="p-1 hover:opacity-75">
                  <X size={16} />
                </button>
              </div>

              {uploadError && (
                <div className="p-3 rounded-2xl bg-[var(--color-danger)]/15 text-[var(--color-danger)] text-xs font-semibold mb-3">
                  {uploadError}
                </div>
              )}

              <form onSubmit={handleFileUpload} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1.5">
                    File Title
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Unit 3 Operating Systems Notes"
                    value={uploadTitle}
                    onChange={(e) => setUploadTitle(e.target.value)}
                    className="matte-input text-xs"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1.5">
                    Select File (Max 75MB)
                  </label>
                  <input
                    type="file"
                    onChange={(e) => setUploadFile(e.target.files[0])}
                    className="matte-input text-xs"
                    required
                  />
                </div>

                {uploading && (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex justify-between text-xs font-bold text-[var(--color-text-primary)]">
                      <span>Uploading...</span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <div className="w-full bg-[var(--color-bg-secondary)] rounded-full h-2 overflow-hidden border border-[var(--color-border)]">
                      <div
                        className="bg-gradient-to-r from-[var(--color-accent)] to-[#528976] h-full transition-all duration-150"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <button type="submit" disabled={uploading} className="btn btn-primary flex-1 py-2.5 text-xs shadow-md">
                    {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    <span>{uploading ? 'Streaming File...' : 'Upload Notes'}</span>
                  </button>
                  <button type="button" onClick={() => setShowUploadModal(false)} className="btn btn-secondary text-xs px-3">
                    Cancel
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Subject Modal */}
      <AnimatePresence>
        {showSubjectModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="glass-card p-6 rounded-3xl max-w-md w-full border border-[var(--color-border)] shadow-2xl"
            >
              <div className="flex items-center justify-between pb-3 border-b border-[var(--color-border)] mb-4">
                <div className="flex items-center gap-2 text-[var(--color-accent)]">
                  <Plus size={18} />
                  <h3 className="font-bold font-display text-sm text-[var(--color-text-primary)]">Add Subject</h3>
                </div>
                <button onClick={() => setShowSubjectModal(false)} className="p-1 hover:opacity-75">
                  <X size={16} />
                </button>
              </div>

              {subjectError && (
                <div className="p-3 rounded-2xl bg-[var(--color-danger)]/15 text-[var(--color-danger)] text-xs font-semibold mb-3">
                  {subjectError}
                </div>
              )}

              <form onSubmit={handleCreateSubject} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1.5">
                    Subject Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Database Management Systems"
                    value={subjectName}
                    onChange={(e) => setSubjectName(e.target.value)}
                    className="matte-input text-xs"
                    required
                    autoFocus
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button type="submit" disabled={creatingSubject} className="btn btn-primary flex-1 py-2.5 text-xs shadow-md">
                    {creatingSubject ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                    <span>{creatingSubject ? 'Creating...' : 'Create Subject'}</span>
                  </button>
                  <button type="button" onClick={() => setShowSubjectModal(false)} className="btn btn-secondary text-xs px-3">
                    Cancel
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
