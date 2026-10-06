import { describe, expect, test } from 'bun:test';
import { foldForSearch, searchTermsOf, searchTextOf } from './search.utils';

describe('search.utils', () => {
  test('folds case, accents and spacing', () => {
    expect(foldForSearch('Matúš  KAŠUBA\nřekl')).toBe('matus kasuba rekl');
  });

  test('an item is found by its title, author and body', () => {
    expect(
      searchTextOf({ title: 'Deploy blocked', author: 'Igor Čech', body: 'Pipeline\nfailed' })
    ).toBe('deploy blocked igor cech pipeline failed');
  });

  test('a query is its distinct folded words', () => {
    expect(searchTermsOf('  Čech čech  pipeline ')).toEqual(['cech', 'pipeline']);
    expect(searchTermsOf('   ')).toEqual([]);
  });
});
