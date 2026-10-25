package main

import (
	"context"
	"maps"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/rs/zerolog"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types/events"

	"go.mau.fi/mautrix-meta/pkg/messagix"
	"go.mau.fi/mautrix-meta/pkg/messagix/cookies"
	"go.mau.fi/mautrix-meta/pkg/messagix/dgw"
	"go.mau.fi/mautrix-meta/pkg/messagix/socket"
	"go.mau.fi/mautrix-meta/pkg/messagix/table"
)

const (
	cookieCheckInterval = 10 * time.Minute
	nameLookupTimeout   = 5 * time.Second
	// Messages the e2ee server held while Huginn was away count as the initial sync; if it
	// never says the backlog is done, stop counting after this.
	offlineSyncWindow = 2 * time.Minute
)

// After a failure the socket gives up on, the whole session is set up again, waiting
// longer each time it fails in a row.
var reconnectDelays = []time.Duration{5 * time.Second, 30 * time.Second, 2 * time.Minute, 10 * time.Minute, 30 * time.Minute}

// generation is one messagix client: a full reconnect replaces it, and events from the
// old one are dropped.
type generation struct {
	client  *messagix.Client
	ready   chan error
	once    sync.Once
	settled atomic.Bool
}

func (g *generation) settle(err error) {
	g.once.Do(func() {
		g.settled.Store(true)
		g.ready <- err
	})
}

// connection is one connected account: the Lightspeed socket (unencrypted chats, names,
// read marks) and the e2ee client (encrypted chats) side by side.
type connection struct {
	log       zerolog.Logger
	libLog    zerolog.Logger
	out       *output
	dir       *directory
	fbid      int64
	container *sqlstore.Container
	device    *store.Device

	ctx     context.Context
	cancel  context.CancelFunc
	started chan struct{}

	// An unbounded queue: the socket hands tables over without waiting, because handling
	// them may itself need the socket (name lookups).
	queueMu sync.Mutex
	queue   []func()
	wake    chan struct{}

	mu          sync.Mutex
	gen         *generation
	e2ee        *whatsmeow.Client
	sentCookies map[string]string

	offlineSynced atomic.Bool
	e2eeSince     atomic.Int64
	reconnecting  atomic.Bool
	dead          atomic.Bool
	closeOnce     sync.Once
}

func newConnection(s *session, fbid int64, container *sqlstore.Container, device *store.Device) *connection {
	ctx, cancel := context.WithCancel(context.Background())
	c := &connection{
		log:       s.log,
		libLog:    s.libLog,
		out:       s.out,
		dir:       s.dir,
		fbid:      fbid,
		container: container,
		device:    device,
		ctx:       ctx,
		cancel:    cancel,
		started:   make(chan struct{}),
		wake:      make(chan struct{}, 1),
	}
	go c.work()
	return c
}

func (c *connection) isStarted() bool {
	select {
	case <-c.started:
		return true
	default:
		return false
	}
}

func (c *connection) enqueue(job func()) {
	c.queueMu.Lock()
	c.queue = append(c.queue, job)
	c.queueMu.Unlock()
	select {
	case c.wake <- struct{}{}:
	default:
	}
}

func (c *connection) work() {
	select {
	case <-c.started:
	case <-c.ctx.Done():
		return
	}
	for c.ctx.Err() == nil {
		c.queueMu.Lock()
		var job func()
		if len(c.queue) > 0 {
			job = c.queue[0]
			c.queue[0] = nil
			c.queue = c.queue[1:]
		}
		c.queueMu.Unlock()
		if job != nil {
			job()
			continue
		}
		select {
		case <-c.wake:
		case <-c.ctx.Done():
		}
	}
}

func (c *connection) current() *generation {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.gen
}

// dial loads the Messenger page and connects its socket.
func (c *connection) dial(ctx context.Context, cks *cookies.Cookies) (*generation, string, *table.LSTable, error) {
	client := newMessagix(cks, c.libLog)
	user, tbl, err := client.LoadMessagesPage(ctx)
	if err != nil {
		return nil, "", nil, loadError(err)
	}
	if user.GetFBID() != c.fbid {
		return nil, "", nil, fail(CodeUnauthorized, "Facebook loaded a different account than the cookies name — log in again", nil)
	}
	g := &generation{client: client, ready: make(chan error, 1)}
	client.SetEventHandler(c.metaHandler(g))
	client.SetDevice(c.device)
	c.mu.Lock()
	c.gen = g
	c.mu.Unlock()
	if err := client.Connect(c.ctx); err != nil {
		return nil, "", nil, fail(CodeUnavailable, "Could not connect to Messenger", err)
	}
	var connectErr error
	select {
	case connectErr = <-g.ready:
	case <-ctx.Done():
		connectErr = ctx.Err()
	case <-time.After(connectTimeout):
		connectErr = context.DeadlineExceeded
	}
	if connectErr != nil {
		client.SetEventHandler(nil)
		client.Disconnect()
		if dgw.IsUnauthorized(connectErr) {
			return nil, "", nil, fail(CodeUnauthorized, "Facebook refused the connection — log in again", connectErr)
		}
		return nil, "", nil, fail(CodeUnavailable, "Could not connect to Messenger", connectErr)
	}
	return g, user.GetName(), tbl, nil
}

func (c *connection) open(ctx context.Context, cks *cookies.Cookies) (*accountResult, error) {
	provided := cookieMap(cks)
	g, name, tbl, err := c.dial(ctx, cks)
	if err != nil {
		return nil, err
	}
	c.dir.setSelf(c.fbid, name)
	c.mu.Lock()
	c.sentCookies = provided
	c.mu.Unlock()
	c.enqueue(func() { c.handleTable(g, tbl, true) })
	return &accountResult{UserID: strconv.FormatInt(c.fbid, 10), Name: name}, nil
}

// start lets events out; the connect answer has been sent.
func (c *connection) start() {
	close(c.started)
	go c.startE2EE()
	go c.watchCookies()
}

func (c *connection) metaHandler(g *generation) messagix.EventHandler {
	return func(_ context.Context, raw any) {
		if c.current() != g || c.dead.Load() {
			return
		}
		switch evt := raw.(type) {
		case *table.LSTable:
			c.enqueue(func() { c.handleTable(g, evt, false) })
		case *messagix.ConnectedEvent:
			g.settle(nil)
		case *messagix.ReconnectedEvent:
			if c.isStarted() {
				c.out.event(stateEvent{Type: "connected"})
			}
		case *messagix.TransientDisconnectEvent:
			if c.isStarted() {
				c.out.event(stateEvent{Type: "disconnected", Reason: "Messenger connection dropped; reconnecting"})
			}
		case *messagix.PermanentErrorEvent:
			if !g.settled.Load() {
				g.settle(evt.Err)
			} else if dgw.IsUnauthorized(evt.Err) {
				c.loggedOut("Facebook ended this session — log in again")
			} else {
				go c.fullReconnect("Messenger connection failed")
			}
		}
	}
}

func (c *connection) handleTable(g *generation, tbl *table.LSTable, initial bool) {
	if c.current() != g || c.dead.Load() {
		return
	}
	reads := c.dir.learn(tbl)
	for _, msg := range c.dir.lsMessages(tbl, initial) {
		c.emitMessage(g.client, msg)
	}
	// After the messages, so a read mark closes what it covers.
	for _, read := range reads {
		c.out.event(read)
	}
	if !initial {
		g.client.PostHandlePublishResponse(tbl)
	}
}

func (c *connection) emitMessage(client *messagix.Client, msg pendingMessage) {
	if msg.event.SenderName == nil && c.dir.shouldLookUp(msg.senderID) {
		c.lookUpName(client, msg.senderID)
	}
	if name, ok := c.dir.name(msg.senderID); ok {
		msg.event.SenderName = &name
	}
	c.out.event(msg.event)
}

func (c *connection) lookUpName(client *messagix.Client, fbid int64) {
	ctx, cancel := context.WithTimeout(c.ctx, nameLookupTimeout)
	defer cancel()
	tbl, err := client.ExecuteTasks(ctx, &socket.GetContactsFullTask{ContactID: fbid})
	if err != nil {
		c.log.Debug().Err(err).Int64("fbid", fbid).Msg("name lookup failed")
		c.dir.setName(fbid, "")
		return
	}
	for _, contact := range tbl.LSDeleteThenInsertContact {
		if contact.GetFBID() == fbid {
			c.dir.setName(fbid, contact.GetName())
			return
		}
	}
	c.dir.setName(fbid, "")
}

func (c *connection) startE2EE() {
	g := c.current()
	if g == nil || c.dead.Load() {
		return
	}
	client, err := g.client.PrepareE2EEClient()
	if err != nil {
		c.log.Error().Err(err).Msg("could not prepare the e2ee client")
		return
	}
	// Acknowledge a message only once it is written out, so a crash loses nothing.
	client.SynchronousAck = true
	client.EnableDecryptedEventBuffer = true
	client.AddEventHandlerWithSuccessStatus(c.e2eeHandler(client))
	c.offlineSynced.Store(false)
	c.e2eeSince.Store(time.Now().UnixMilli())
	c.mu.Lock()
	old := c.e2ee
	c.e2ee = client
	c.mu.Unlock()
	if old != nil {
		old.Disconnect()
	}
	if err := client.Connect(); err != nil {
		// It keeps retrying on its own (InitialAutoReconnect).
		c.log.Warn().Err(err).Msg("e2ee connect failed")
	}
}

func (c *connection) currentE2EE() *whatsmeow.Client {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.e2ee
}

func (c *connection) inOfflineSync() bool {
	return !c.offlineSynced.Load() && time.Since(time.UnixMilli(c.e2eeSince.Load())) < offlineSyncWindow
}

func (c *connection) e2eeHandler(client *whatsmeow.Client) func(any) bool {
	return func(raw any) bool {
		if c.currentE2EE() != client || c.dead.Load() {
			return true
		}
		switch evt := raw.(type) {
		case *events.FBMessage:
			if msg, ok := c.dir.e2eeMessage(evt, c.inOfflineSync()); ok {
				if g := c.current(); g != nil {
					c.emitMessage(g.client, msg)
				}
			}
		case *events.Receipt:
			if read, ok := e2eeRead(evt); ok {
				c.out.event(read)
			}
		case *events.OfflineSyncCompleted:
			c.offlineSynced.Store(true)
		case *events.Connected:
			c.log.Info().Msg("e2ee connected")
		case *events.Disconnected:
			c.log.Info().Msg("e2ee disconnected")
		case *events.CATRefreshError:
			go c.fullReconnect("Messenger's encryption token expired")
		case *events.LoggedOut:
			c.deviceGone("Messenger signed Huginn's device out — log in again")
		case *events.ConnectFailure:
			switch {
			case evt.Reason == events.ConnectFailureNotFound,
				evt.Reason == events.ConnectFailureClientUnknown,
				evt.Reason.IsLoggedOut():
				c.deviceGone("Messenger no longer knows Huginn's device — log in again")
			default:
				go c.fullReconnect(evt.PermanentDisconnectDescription())
			}
		case events.PermanentDisconnect:
			go c.fullReconnect(evt.PermanentDisconnectDescription())
		}
		return true
	}
}

// deviceGone forgets a device Messenger dropped, so the next login registers a new one
// instead of failing on the old keys. Huginn never re-adds itself without a login: the
// owner may have removed it on purpose.
func (c *connection) deviceGone(reason string) {
	c.finish(reason, true)
}

// loggedOut is final: the server needs a new login, so nothing reconnects.
func (c *connection) loggedOut(reason string) {
	c.finish(reason, false)
}

func (c *connection) finish(reason string, forgetDevice bool) {
	if c.dead.Swap(true) {
		return
	}
	c.out.event(stateEvent{Type: "loggedOut", Reason: reason})
	// Not inline: this runs inside the clients' own event handlers.
	go func() {
		c.stopClients()
		if !forgetDevice {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := c.device.Delete(ctx); err != nil {
			c.log.Warn().Err(err).Msg("could not delete the dropped device")
		}
	}()
}

func (c *connection) stopClients() {
	c.mu.Lock()
	g := c.gen
	e2ee := c.e2ee
	c.e2ee = nil
	c.mu.Unlock()
	if e2ee != nil {
		e2ee.Disconnect()
	}
	if g != nil {
		g.client.SetEventHandler(nil)
		g.client.Disconnect()
	}
}

// fullReconnect sets the whole session up again (page load, socket, e2ee), as the
// socket's own retries do not survive a permanent error or an expired token.
func (c *connection) fullReconnect(reason string) {
	if c.dead.Load() || c.ctx.Err() != nil || !c.reconnecting.CompareAndSwap(false, true) {
		return
	}
	defer c.reconnecting.Store(false)
	c.log.Warn().Str("reason", reason).Msg("reconnecting from scratch")
	if c.isStarted() {
		c.out.event(stateEvent{Type: "disconnected", Reason: reason})
	}
	cks := c.current().client.GetCookies()
	c.stopClients()
	for attempt := 0; ; attempt++ {
		select {
		case <-time.After(reconnectDelays[min(attempt, len(reconnectDelays)-1)]):
		case <-c.ctx.Done():
			return
		}
		ctx, cancel := context.WithTimeout(c.ctx, connectTimeout)
		g, _, tbl, err := c.dial(ctx, cks)
		cancel()
		if err != nil {
			if isLoggedOut(err) {
				c.loggedOut(toRPCError(err).Message)
				return
			}
			c.log.Warn().Err(err).Int("attempt", attempt+1).Msg("reconnect failed")
			continue
		}
		c.enqueue(func() { c.handleTable(g, tbl, true) })
		c.out.event(stateEvent{Type: "connected"})
		go c.startE2EE()
		c.checkCookies()
		return
	}
}

// checkCookies passes on cookie values Facebook changed, so the server keeps the
// current ones.
func (c *connection) checkCookies() {
	g := c.current()
	if g == nil || c.dead.Load() {
		return
	}
	now := cookieMap(g.client.GetCookies())
	c.mu.Lock()
	changed := !maps.Equal(c.sentCookies, now)
	if changed {
		c.sentCookies = now
	}
	c.mu.Unlock()
	if changed {
		c.out.event(cookiesEvent{Type: "cookies", Cookies: now})
	}
}

func (c *connection) watchCookies() {
	c.checkCookies()
	ticker := time.NewTicker(cookieCheckInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			c.checkCookies()
		case <-c.ctx.Done():
			return
		}
	}
}

func (c *connection) close() {
	c.closeOnce.Do(func() {
		c.cancel()
		c.stopClients()
		_ = c.container.Close()
	})
}
