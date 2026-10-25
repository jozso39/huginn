package main

import (
	"strconv"
	"strings"

	armadillo "go.mau.fi/whatsmeow/proto"
	"go.mau.fi/whatsmeow/proto/waArmadilloApplication"
	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waConsumerApplication"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

func withCaption(label string, caption *waCommon.MessageText) string {
	if text := strings.TrimSpace(caption.GetText()); text != "" {
		return text + "\n" + label
	}
	return label
}

// consumerText reads the usual encrypted messages. ok is false for what is not a new
// message: reactions, edits, poll votes.
func consumerText(content *waConsumerApplication.ConsumerApplication_Content) (string, bool) {
	switch c := content.GetContent().(type) {
	case *waConsumerApplication.ConsumerApplication_Content_MessageText:
		return c.MessageText.GetText(), true
	case *waConsumerApplication.ConsumerApplication_Content_ExtendedTextMessage:
		return c.ExtendedTextMessage.GetText().GetText(), true
	case *waConsumerApplication.ConsumerApplication_Content_ImageMessage:
		return withCaption("[photo]", c.ImageMessage.GetCaption()), true
	case *waConsumerApplication.ConsumerApplication_Content_VideoMessage:
		return withCaption("[video]", c.VideoMessage.GetCaption()), true
	case *waConsumerApplication.ConsumerApplication_Content_AudioMessage:
		return "[voice message]", true
	case *waConsumerApplication.ConsumerApplication_Content_DocumentMessage:
		if name := c.DocumentMessage.GetFileName(); name != "" {
			return "[" + name + "]", true
		}
		return "[file]", true
	case *waConsumerApplication.ConsumerApplication_Content_StickerMessage:
		return "[sticker]", true
	case *waConsumerApplication.ConsumerApplication_Content_ViewOnceMessage:
		if c.ViewOnceMessage.GetVideoMessage() != nil {
			return "[view-once video]", true
		}
		return "[view-once photo]", true
	case *waConsumerApplication.ConsumerApplication_Content_LocationMessage:
		if name := c.LocationMessage.GetLocation().GetName(); name != "" {
			return "[location: " + name + "]", true
		}
		return "[location]", true
	case *waConsumerApplication.ConsumerApplication_Content_LiveLocationMessage:
		return "[live location]", true
	case *waConsumerApplication.ConsumerApplication_Content_ContactMessage,
		*waConsumerApplication.ConsumerApplication_Content_ContactsArrayMessage:
		return "[contact]", true
	case *waConsumerApplication.ConsumerApplication_Content_PollCreationMessage:
		return "[poll]", true
	case *waConsumerApplication.ConsumerApplication_Content_GroupInviteMessage:
		return "[group invite]", true
	case *waConsumerApplication.ConsumerApplication_Content_StatusTextMessage:
		return "[status]", true
	default:
		// Reactions, edits and poll votes change an earlier message.
		return "", false
	}
}

// armadilloText reads Messenger's own encrypted message kinds: shares, view-once media,
// galleries, stickers.
func armadilloText(content *waArmadilloApplication.Armadillo_Content) (string, bool) {
	switch c := content.GetContent().(type) {
	case *waArmadilloApplication.Armadillo_Content_ExtendedContentMessage:
		ext := c.ExtendedContentMessage
		if text := strings.TrimSpace(ext.GetMessageText()); text != "" {
			return text, true
		}
		if title := ext.GetTitleText(); title != "" {
			return "[" + title + "]", true
		}
		return "[shared content]", true
	case *waArmadilloApplication.Armadillo_Content_RavenMessage_,
		*waArmadilloApplication.Armadillo_Content_RavenMessageMsgr:
		return "[view-once media]", true
	case *waArmadilloApplication.Armadillo_Content_ImageGalleryMessage_:
		return "[photos]", true
	case *waArmadilloApplication.Armadillo_Content_CommonSticker_:
		return "[sticker]", true
	case *waArmadilloApplication.Armadillo_Content_BumpExistingMessage_:
		return "[bumped a message]", true
	case *waArmadilloApplication.Armadillo_Content_NoteReplyMessage_:
		return "[replied to a note]", true
	default:
		// Screenshot notices, payments, verification: nothing to read.
		return "", false
	}
}

// e2eeText is what an encrypted message says. ok is false when it is not a new message
// (a reaction, an edit, an unsend, a disappearing-timer change).
func e2eeText(msg armadillo.MessageApplicationSub) (string, bool) {
	switch typed := msg.(type) {
	case *waConsumerApplication.ConsumerApplication:
		content := typed.GetPayload().GetContent()
		if content == nil {
			return "", false
		}
		text, ok := consumerText(content)
		return strings.TrimSpace(text), ok
	case *waArmadilloApplication.Armadillo:
		content := typed.GetPayload().GetContent()
		if content == nil {
			return "", false
		}
		text, ok := armadilloText(content)
		return strings.TrimSpace(text), ok
	default:
		return "", false
	}
}

// e2eeThreadID matches the Lightspeed key of the same conversation: the other person's
// id for one-to-one chats, the group's number for groups.
func e2eeThreadID(chat types.JID) string {
	return chat.User
}

// e2eeMessage maps an encrypted message; ok is false for what is not a new message.
func (d *directory) e2eeMessage(evt *events.FBMessage, initial bool) (pendingMessage, bool) {
	text, ok := e2eeText(evt.Message)
	if !ok || text == "" {
		return pendingMessage{}, false
	}
	info := evt.Info
	id := e2eeThreadID(info.Chat)
	isGroup := info.Chat.Server == types.GroupServer
	senderID := int64(info.Sender.UserInt())

	var threadName, senderName *string
	if key, err := strconv.ParseInt(id, 10, 64); err == nil && isGroup {
		if thread, known := d.threadSnapshot(key); known {
			threadName = optional(thread.name)
		}
	}
	if name, known := d.name(senderID); known {
		senderName = &name
	}
	var replyTo *string
	if quoted := evt.FBApplication.GetMetadata().GetQuotedMessage(); quoted != nil {
		replyTo = optional(quoted.GetStanzaID())
	}
	return pendingMessage{
		senderID: senderID,
		event: messageEvent{
			Type:       "message",
			ID:         info.ID,
			ThreadID:   id,
			Encrypted:  true,
			IsGroup:    isGroup,
			ThreadName: threadName,
			SenderID:   strconv.FormatInt(senderID, 10),
			SenderName: senderName,
			FromMe:     info.IsFromMe,
			Text:       text,
			Timestamp:  info.Timestamp.UnixMilli(),
			ReplyToID:  replyTo,
			Initial:    initial,
			URL:        threadURL(id, true),
		},
	}, true
}

// e2eeRead turns the owner's own read receipt (from another device) into a read event.
func e2eeRead(evt *events.Receipt) (readEvent, bool) {
	if !evt.IsFromMe || (evt.Type != types.ReceiptTypeRead && evt.Type != types.ReceiptTypeReadSelf) {
		return readEvent{}, false
	}
	return readEvent{Type: "read", ThreadID: e2eeThreadID(evt.Chat), Timestamp: evt.Timestamp.UnixMilli()}, true
}
