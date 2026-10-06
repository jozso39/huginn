import { useEffect, useRef, useState } from 'react';
import type {
  Connection,
  ConnectionGroup,
  ConnectorDescriptor,
  Settings,
  Theme,
} from '../api.types';
import { applyTheme } from '../theme';
import { CategoriesManager } from './CategoriesManager';
import { ConnectionsView } from './ConnectionsView';
import { ReactionsPicker } from './ReactionsPicker';

interface SettingsViewProps {
  connections: Connection[];
  kinds: ConnectorDescriptor[];
  groups: ConnectionGroup[];
  settings: Settings | null;
  /** Set (to when it was asked) by #settings/categories: open the list and show it. */
  categoriesRequest: number | null;
  onChanged: () => Promise<void>;
  onCreateGroup: (name: string) => Promise<ConnectionGroup>;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
}

const THEMES: { id: Theme; label: string; hint: string }[] = [
  { id: 'System', label: 'System', hint: 'Follows macOS' },
  { id: 'Light', label: 'Light', hint: 'Always light' },
  { id: 'Dark', label: 'Dark', hint: 'Always dark' },
];

/** Connections, their categories, quick reactions and the theme. */
export const SettingsView = ({
  connections,
  kinds,
  groups,
  settings,
  categoriesRequest,
  onChanged,
  onCreateGroup,
  saveSettings,
}: SettingsViewProps) => {
  const [themeError, setThemeError] = useState<string | null>(null);
  const categoriesRef = useRef<HTMLDetailsElement>(null);

  // Arriving from "Manage categories" in a picker: open the list and bring it into view.
  // The address goes back to #settings so the next click is a new request again.
  useEffect(() => {
    if (categoriesRequest === null) {
      return;
    }

    categoriesRef.current?.setAttribute('open', '');
    categoriesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.history.replaceState(null, '', '#settings');
  }, [categoriesRequest]);

  const chooseTheme = (theme: Theme) => {
    applyTheme(theme);
    setThemeError(null);
    saveSettings({ theme }).catch((e: unknown) =>
      setThemeError(e instanceof Error ? e.message : String(e))
    );
  };

  return (
    <div className="settings">
      <section className="settings__section">
        <h2>Connections</h2>
        <ConnectionsView
          connections={connections}
          kinds={kinds}
          groups={groups}
          onChanged={onChanged}
          onCreateGroup={onCreateGroup}
        />
      </section>

      {/* Closed by default; left uncontrolled so React never fights the user's toggle. */}
      <details ref={categoriesRef} className="settings__section settings__fold">
        <summary>
          <h2>Categories</h2>
          <span className="muted">{groups.length}</span>
        </summary>
        <CategoriesManager groups={groups} connections={connections} onChanged={onChanged} />
      </details>

      <section className="settings__section">
        <h2>Quick reactions</h2>
        {settings && (
          <ReactionsPicker
            selected={settings.quickReactions}
            onChange={(quickReactions) => saveSettings({ quickReactions })}
          />
        )}
      </section>

      <section className="settings__section">
        <h2>Appearance</h2>
        <div className="segmented" role="radiogroup" aria-label="Theme">
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              type="button"
              role="radio"
              aria-checked={settings?.theme === theme.id}
              className={settings?.theme === theme.id ? 'segmented__on' : undefined}
              title={theme.hint}
              onClick={() => chooseTheme(theme.id)}
            >
              {theme.label}
            </button>
          ))}
        </div>
        {themeError && <p className="error">{themeError}</p>}
      </section>
    </div>
  );
};
