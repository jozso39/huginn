import type { ReactNode } from 'react';

interface SetupGuideProps {
  title: string;
  /** Folded, for a connection that already works (shown when you need a new token). */
  folded?: boolean;
  children: ReactNode;
}

/** How to get what a connection needs, step by step, in a frame of its own. */
export const SetupGuide = ({ title, folded = false, children }: SetupGuideProps) =>
  folded ? (
    <details className="setup-guide">
      <summary className="setup-guide__title">{title}</summary>
      <div className="setup-guide__body">{children}</div>
    </details>
  ) : (
    <section className="setup-guide">
      <h4 className="setup-guide__title">{title}</h4>
      <div className="setup-guide__body">{children}</div>
    </section>
  );
