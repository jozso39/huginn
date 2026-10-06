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
