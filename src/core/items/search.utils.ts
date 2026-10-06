/** Lower case, no diacritics, single spaces: "Matúš  KAŠUBA" → "matus kasuba". */
export const foldForSearch = (text: string): string =>
  text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** What an item is found by: its title, author and body, folded. */
export const searchTextOf = (item: {
  readonly title: string;
  readonly author: string;
  readonly body: string;
}): string => foldForSearch(`${item.title}\n${item.author}\n${item.body}`);

/** The words of a query; an item matches when its text contains every one. */
export const searchTermsOf = (query: string): readonly string[] => [
  ...new Set(
    foldForSearch(query)
      .split(' ')
      .filter((term) => term !== '')
  ),
];
