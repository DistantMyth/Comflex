import { useState, useEffect } from 'react';
import resolveAsset from '../utils/resolveAsset';

export default function Avatar({ src, alt, name, className, fallbackChar = '?' }) {
  const [error, setError] = useState(false);

  useEffect(() => {
    setError(false);
  }, [src]);

  const resolved = resolveAsset(src);

  if (!resolved || error) {
    const initial = name?.trim().charAt(0)?.toUpperCase() || fallbackChar;
    return (
      <div className={`flex items-center justify-center avatar-gradient text-white font-bold overflow-hidden flex-shrink-0 ${className}`}>
        {initial}
      </div>
    );
  }

  return (
    <img
      src={resolved}
      alt={alt || ''}
      className={`flex-shrink-0 ${className}`}
      onError={() => setError(true)}
      loading="lazy"
    />
  );
}
