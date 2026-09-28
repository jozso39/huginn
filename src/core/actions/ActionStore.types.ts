import type { Action, NewAction } from './Action.types';

export interface IActionStore {
  append(action: NewAction): Promise<Action>;
  listForItem(itemId: string): Promise<readonly Action[]>;
}
