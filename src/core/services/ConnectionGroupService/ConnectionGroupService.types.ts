import type { ConnectionGroup } from '@/core/connections/ConnectionGroup.types';

/** Categories connections are shown under; see ConnectionGroup. */
export interface IConnectionGroupService {
  /** Alphabetical. */
  list(): Promise<readonly ConnectionGroup[]>;
  /** The category with this name, made when there is none yet (names match ignoring case). */
  create(name: string): Promise<ConnectionGroup>;
  rename(id: string, name: string): Promise<ConnectionGroup>;
  /** Its connections stay, with no category. */
  remove(id: string): Promise<void>;
}
