import { useState } from 'react';
import type { Connection, Item } from '../api.types';
import { SlackAttachments } from '../slack/SlackAttachments';
import { SlackText } from '../slack/SlackText';
import { EmailFrame } from './EmailFrame';

interface MessageBodyProps {
  item: Item;
  connection: Connection | undefined;
}

/**
 * A message as its source would show it: Slack's markup rendered like Slack,
 * e-mail as a short preview that opens into the real HTML, anything else as text.
 */
export const MessageBody = ({ item, connection }: MessageBodyProps) => {
  const [open, setOpen] = useState(false);

  if (item.rich?.format === 'SlackMrkdwn') {
    const names = {
      users: item.rich.users,
      channels: item.rich.channels,
      groups: item.rich.groups,
    };
    const attachments = item.rich.attachments ?? [];

    return (
      <>
        {item.rich.text && <SlackText text={item.rich.text} names={names} />}
        {attachments.length > 0 && <SlackAttachments attachments={attachments} names={names} />}
      </>
    );
  }

  if (connection?.kind === 'Gmail') {
    return (
      <div onClick={(e) => e.stopPropagation()}>
        {!open && item.body && <p className="thread__body thread__body--preview">{item.body}</p>}
        <button type="button" className="linklike" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide e-mail' : 'Show e-mail'}
        </button>
        {open && <EmailFrame itemId={item.id} openUrl={item.url} />}
      </div>
    );
  }

  return item.body ? <p className="thread__body">{item.body}</p> : null;
};
