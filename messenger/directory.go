package main

import (
	"strconv"
	"sync"
	"time"

	"go.mau.fi/mautrix-meta/pkg/messagix/table"
)

// How long a person Meta could not name is left alone before asking again.
const missingNameRetry = 30 * time.Minute

type threadInfo struct {
	threadType table.ThreadType
	name       string
	// The account owner has read everything up to here (unix ms).
	readUpTo int64
}

// directory remembers what Meta said about people and conversations: names for the
// messages, read marks for telling unread from history. It lives as long as the process.
type directory struct {
	mu      sync.Mutex
	self    int64
	names   map[int64]string
	missing map[int64]time.Time
	threads map[int64]*threadInfo
	// Old Messenger thread key → the encrypted (WhatsApp-transported) one that replaced it.
	waKeys map[int64]int64
}

func newDirectory() *directory {
	return &directory{
		names:   make(map[int64]string),
		missing: make(map[int64]time.Time),
		threads: make(map[int64]*threadInfo),
		waKeys:  make(map[int64]int64),
	}
}

func (d *directory) setSelf(fbid int64, name string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.self = fbid
	if name != "" {
		d.names[fbid] = name
	}
}

func (d *directory) selfID() int64 {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.self
}

// threadKey is where a thread lives now: hybrid threads moved to their encrypted key.
func (d *directory) threadKey(key int64) int64 {
	if wa, ok := d.waKeys[key]; ok {
		return wa
	}
	return key
}

func (d *directory) thread(key int64) *threadInfo {
	info, ok := d.threads[key]
	if !ok {
		info = &threadInfo{}
		d.threads[key] = info
	}
	return info
}

func (d *directory) name(fbid int64) (string, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	name, ok := d.names[fbid]
	return name, ok
}

func (d *directory) setName(fbid int64, name string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if name == "" {
		d.missing[fbid] = time.Now()
		return
	}
	d.names[fbid] = name
	delete(d.missing, fbid)
}

// shouldLookUp says whether to ask Meta for this person's name now.
func (d *directory) shouldLookUp(fbid int64) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	if _, known := d.names[fbid]; known || fbid == 0 {
		return false
	}
	when, tried := d.missing[fbid]
	return !tried || time.Since(when) > missingNameRetry
}

func (d *directory) threadSnapshot(key int64) (threadInfo, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	info, ok := d.threads[key]
	if !ok {
		return threadInfo{}, false
	}
	return *info, true
}

func (d *directory) noteRead(key, upTo int64) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	info := d.thread(key)
	if upTo <= info.readUpTo {
		return false
	}
	info.readUpTo = upTo
	return true
}

// learn takes in a table's people, threads and read marks. It returns the read events:
// conversations the owner read further on another device (or that a sync says are read).
func (d *directory) learn(tbl *table.LSTable) []readEvent {
	d.mu.Lock()
	defer d.mu.Unlock()

	for _, jid := range tbl.LSUpdateThreadAuthorityAndMappingWithOTIDFromJID {
		d.waKeys[jid.ThreadKey] = jid.ThreadJID
	}
	for _, hybrid := range tbl.LSVerifyHybridThreadExists {
		d.waKeys[hybrid.ThreadKey] = hybrid.ThreadJID
	}
	for _, contact := range tbl.LSDeleteThenInsertContact {
		if name := contact.GetName(); name != "" {
			d.names[contact.GetFBID()] = name
		}
	}
	for _, contact := range tbl.LSVerifyContactRowExists {
		if name := contact.GetName(); name != "" {
			d.names[contact.GetFBID()] = name
		}
	}

	var reads []readEvent
	read := func(key, upTo int64) {
		info := d.thread(key)
		if upTo > info.readUpTo {
			info.readUpTo = upTo
			reads = append(reads, readEvent{Type: "read", ThreadID: strconv.FormatInt(key, 10), Timestamp: upTo})
		}
	}
	for _, thread := range tbl.LSDeleteThenInsertThread {
		key := d.threadKey(thread.ThreadKey)
		info := d.thread(key)
		info.threadType = thread.ThreadType
		info.name = thread.ThreadName
		read(key, thread.LastReadWatermarkTimestampMs)
	}
	for _, thread := range tbl.LSUpdateOrInsertThread {
		key := d.threadKey(thread.ThreadKey)
		info := d.thread(key)
		info.threadType = thread.ThreadType
		if thread.ThreadName != "" {
			info.name = thread.ThreadName
		}
		read(key, thread.LastReadWatermarkTimestampMs)
	}
	for _, hybrid := range tbl.LSVerifyHybridThreadExists {
		info := d.thread(hybrid.ThreadJID)
		if info.threadType == table.UNKNOWN_THREAD_TYPE {
			info.threadType = hybrid.ThreadType
		}
		read(hybrid.ThreadJID, hybrid.LastReadWatermarkTimestampMS)
	}
	for _, exists := range tbl.LSVerifyThreadExists {
		info := d.thread(d.threadKey(exists.ThreadKey))
		if info.threadType == table.UNKNOWN_THREAD_TYPE {
			info.threadType = exists.ThreadType
		}
	}
	for _, rename := range tbl.LSSyncUpdateThreadName {
		d.thread(d.threadKey(rename.ThreadKey)).name = rename.ThreadName
	}
	for _, mark := range tbl.LSMarkThreadRead {
		read(d.threadKey(mark.ThreadKey), mark.LastReadWatermarkTimestampMs)
	}
	for _, mark := range tbl.LSMarkThreadReadV2 {
		read(d.threadKey(mark.ThreadKey), mark.LastReadWatermarkTimestampMs)
	}
	for _, receipt := range tbl.LSUpdateReadReceipt {
		// Others' receipts say they saw the owner's message; only the owner's own count.
		if d.self != 0 && receipt.ContactId == d.self {
			read(d.threadKey(receipt.ThreadKey), receipt.ReadWatermarkTimestampMs)
		}
	}
	return reads
}
