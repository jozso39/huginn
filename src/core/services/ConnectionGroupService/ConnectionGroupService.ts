import type { Logger } from '@/lib/logger';
import type {
  ConnectionGroup,
  IConnectionGroupStore,
} from '@/core/connections/ConnectionGroup.types';
import { ErrorCode, HuginnError } from '@/core/errors/errors';
import type { IConnectionGroupService } from './ConnectionGroupService.types';

const MAX_NAME_LENGTH = 40;

export class ConnectionGroupService implements IConnectionGroupService {
  constructor(
    private readonly logger: Logger,
    private readonly groups: IConnectionGroupStore
  ) {}

  public list(): Promise<readonly ConnectionGroup[]> {
    return this.groups.list();
  }

  public async create(name: string): Promise<ConnectionGroup> {
    const clean = ConnectionGroupService.cleanName(name);
    const existing = await this.named(clean);

    if (existing) {
      return existing;
    }

    const group = await this.groups.create(clean);

    this.logger.info({ groupId: group.id }, 'category created');

    return group;
  }

  public async rename(id: string, name: string): Promise<ConnectionGroup> {
    const clean = ConnectionGroupService.cleanName(name);
    const other = await this.named(clean);

    if (other && other.id !== id) {
      throw new HuginnError(ErrorCode.Validation, `There is already a category “${other.name}”`);
    }

    const renamed = await this.groups.rename(id, clean);

    if (!renamed) {
      throw new HuginnError(ErrorCode.NotFound, 'category not found');
    }

    return renamed;
  }

  public async remove(id: string): Promise<void> {
    if (!(await this.groups.get(id))) {
      throw new HuginnError(ErrorCode.NotFound, 'category not found');
    }

    await this.groups.remove(id);
    this.logger.info({ groupId: id }, 'category deleted');
  }

  /** "work" and "Work" are one category. */
  private async named(name: string): Promise<ConnectionGroup | null> {
    const key = name.toLocaleLowerCase();

    return (await this.groups.list()).find((g) => g.name.toLocaleLowerCase() === key) ?? null;
  }

  private static cleanName(name: string): string {
    const clean = name.trim().replace(/\s+/g, ' ');

    if (clean === '') {
      throw new HuginnError(ErrorCode.Validation, 'A category needs a name');
    }

    if (clean.length > MAX_NAME_LENGTH) {
      throw new HuginnError(
        ErrorCode.Validation,
        `Keep category names under ${MAX_NAME_LENGTH} characters`
      );
    }

    return clean;
  }
}
