import type { SlackAttachmentView } from '../api.types';
import type { SlackNames } from './SlackText';
import { SlackText } from './SlackText';

/** Slack's grey for attachments without a colour. */
const DEFAULT_BAR = '#dddddd';

/**
 * Message attachments drawn as Slack draws them: a coloured bar, then pretext,
 * author, linked title, text, fields in two columns, footer. Link buttons ("Join
 * Google Meet") are links; buttons that call the app only work in Slack and are left out.
 */
export const SlackAttachments = ({
  attachments,
  names,
}: {
  attachments: SlackAttachmentView[];
  names: SlackNames;
}) => (
  <div className="slack-attachments">
    {attachments.map((attachment, index) => (
      <div key={index} className="slack-attachment-group">
        {attachment.pretext && <SlackText text={attachment.pretext} names={names} />}
        <div
          className="slack-attachment"
          style={{ borderLeftColor: attachment.color ?? DEFAULT_BAR }}
        >
          {attachment.author && <div className="slack-attachment__author">{attachment.author}</div>}
          {attachment.title &&
            (attachment.titleLink ? (
              <a
                className="slack-attachment__title"
                href={attachment.titleLink}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                {attachment.title}
              </a>
            ) : (
              // Apps put dates and links in titles too (Google Calendar); Slack formats them.
              <div className="slack-attachment__title">
                <SlackText text={attachment.title} names={names} />
              </div>
            ))}
          {attachment.text && <SlackText text={attachment.text} names={names} />}
          {attachment.fields.length > 0 && (
            <dl className="slack-attachment__fields">
              {attachment.fields.map((field, fieldIndex) => (
                <div key={fieldIndex}>
                  {field.title && <dt>{field.title}</dt>}
                  <dd>
                    <SlackText text={field.value} names={names} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {attachment.footer && <div className="slack-attachment__footer">{attachment.footer}</div>}
          {(attachment.links ?? []).length > 0 && (
            <div className="slack-attachment__links">
              {(attachment.links ?? []).map((link) => (
                <a
                  key={link.url}
                  className="button-link"
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  {link.text}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    ))}
  </div>
);
