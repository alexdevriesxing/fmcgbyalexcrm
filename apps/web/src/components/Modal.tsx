import { useEffect, type PropsWithChildren, type ReactNode } from 'react';

export function Modal({
  eyebrow,
  title,
  description,
  onClose,
  children,
  footer,
  width = 'standard'
}: PropsWithChildren<{
  eyebrow: string;
  title: string;
  description?: string;
  onClose: () => void;
  footer?: ReactNode;
  width?: 'standard' | 'wide';
}>) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div className="dialog-backdrop operational-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`operational-dialog ${width === 'wide' ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="operational-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h2 id="operational-dialog-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="dialog-close" type="button" aria-label="Close dialog" onClick={onClose}>×</button>
        </header>
        <div className="operational-dialog-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </section>
    </div>
  );
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon" aria-hidden="true">◇</span>
      <strong>{title}</strong>
      <p>{detail}</p>
      {action}
    </div>
  );
}

export function InlineLoading({ label = 'Loading live data' }: { label?: string }) {
  return <div className="inline-loading" aria-live="polite"><span className="loading-spinner" aria-hidden="true" />{label}</div>;
}
