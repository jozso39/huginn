import type { KeyboardEvent } from 'react';
import { useEffect, useRef } from 'react';

export interface MenuAction {
  label: string;
  /** The key that does the same, shown on the right. */
  shortcut?: string;
  onSelect: () => void;
}

/** A line of the menu: an action, a row of quick reactions, or a separator. */
export type MenuLine =
  MenuAction | { reactions: string[]; onReact: (emoji: string) => void } | 'separator';

interface ContextMenuProps {
  x: number;
  y: number;
  lines: MenuLine[];
  onClose: () => void;
}

const EDGE = 8;

/**
 * Where the system menu stays: in text fields, on links, and over selected text, where
 * it has Copy, Paste and Open Link. Everywhere else in the Mac app it would only offer
 * Back and Reload, which leave Huginn's page.
 */
export const wantsNativeMenu = (target: EventTarget | null): boolean => {
  // Not `instanceof Element`: an e-mail's frame has its own Element.
  const element =
    target !== null && typeof (target as Partial<Element>).closest === 'function'
      ? (target as Element)
      : null;
  const selection = element?.ownerDocument.getSelection()?.toString() ?? '';

  return (
    selection.trim() !== '' ||
    (element?.closest('input, textarea, select, [contenteditable], a[href]') ?? null) !== null
  );
};

/** Keeps the system menu out of a page (the app's, or an e-mail's frame), except where it helps. */
export const quietNativeMenu = (doc: Document): void => {
  doc.addEventListener('contextmenu', (event) => {
    if (!wantsNativeMenu(event.target)) {
      event.preventDefault();
    }
  });
};

const items = (menu: HTMLElement | null): HTMLButtonElement[] => [
  ...(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
];

/**
 * Huginn's own right-click menu: the actions of what was clicked, with their keys.
 * ↑ ↓ move, ↵ chooses, Esc or a click elsewhere closes it.
 */
export const ContextMenu = ({ x, y, lines, onClose }: ContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const menu = menuRef.current;

    // Inside the window, even near its right or bottom edge.
    if (menu) {
      const { width, height } = menu.getBoundingClientRect();

      menu.style.setProperty('left', `${Math.max(EDGE, Math.min(x, innerWidth - width - EDGE))}px`);
      menu.style.setProperty(
        'top',
        `${Math.max(EDGE, Math.min(y, innerHeight - height - EDGE))}px`
      );
      items(menu)[0]?.focus();
    }

    const outside = (event: Event) => {
      if (!(event.target instanceof Node && menu?.contains(event.target))) {
        onClose();
      }
    };

    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);

    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [x, y, onClose]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const all = items(menuRef.current);
    const at = all.findIndex((item) => item === document.activeElement);

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      all[(at + (event.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus();
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
      // A shortcut letter (D, R, …) does its job on the message; the menu gets out of the way.
      onClose();
    }
  };

  const choose = (action: () => void) => {
    onClose();
    action();
  };

  return (
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      style={{ left: x, top: y }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {lines.map((line, index) => {
        if (line === 'separator') {
          return <div key={index} className="context-menu__separator" role="separator" />;
        }

        if ('reactions' in line) {
          return (
            <div key={index} className="context-menu__reactions" role="group" aria-label="React">
              {line.reactions.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  role="menuitem"
                  className="context-menu__emoji"
                  aria-label={`React with ${emoji}`}
                  onClick={() => choose(() => line.onReact(emoji))}
                >
                  {emoji}
                </button>
              ))}
            </div>
          );
        }

        return (
          <button
            key={index}
            type="button"
            role="menuitem"
            className="context-menu__item"
            onClick={() => choose(line.onSelect)}
          >
            <span>{line.label}</span>
            {line.shortcut && <kbd>{line.shortcut}</kbd>}
          </button>
        );
      })}
    </div>
  );
};
