import type { SlackAttachmentView } from '../api.types';
import type { SlackNames } from './SlackText';
import { SlackText } from './SlackText';

/** Slack's grey for attachments without a colour. */
const DEFAULT_BAR = '#dddddd';

/**
 * Message attachments drawn as Slack draws them: a coloured bar, then pretext,
 * author, linked title, text, fields in two columns, footer. Buttons are left out —
 * Huginn cannot press them for the app; the item's icon opens the message in Slack.
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
              <div className="slack-attachment__title">{attachment.title}</div>
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
        </div>
      </div>
    ))}
  </div>
);
