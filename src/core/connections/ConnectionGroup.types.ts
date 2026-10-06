/**
 * A category connections are shown under ("Work", "Personal"). The UI says category;
 * the code says group, because Category is the triage verdict (Important/Spam/…).
 * It exists on its own, so it is offered for new connections even while unused.
 */
export interface ConnectionGroup {
  readonly id: string;
  readonly name: string;
  readonly createdAt: Date;
}

export interface IConnectionGroupStore {
  /** Alphabetical. */
  list(): Promise<readonly ConnectionGroup[]>;
  get(id: string): Promise<ConnectionGroup | null>;
  create(name: string): Promise<ConnectionGroup>;
  rename(id: string, name: string): Promise<ConnectionGroup | null>;
  /** Its connections stay, with no category. */
  remove(id: string): Promise<void>;
}
