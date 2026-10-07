/**
 * Anchor props for "open this item where it came from". A web page opens in a new
 * tab; an app link (slack://) hands over to the installed app and must not leave an
 * empty tab behind.
 */
export const openLinkProps = (href: string) =>
  /^https?:/.test(href) ? { href, target: '_blank', rel: 'noreferrer' } : { href };

/** Where an item opens: its app when it has an app link, else its web page. */
export const itemLink = (item: { appUrl: string | null; url: string | null }): string | null =>
  item.appUrl ?? item.url;

/** The Mac app's window rather than a browser tab: the server marks it at launch. */
export const inMacApp = (): boolean => document.cookie.split('; ').includes('huginn_app=1');

const OUTSIDE = new Set(['http:', 'https:', 'mailto:']);

const parse = (href: string, base: string): URL | null => {
  try {
    return new URL(href, base);
  } catch {
    return null;
  }
};

/**
 * In the Mac app a link that opens a new window — `target="_blank"`, or any link in an
 * e-mail — goes nowhere: WebKit does not hand new windows to the shell. A navigation of
 * the window itself does reach it, and the shell opens the page in the browser (or the
 * app it belongs to) while Huginn stays put. So in the app, clicks on links that lead
 * outside become that. `doc` is the page, or an e-mail's frame.
 */
export const routeLinksOutside = (doc: Document): void => {
  doc.addEventListener(
    'click',
    (event) => {
      const target = event.target as { closest?: (selector: string) => Element | null } | null;
      const href = target?.closest?.('a[href]')?.getAttribute('href');
      const url = href ? parse(href, doc.baseURI) : null;

      if (!url || url.origin === window.location.origin || !OUTSIDE.has(url.protocol)) {
        return;
      }

      event.preventDefault();
      window.location.assign(url.href);
    },
    // Before React's handlers, which may stop the click (a card's icon does).
    true
  );
};
