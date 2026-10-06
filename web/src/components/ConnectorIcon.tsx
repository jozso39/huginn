import type { ConnectorKind } from '../api.types';
import { CONNECTOR_META } from '../connectorMeta';
import { openLinkProps } from '../openLink';

interface ConnectorIconProps {
  kind: ConnectorKind;
  small?: boolean;
  /** When set, the icon is a link to the item in its own app. */
  href?: string | null;
}

/** The source's logo on a light tile; sources without a logo fall back to a coloured glyph. */
export const ConnectorIcon = ({ kind, small = false, href }: ConnectorIconProps) => {
  const meta = CONNECTOR_META[kind];
  const className = `badge${small ? ' badge--small' : ''}${meta.logo ? ' badge--logo' : ''}`;
  const style = meta.logo ? undefined : { background: meta.color };
  const content = meta.logo ? (
    <img src={meta.logo} alt={meta.label} draggable={false} />
  ) : (
    meta.glyph
  );

  return href ? (
    <a
      className={className}
      style={style}
      {...openLinkProps(href)}
      title={`Open in ${meta.label}`}
      onClick={(e) => e.stopPropagation()}
    >
      {content}
    </a>
  ) : (
    <span className={className} style={style} title={meta.label}>
      {content}
    </span>
  );
};
