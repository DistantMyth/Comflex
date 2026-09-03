import { useState, useEffect } from 'react';
import resolveAsset from '../utils/resolveAsset';

export default function Avatar({ src, alt, name, className = 'w-10 h-10 rounded-full', fallbackChar = '?' }) {
  const [error, setError] = useState(false);

  useEffect(() => {
    setError(false);
  }, [src]);

  const resolved = resolveAsset(src);

  if (!resolved || error) {
    const initial = name?.trim().charAt(0)?.toUpperCase() || fallbackChar;
    return (
      <div
        className={`flex items-center justify-center font-bold overflow-hidden flex-shrink-0 text-white select-none border border-[var(--color-border)] shadow-sm bg-gradient-to-br from-[var(--palette-teal)] to-[var(--palette-plum)] ${className}`}
      >
        {initial}
      </div>
    );
  }

  return (
    <img
      src={resolved}
      alt={alt || name || 'Avatar'}
      className={`flex-shrink-0 object-cover border border-[var(--color-border)] ${className}`}
      onError={() => setError(true)}
      loading="lazy"
    />
  );
}
