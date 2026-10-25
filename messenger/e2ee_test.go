package main

import (
	"testing"
	"time"

	"go.mau.fi/mautrix-meta/pkg/messagix/table"
	armadillo "go.mau.fi/whatsmeow/proto"
	"go.mau.fi/whatsmeow/proto/waArmadilloApplication"
	"go.mau.fi/whatsmeow/proto/waArmadilloXMA"
	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waConsumerApplication"
	"go.mau.fi/whatsmeow/proto/waMsgApplication"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

func consumer(content *waConsumerApplication.ConsumerApplication_Content) *waConsumerApplication.ConsumerApplication {
	return &waConsumerApplication.ConsumerApplication{
		Payload: &waConsumerApplication.ConsumerApplication_Payload{
			Payload: &waConsumerApplication.ConsumerApplication_Payload_Content{Content: content},
		},
	}
}

func text(s string) *waCommon.MessageText {
	return &waCommon.MessageText{Text: proto.String(s)}
}

func TestEncryptedMessagesBecomeText(t *testing.T) {
	cases := []struct {
		name string
		msg  armadillo.MessageApplicationSub
		want string
	}{
		{"text", consumer(&waConsumerApplication.ConsumerApplication_Content{
			Content: &waConsumerApplication.ConsumerApplication_Content_MessageText{MessageText: text(" ahoj ")},
		}), "ahoj"},
		{"photo with caption", consumer(&waConsumerApplication.ConsumerApplication_Content{
			Content: &waConsumerApplication.ConsumerApplication_Content_ImageMessage{
				ImageMessage: &waConsumerApplication.ConsumerApplication_ImageMessage{Caption: text("from the trip")},
			},
		}), "from the trip\n[photo]"},
		{"document", consumer(&waConsumerApplication.ConsumerApplication_Content{
			Content: &waConsumerApplication.ConsumerApplication_Content_DocumentMessage{
				DocumentMessage: &waConsumerApplication.ConsumerApplication_DocumentMessage{FileName: proto.String("smlouva.pdf")},
			},
		}), "[smlouva.pdf]"},
		{"voice", consumer(&waConsumerApplication.ConsumerApplication_Content{
			Content: &waConsumerApplication.ConsumerApplication_Content_AudioMessage{
				AudioMessage: &waConsumerApplication.ConsumerApplication_AudioMessage{},
			},
		}), "[voice message]"},
		{"shared link", &waArmadilloApplication.Armadillo{
			Payload: &waArmadilloApplication.Armadillo_Payload{
				Payload: &waArmadilloApplication.Armadillo_Payload_Content{
					Content: &waArmadilloApplication.Armadillo_Content{
						Content: &waArmadilloApplication.Armadillo_Content_ExtendedContentMessage{
							ExtendedContentMessage: &waArmadilloXMA.ExtendedContentMessage{TitleText: proto.String("A reel")},
						},
					},
				},
			},
		}, "[A reel]"},
	}
	for _, tc := range cases {
		got, ok := e2eeText(tc.msg)
		if !ok || got != tc.want {
			t.Errorf("%s: want %q, got %q (ok %v)", tc.name, tc.want, got, ok)
		}
	}
}

func TestReactionsAndTimerChangesAreNotMessages(t *testing.T) {
	reaction := consumer(&waConsumerApplication.ConsumerApplication_Content{
		Content: &waConsumerApplication.ConsumerApplication_Content_ReactionMessage{
			ReactionMessage: &waConsumerApplication.ConsumerApplication_ReactionMessage{},
		},
	})
	if _, ok := e2eeText(reaction); ok {
		t.Error("a reaction changes an earlier message")
	}
	if _, ok := e2eeText(nil); ok {
		t.Error("a timer change carries no message")
	}
}

func fbMessage(chat, sender types.JID, fromMe bool) *events.FBMessage {
	return &events.FBMessage{
		Info: types.MessageInfo{
			MessageSource: types.MessageSource{Chat: chat, Sender: sender, IsFromMe: fromMe, IsGroup: chat.Server == types.GroupServer},
			ID:            "7F3A",
			Timestamp:     time.UnixMilli(1_760_000_000_000),
		},
		Message: consumer(&waConsumerApplication.ConsumerApplication_Content{
			Content: &waConsumerApplication.ConsumerApplication_Content_MessageText{MessageText: text("v pátek?")},
		}),
		FBApplication: &waMsgApplication.MessageApplication{
			Metadata: &waMsgApplication.MessageApplication_Metadata{
				QuotedMessage: &waMsgApplication.MessageApplication_Metadata_QuotedMessage{StanzaID: proto.String("6E2B")},
			},
		},
	}
}

func TestEncryptedOneToOneMessage(t *testing.T) {
	d := knownDirectory()
	d.setName(jana, "Jana Nováková")
	janaJID := types.NewJID("200", types.MessengerServer)

	msg, ok := d.e2eeMessage(fbMessage(janaJID, janaJID, false), true)

	if !ok {
		t.Fatal("want a message")
	}
	e := msg.event
	if e.ThreadID != "200" || !e.Encrypted || e.IsGroup || e.FromMe || !e.Initial {
		t.Errorf("unexpected flags %+v", e)
	}
	if e.Text != "v pátek?" || e.ID != "7F3A" || e.Timestamp != 1_760_000_000_000 {
		t.Errorf("unexpected content %+v", e)
	}
	if e.SenderName == nil || *e.SenderName != "Jana Nováková" || e.ReplyToID == nil || *e.ReplyToID != "6E2B" {
		t.Errorf("unexpected sender or reply %+v", e)
	}
	if e.URL != "https://www.facebook.com/messages/e2ee/t/200" {
		t.Errorf("wrong url %s", e.URL)
	}
}

func TestEncryptedGroupMessageFromTheOwner(t *testing.T) {
	d := knownDirectory()
	d.learn(&table.LSTable{
		LSDeleteThenInsertThread: []*table.LSDeleteThenInsertThread{
			{ThreadKey: group, ThreadType: table.ENCRYPTED_OVER_WA_GROUP, ThreadName: "Chata"},
		},
	})
	groupJID := types.NewJID("9000", types.GroupServer)
	me := types.NewJID("100", types.MessengerServer)

	msg, ok := d.e2eeMessage(fbMessage(groupJID, me, true), false)

	if !ok || !msg.event.IsGroup || !msg.event.FromMe || msg.event.Initial {
		t.Fatalf("unexpected %+v", msg.event)
	}
	if msg.event.ThreadName == nil || *msg.event.ThreadName != "Chata" {
		t.Errorf("want the group's name from the Lightspeed sync, got %v", msg.event.ThreadName)
	}
}

func TestOnlyTheOwnersReadReceiptsCount(t *testing.T) {
	chat := types.NewJID("200", types.MessengerServer)
	own := &events.Receipt{
		MessageSource: types.MessageSource{Chat: chat, IsFromMe: true},
		Type:          types.ReceiptTypeReadSelf,
		Timestamp:     time.UnixMilli(5000),
	}
	theirs := &events.Receipt{MessageSource: types.MessageSource{Chat: chat}, Type: types.ReceiptTypeRead}
	delivered := &events.Receipt{MessageSource: types.MessageSource{Chat: chat, IsFromMe: true}, Type: types.ReceiptTypeDelivered}

	if read, ok := e2eeRead(own); !ok || read.ThreadID != "200" || read.Timestamp != 5000 {
		t.Errorf("want the owner's read, got %+v %v", read, ok)
	}
	if _, ok := e2eeRead(theirs); ok {
		t.Error("Jana reading the owner's message closes nothing")
	}
	if _, ok := e2eeRead(delivered); ok {
		t.Error("delivery is not reading")
	}
}
