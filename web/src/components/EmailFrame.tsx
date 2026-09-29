import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type { RichContent } from '../api.types';

interface EmailFrameProps {
  itemId: string;
  openUrl: string | null;
}

/** Tallest the frame grows before it scrolls inside, so one newsletter cannot swallow the page. */
const MAX_HEIGHT = 1400;

/**
 * The frame's own policy: no scripts (sandbox), nothing fetched from the network
 * unless the user asks for images — remote images are how senders learn you read
 * their mail. Links open in a new tab.
 */
const documentFor = (html: string, loadImages: boolean) => `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src ${loadImages ? 'https: http: data: cid:' : 'data: cid:'}; font-src data:">
<base target="_blank">
<style>
  html, body { margin: 0; background: #fff; color: #1c1d20; }
  body { padding: 12px; font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; overflow-wrap: anywhere; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
</style></head><body>${html}</body></html>`;

const remoteImageCount = (html: string) =>
  (html.match(/<img\b[^>]*\ssrc\s*=\s*["']?https?:/gi) ?? []).length;

export const EmailFrame = ({ itemId, openUrl }: EmailFrameProps) => {
  const [content, setContent] = useState<RichContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadImages, setLoadImages] = useState(false);
  const [height, setHeight] = useState(200);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    void api
      .content(itemId)
      .then(setContent)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [itemId]);

  const srcDoc = useMemo(
    () => (content?.format === 'Html' ? documentFor(content.html, loadImages) : ''),
    [content, loadImages]
  );

  if (error) {
    return <p className="error small">Could not load the e-mail: {error}</p>;
  }

  if (!content) {
    return <p className="muted small">Loading…</p>;
  }

  if (content.format !== 'Html') {
    return <p className="thread__body thread__body--full">{content.text}</p>;
  }

  const blocked = loadImages ? 0 : remoteImageCount(content.html);

  return (
    <div className="email">
      {(blocked > 0 || openUrl) && (
        <div className="email__bar small">
          {blocked > 0 && (
            <>
              <span className="muted">
                {blocked} remote image{blocked === 1 ? '' : 's'} blocked
              </span>
              <button type="button" className="linklike" onClick={() => setLoadImages(true)}>
                Load images
              </button>
            </>
          )}
          <span className="spacer" />
          {openUrl && (
            <a href={openUrl} target="_blank" rel="noreferrer">
              Open in Gmail
            </a>
          )}
        </div>
      )}
      <iframe
        ref={frame}
        title="E-mail"
        className="email__frame"
        // No allow-scripts: nothing in the mail can run. Same-origin only lets
        // Huginn measure the height; without scripts the mail cannot use it.
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        style={{ height }}
        onLoad={() => {
          const doc = frame.current?.contentDocument;

          setHeight(Math.min(doc?.documentElement.scrollHeight ?? 200, MAX_HEIGHT));
        }}
      />
    </div>
  );
};
