package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/rs/zerolog"
	"go.mau.fi/util/exhttp"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	waTypes "go.mau.fi/whatsmeow/types"
	waLog "go.mau.fi/whatsmeow/util/log"

	"go.mau.fi/mautrix-meta/pkg/messagix"
	"go.mau.fi/mautrix-meta/pkg/messagix/cookies"
	"go.mau.fi/mautrix-meta/pkg/messagix/httpclient"
	"go.mau.fi/mautrix-meta/pkg/messagix/types"
	"go.mau.fi/mautrix-meta/pkg/messagix/useragent"
)

// The page the login window opens, and the one it lands on once logged in: the same
// pair mautrix-meta's own cookie login uses.
const (
	loginURL       = "https://www.facebook.com/"
	doneURLPattern = `^https://www\.facebook\.com/(?:messages/(?:e2ee/)?(?:t/[0-9]+/?)?)?(?:\?.*)?$`
)

// Long enough for Facebook's slow first page load and the socket handshake.
const connectTimeout = 90 * time.Second

func requiredCookies() []string {
	names := make([]string, len(cookies.FBRequiredCookies))
	for i, name := range cookies.FBRequiredCookies {
		names[i] = string(name)
	}
	return names
}

func info() infoResult {
	return infoResult{
		UserAgent:       useragent.UserAgent,
		LoginURL:        loginURL,
		RequiredCookies: requiredCookies(),
		DoneURLPattern:  doneURLPattern,
	}
}

func parseCookies(raw map[string]string) (*cookies.Cookies, error) {
	if len(raw) == 0 {
		return nil, fail(CodeValidation, "params.cookies is missing", nil)
	}
	values := make(map[cookies.MetaCookieName]string, len(raw))
	for name, value := range raw {
		values[cookies.MetaCookieName(name)] = value
	}
	c := &cookies.Cookies{Platform: types.Facebook}
	c.UpdateValues(values)
	if missing := c.GetMissingCookieNames(); len(missing) > 0 {
		names := make([]string, len(missing))
		for i, name := range missing {
			names[i] = string(name)
		}
		return nil, fail(CodeUnauthorized, fmt.Sprintf("The Facebook session is missing cookies %v — log in again", names), nil)
	}
	return c, nil
}

func cookieMap(c *cookies.Cookies) map[string]string {
	all := c.GetAll()
	out := make(map[string]string, len(all))
	for name, value := range all {
		out[string(name)] = value
	}
	return out
}

func newMessagix(c *cookies.Cookies, log zerolog.Logger) *messagix.Client {
	return messagix.NewClient(c, log, &messagix.Config{ClientSettings: exhttp.SensibleClientSettings})
}

// loadError says what a failed page load means for the user.
func loadError(err error) error {
	var lsErr *types.ErrorResponse
	switch {
	case errors.Is(err, httpclient.ErrTokenInvalidated):
		return fail(CodeUnauthorized, "Facebook ended this session — log in again", err)
	case errors.Is(err, httpclient.ErrCheckpointRequired), errors.Is(err, httpclient.ErrChallengeRequired):
		return fail(CodeUnauthorized, "Facebook wants to check it's you — finish that on facebook.com, then log in again", err)
	case errors.Is(err, httpclient.ErrConsentRequired):
		return fail(CodeUnauthorized, "Facebook asks you to accept something first — do that on facebook.com, then log in again", err)
	case errors.Is(err, httpclient.ErrAccountSuspended):
		return fail(CodeUnauthorized, "Facebook suspended this account", err)
	case errors.Is(err, httpclient.ErrRateLimited):
		return fail(CodeUnavailable, "Facebook is limiting requests — try again later", err)
	case errors.As(err, &lsErr) && lsErr.ErrorCode == 1357053:
		return fail(CodeUnauthorized, "Facebook ended this session — log in again", err)
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return fail(CodeUnavailable, "Messenger did not answer in time", err)
	default:
		return fail(CodeUnavailable, "Could not load Messenger", err)
	}
}

func isLoggedOut(err error) bool {
	var known *helperError
	return errors.As(err, &known) && known.code == CodeUnauthorized
}

func storePath(dataDir string, fbid int64) string {
	return filepath.Join(dataDir, strconv.FormatInt(fbid, 10)+".db")
}

// openStore opens the account's e2ee keys: one SQLite file per Facebook account.
func openStore(ctx context.Context, dataDir string, fbid int64, log zerolog.Logger) (*sqlstore.Container, error) {
	address := "file:" + storePath(dataDir, fbid) + "?_foreign_keys=on&_journal_mode=WAL&_busy_timeout=5000"
	container, err := sqlstore.New(ctx, "sqlite3", address, waLog.Zerolog(log))
	if err != nil {
		if ctx.Err() != nil {
			return nil, fail(CodeUnavailable, "Stopped before the device store opened", err)
		}
		return nil, fail(CodeInternal, "Could not open the device store", err)
	}
	return container, nil
}

// findDevice is Huginn's registered Messenger device for that account, or nil.
func findDevice(ctx context.Context, container *sqlstore.Container, fbid int64) (*store.Device, error) {
	devices, err := container.GetAllDevices(ctx)
	if err != nil {
		return nil, fail(CodeInternal, "Could not read the device store", err)
	}
	user := strconv.FormatInt(fbid, 10)
	for _, device := range devices {
		if device.ID != nil && device.ID.User == user && device.ID.Server == waTypes.MessengerServer {
			return device, nil
		}
	}
	return nil, nil
}

// session is the helper's one account: a login, then at most one connection at a time.
type session struct {
	log      zerolog.Logger
	libLog   zerolog.Logger
	out      *output
	dataDir  string
	dir      *directory
	opMu     sync.Mutex
	cancelMu sync.Mutex
	pending  context.CancelFunc
	conn     *connection
}

func newSession(log, libLog zerolog.Logger, out *output, dataDir string) *session {
	return &session{log: log, libLog: libLog, out: out, dataDir: dataDir, dir: newDirectory()}
}

// login checks the cookies against Facebook and registers Huginn as a Messenger device of
// the account, unless it already is one. It does not stay connected.
func (s *session) login(ctx context.Context, raw map[string]string) (*loginResult, error) {
	c, err := parseCookies(raw)
	if err != nil {
		return nil, err
	}
	client := newMessagix(c, s.libLog)
	user, _, err := client.LoadMessagesPage(ctx)
	if err != nil {
		return nil, loadError(err)
	}
	fbid := user.GetFBID()
	if fbid != c.GetUserID() {
		return nil, fail(CodeUnauthorized, "Facebook loaded a different account than the cookies name — log in again", nil)
	}
	container, err := openStore(ctx, s.dataDir, fbid, s.libLog)
	if err != nil {
		return nil, err
	}
	defer container.Close()
	device, err := findDevice(ctx, container, fbid)
	if err != nil {
		return nil, err
	}
	if device == nil {
		device = container.NewDevice()
		client.SetDevice(device)
		if err := client.RegisterE2EE(ctx, fbid); err != nil {
			return nil, fail(CodeUnavailable, "Messenger did not accept Huginn as a new device", err)
		}
		if err := device.Save(ctx); err != nil {
			return nil, fail(CodeInternal, "Could not save the device keys", err)
		}
		s.log.Info().Uint16("device", device.ID.Device).Msg("registered as a Messenger device")
	}
	return &loginResult{
		UserID:  strconv.FormatInt(fbid, 10),
		Name:    user.GetName(),
		Cookies: cookieMap(client.GetCookies()),
	}, nil
}

// connect replaces any connection with a new one. start, called once the answer is out,
// lets the events flow, so the result line always comes before them.
func (s *session) connect(ctx context.Context, raw map[string]string) (*accountResult, func(), error) {
	s.disconnect()

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	s.cancelMu.Lock()
	s.pending = cancel
	s.cancelMu.Unlock()
	defer func() {
		s.cancelMu.Lock()
		s.pending = nil
		s.cancelMu.Unlock()
	}()

	s.opMu.Lock()
	defer s.opMu.Unlock()

	c, err := parseCookies(raw)
	if err != nil {
		return nil, nil, err
	}
	fbid := c.GetUserID()
	notDevice := fail(CodeUnauthorized, "Huginn is not a Messenger device of this account any more — log in again", nil)
	// Only login creates a store; connect never leaves an empty one behind.
	if _, err := os.Stat(storePath(s.dataDir, fbid)); err != nil {
		return nil, nil, notDevice
	}
	container, err := openStore(ctx, s.dataDir, fbid, s.libLog)
	if err != nil {
		return nil, nil, err
	}
	device, err := findDevice(ctx, container, fbid)
	if err != nil || device == nil {
		_ = container.Close()
		if err == nil {
			err = notDevice
		}
		return nil, nil, err
	}

	conn := newConnection(s, fbid, container, device)
	result, err := conn.open(ctx, c)
	if err != nil {
		conn.close()
		return nil, nil, err
	}
	s.conn = conn
	return result, conn.start, nil
}

func (s *session) disconnect() {
	s.cancelMu.Lock()
	if s.pending != nil {
		s.pending()
	}
	s.cancelMu.Unlock()

	s.opMu.Lock()
	defer s.opMu.Unlock()
	if s.conn != nil {
		s.conn.close()
		s.conn = nil
	}
}
