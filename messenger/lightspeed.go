package main

import (
	"strconv"
	"strings"

	"go.mau.fi/mautrix-meta/pkg/messagix/table"
)

// lsMessage is one message of a Lightspeed table (Messenger's unencrypted sync) with
// whatever was attached to it.
type lsMessage struct {
	*table.LSInsertMessage
	upsert      bool
	blobs       []*table.LSInsertBlobAttachment
	attachments []*table.LSInsertAttachment
	xmas        []*table.LSInsertXmaAttachment
	stickers    []*table.LSInsertStickerAttachment
}

// collectMessages gathers a table's messages and attachments. Upserts come from syncs of a
// thread's history, inserts from live traffic.
func collectMessages(tbl *table.LSTable) []*lsMessage {
	byID := make(map[string]*lsMessage, len(tbl.LSUpsertMessage)+len(tbl.LSInsertMessage))
	messages := make([]*lsMessage, 0, len(byID))
	add := func(msg *table.LSInsertMessage, upsert bool) {
		if _, seen := byID[msg.MessageId]; seen || msg.MessageId == "" {
			return
		}
		wrapped := &lsMessage{LSInsertMessage: msg, upsert: upsert}
		byID[msg.MessageId] = wrapped
		messages = append(messages, wrapped)
	}
	for _, msg := range tbl.LSUpsertMessage {
		add(msg.ToInsert(), true)
	}
	for _, msg := range tbl.LSInsertMessage {
		add(msg, false)
	}
	for _, blob := range tbl.LSInsertBlobAttachment {
		if msg, ok := byID[blob.MessageId]; ok {
			msg.blobs = append(msg.blobs, blob)
		}
	}
	for _, att := range tbl.LSInsertAttachment {
		if msg, ok := byID[att.MessageId]; ok {
			msg.attachments = append(msg.attachments, att)
		}
	}
	for _, xma := range tbl.LSInsertXmaAttachment {
		if msg, ok := byID[xma.MessageId]; ok {
			msg.xmas = append(msg.xmas, xma)
		}
	}
	for _, sticker := range tbl.LSInsertStickerAttachment {
		if msg, ok := byID[sticker.MessageId]; ok {
			msg.stickers = append(msg.stickers, sticker)
		}
	}
	return messages
}

func attachmentLabel(kind table.AttachmentType, filename string) string {
	switch kind {
	case table.AttachmentTypeImage, table.AttachmentTypeEphemeralImage:
		return "[photo]"
	case table.AttachmentTypeAnimatedImage:
		return "[GIF]"
	case table.AttachmentTypeVideo, table.AttachmentTypeEphemeralVideo:
		return "[video]"
	case table.AttachmentTypeAudio, table.AttachmentTypeSoundBite:
		return "[voice message]"
	case table.AttachmentTypeSticker, table.AttachmentTypeSelfieSticker, table.AttachmentTypeThirdPartySticker:
		return "[sticker]"
	case table.AttachmentTypeFile:
		if filename != "" {
			return "[" + filename + "]"
		}
		return "[file]"
	default:
		return "[attachment]"
	}
}

// lsText is what the message says, attachments as short labels after the text.
func lsText(msg *lsMessage) string {
	labels := make([]string, 0, len(msg.blobs)+len(msg.attachments)+len(msg.xmas)+1)
	for _, blob := range msg.blobs {
		labels = append(labels, attachmentLabel(blob.AttachmentType, blob.Filename))
	}
	for _, att := range msg.attachments {
		labels = append(labels, attachmentLabel(att.AttachmentType, att.Filename))
	}
	for _, xma := range msg.xmas {
		if xma.TitleText != "" {
			labels = append(labels, "["+xma.TitleText+"]")
		} else {
			labels = append(labels, "[link]")
		}
	}
	if len(msg.stickers) > 0 || (msg.StickerId != 0 && len(labels) == 0) {
		labels = append(labels, "[sticker]")
	}
	text := strings.TrimSpace(msg.Text)
	switch {
	case len(labels) == 0:
		return text
	case text == "":
		return strings.Join(labels, " ")
	default:
		return text + "\n" + strings.Join(labels, " ")
	}
}

// pendingMessage is a message to send on, before its sender's name is known.
type pendingMessage struct {
	event    messageEvent
	senderID int64
}

func threadURL(id string, encrypted bool) string {
	if encrypted {
		return "https://www.facebook.com/messages/e2ee/t/" + id
	}
	return "https://www.facebook.com/messages/t/" + id
}

func optional(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// lsMessages picks a table's messages worth handing on. The initial sync sends only what
// is still unread; live tables send every new message, the owner's own ones too, so the
// server can close what was answered elsewhere. Call after d.learn(tbl).
func (d *directory) lsMessages(tbl *table.LSTable, initial bool) []pendingMessage {
	d.mu.Lock()
	defer d.mu.Unlock()

	var out []pendingMessage
	for _, msg := range collectMessages(tbl) {
		if msg.IsUnsent || msg.IsAdminMessage {
			continue
		}
		key := d.threadKey(msg.ThreadKey)
		thread, known := d.threads[key]
		// Encrypted conversations arrive (readable) through the e2ee client instead.
		if known && thread.threadType.IsWhatsApp() {
			continue
		}
		fromMe := d.self != 0 && msg.SenderId == d.self
		history := initial || msg.upsert
		if history && (fromMe || !known || msg.TimestampMs <= thread.readUpTo) {
			continue
		}
		text := lsText(msg)
		if text == "" {
			continue
		}
		id := strconv.FormatInt(key, 10)
		var threadName string
		isGroup := false
		if known {
			isGroup = thread.threadType != table.UNKNOWN_THREAD_TYPE && !thread.threadType.IsOneToOne()
			if isGroup {
				threadName = thread.name
			}
		}
		var senderName *string
		if name, ok := d.names[msg.SenderId]; ok {
			senderName = &name
		}
		out = append(out, pendingMessage{
			senderID: msg.SenderId,
			event: messageEvent{
				Type:       "message",
				ID:         msg.MessageId,
				ThreadID:   id,
				Encrypted:  false,
				IsGroup:    isGroup,
				ThreadName: optional(threadName),
				SenderID:   strconv.FormatInt(msg.SenderId, 10),
				SenderName: senderName,
				FromMe:     fromMe,
				Text:       text,
				Timestamp:  msg.TimestampMs,
				ReplyToID:  optional(msg.ReplySourceId),
				Initial:    initial,
				URL:        threadURL(id, false),
			},
		})
	}
	return out
}
