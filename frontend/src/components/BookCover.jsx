import { useState } from 'react';

// Cloth-bound colours for books without a cover image.
const PALETTE = ['#24493f', '#7a3b2e', '#2d4f6c', '#5b4a7a', '#8a6420', '#3e5b39', '#6b2f46', '#33525a', '#704c2f', '#2f3f63'];

export default function BookCover({ book, large = false, thumb = false }) {
  const [failed, setFailed] = useState(false);
  const color = PALETTE[(book.id || 0) % PALETTE.length];
  const showImage = book.coverUrl && !failed;
  return (
    <div className={`cover ${large ? 'lg' : ''} ${thumb ? 'thumb' : ''}`} style={{ background: color }}>
      {showImage ? (
        <img src={book.coverUrl} alt={`Cover of ${book.title}`} loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <div className="cover-gen" aria-label={`Cover of ${book.title}`}>
          <div>
            <div className="ct">{book.title.length > 60 ? `${book.title.slice(0, 57)}…` : book.title}</div>
            <div className="rule" />
          </div>
          <div className="ca">{book.author.split(',')[0]}</div>
        </div>
      )}
    </div>
  );
}
