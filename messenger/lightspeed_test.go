package main

import (
	"testing"

	"go.mau.fi/mautrix-meta/pkg/messagix/table"
)

const (
	self   int64 = 100
	jana   int64 = 200
	petr   int64 = 300
	group  int64 = 9000
	secret int64 = 400
)

func janaThread(readUpTo int64) *table.LSDeleteThenInsertThread {
	return &table.LSDeleteThenInsertThread{
		ThreadKey:                    jana,
		ThreadType:                   table.ONE_TO_ONE,
		LastReadWatermarkTimestampMs: readUpTo,
		LastActivityTimestampMs:      5000,
	}
}

func knownDirectory() *directory {
	d := newDirectory()
	d.setSelf(self, "Jana")
	return d
}

func messageIDs(messages []pendingMessage) []string {
	ids := make([]string, len(messages))
	for i, msg := range messages {
		ids[i] = msg.event.ID
	}
	return ids
}

func TestInitialSyncSendsOnlyUnreadMessagesOfOthers(t *testing.T) {
	d := knownDirectory()
	tbl := &table.LSTable{
		LSDeleteThenInsertThread: []*table.LSDeleteThenInsertThread{janaThread(3000)},
		LSDeleteThenInsertContact: []*table.LSDeleteThenInsertContact{
			{Id: jana, Name: "Jana Nováková"},
		},
		LSUpsertMessage: []*table.LSUpsertMessage{
			{MessageId: "mid.read", ThreadKey: jana, SenderId: jana, TimestampMs: 2000, Text: "already read"},
			{MessageId: "mid.mine", ThreadKey: jana, SenderId: self, TimestampMs: 4000, Text: "my own"},
			{MessageId: "mid.unread", ThreadKey: jana, SenderId: jana, TimestampMs: 4500, Text: "  still unread  "},
			{MessageId: "mid.admin", ThreadKey: jana, SenderId: jana, TimestampMs: 4600, Text: "Jana named the group", IsAdminMessage: true},
			{MessageId: "mid.unsent", ThreadKey: jana, SenderId: jana, TimestampMs: 4700, IsUnsent: true},
		},
	}

	reads := d.learn(tbl)
	got := d.lsMessages(tbl, true)

	if len(got) != 1 {
		t.Fatalf("want only the unread message, got %v", messageIDs(got))
	}
	msg := got[0].event
	if msg.ID != "mid.unread" || msg.Text != "still unread" || !msg.Initial || msg.FromMe || msg.IsGroup || msg.Encrypted {
		t.Errorf("unexpected message %+v", msg)
	}
	if msg.ThreadID != "200" || msg.SenderID != "200" || msg.SenderName == nil || *msg.SenderName != "Jana Nováková" {
		t.Errorf("wrong thread or sender: %+v", msg)
	}
	if msg.ThreadName != nil {
		t.Errorf("one-to-one chats have no thread name, got %q", *msg.ThreadName)
	}
	if msg.URL != "https://www.facebook.com/messages/t/200" {
		t.Errorf("wrong url %s", msg.URL)
	}
	if len(reads) != 1 || reads[0].ThreadID != "200" || reads[0].Timestamp != 3000 {
		t.Errorf("want the thread's read mark, got %+v", reads)
	}
}

func TestInitialSyncSkipsThreadsItKnowsNothingAbout(t *testing.T) {
	d := knownDirectory()
	tbl := &table.LSTable{
		LSUpsertMessage: []*table.LSUpsertMessage{
			{MessageId: "mid.orphan", ThreadKey: petr, SenderId: petr, TimestampMs: 4500, Text: "history"},
		},
	}
	d.learn(tbl)

	if got := d.lsMessages(tbl, true); len(got) != 0 {
		t.Errorf("without a read mark it cannot tell unread from history, got %v", messageIDs(got))
	}
}

func TestLiveMessagesIncludeTheOwnersOwn(t *testing.T) {
	d := knownDirectory()
	d.learn(&table.LSTable{LSDeleteThenInsertThread: []*table.LSDeleteThenInsertThread{janaThread(3000)}})
	tbl := &table.LSTable{
		LSInsertMessage: []*table.LSInsertMessage{
			{MessageId: "mid.new", ThreadKey: jana, SenderId: jana, TimestampMs: 6000, Text: "new"},
			{MessageId: "mid.answer", ThreadKey: jana, SenderId: self, TimestampMs: 6100, Text: "answered on the phone", ReplySourceId: "mid.new"},
		},
		LSMarkThreadReadV2: []*table.LSMarkThreadReadV2{{ThreadKey: jana, LastReadWatermarkTimestampMs: 6100}},
	}

	reads := d.learn(tbl)
	got := d.lsMessages(tbl, false)

	if len(got) != 2 {
		t.Fatalf("want both live messages, got %v", messageIDs(got))
	}
	if got[0].event.Initial || got[0].event.FromMe {
		t.Errorf("first is a live message from Jana: %+v", got[0].event)
	}
	answer := got[1].event
	if !answer.FromMe || answer.ReplyToID == nil || *answer.ReplyToID != "mid.new" {
		t.Errorf("second is the owner's reply: %+v", answer)
	}
	if len(reads) != 1 || reads[0].Timestamp != 6100 {
		t.Errorf("want the owner's read on the phone, got %+v", reads)
	}
}

func TestReadMarksAreSentOnceAndOnlyTheOwnersCount(t *testing.T) {
	d := knownDirectory()
	d.learn(&table.LSTable{LSDeleteThenInsertThread: []*table.LSDeleteThenInsertThread{janaThread(3000)}})

	reads := d.learn(&table.LSTable{
		LSUpdateReadReceipt: []*table.LSUpdateReadReceipt{
			{ThreadKey: jana, ContactId: jana, ReadWatermarkTimestampMs: 9000},
			{ThreadKey: jana, ContactId: self, ReadWatermarkTimestampMs: 2000},
		},
		LSMarkThreadRead: []*table.LSMarkThreadRead{{ThreadKey: jana, LastReadWatermarkTimestampMs: 3000}},
	})

	if len(reads) != 0 {
		t.Errorf("Jana's receipt is hers, the owner's is older, the mark is not new: %+v", reads)
	}
}

func TestGroupMessagesCarryTheGroupName(t *testing.T) {
	d := knownDirectory()
	tbl := &table.LSTable{
		LSDeleteThenInsertThread: []*table.LSDeleteThenInsertThread{
			{ThreadKey: group, ThreadType: table.GROUP_THREAD, ThreadName: "Chata", LastReadWatermarkTimestampMs: 1},
		},
		LSInsertMessage: []*table.LSInsertMessage{
			{MessageId: "mid.group", ThreadKey: group, SenderId: petr, TimestampMs: 7000, Text: "kdo jede?"},
		},
	}
	d.learn(tbl)
	got := d.lsMessages(tbl, false)

	if len(got) != 1 || !got[0].event.IsGroup || got[0].event.ThreadName == nil || *got[0].event.ThreadName != "Chata" {
		t.Fatalf("want a group message named Chata, got %+v", got)
	}
	if got[0].event.SenderName != nil {
		t.Errorf("Petr's name is not known yet, got %q", *got[0].event.SenderName)
	}
}

func TestEncryptedThreadsAreLeftToTheE2EEClient(t *testing.T) {
	d := knownDirectory()
	tbl := &table.LSTable{
		// The old thread key moved to an encrypted one.
		LSVerifyHybridThreadExists: []*table.LSVerifyHybridThreadExists{
			{ThreadKey: 777, ThreadJID: secret, ThreadType: table.ENCRYPTED_OVER_WA_ONE_TO_ONE, LastReadWatermarkTimestampMS: 4000},
		},
		LSInsertMessage: []*table.LSInsertMessage{
			{MessageId: "mid.e2ee", ThreadKey: 777, SenderId: secret, TimestampMs: 8000, Text: "placeholder"},
		},
	}

	reads := d.learn(tbl)
	got := d.lsMessages(tbl, false)

	if len(got) != 0 {
		t.Errorf("encrypted messages come through the e2ee client, got %v", messageIDs(got))
	}
	if len(reads) != 1 || reads[0].ThreadID != "400" {
		t.Errorf("the read mark belongs to the encrypted thread's key, got %+v", reads)
	}
}

func TestAttachmentsBecomeLabels(t *testing.T) {
	tbl := &table.LSTable{
		LSInsertMessage: []*table.LSInsertMessage{
			{MessageId: "m1", Text: "look"},
			{MessageId: "m2"},
			{MessageId: "m3"},
			{MessageId: "m4", StickerId: 369239263222822},
		},
		LSInsertBlobAttachment: []*table.LSInsertBlobAttachment{
			{MessageId: "m1", AttachmentType: table.AttachmentTypeImage},
			{MessageId: "m2", AttachmentType: table.AttachmentTypeAudio},
			{MessageId: "m3", AttachmentType: table.AttachmentTypeFile, Filename: "faktura.pdf"},
		},
		LSInsertXmaAttachment: []*table.LSInsertXmaAttachment{
			{MessageId: "m3", TitleText: "Huginn on GitHub"},
		},
	}
	want := map[string]string{
		"m1": "look\n[photo]",
		"m2": "[voice message]",
		"m3": "[faktura.pdf] [Huginn on GitHub]",
		"m4": "[sticker]",
	}
	for _, msg := range collectMessages(tbl) {
		if got := lsText(msg); got != want[msg.MessageId] {
			t.Errorf("%s: want %q, got %q", msg.MessageId, want[msg.MessageId], got)
		}
	}
}
