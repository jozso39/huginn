// huginn-messenger is Huginn's line to Facebook Messenger: it joins the user's own account
// as a Messenger device and passes messages on as JSON lines. Requests come on stdin,
// answers and events go to stdout, logs to stderr. Built on mautrix-meta's messagix.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog"
)

// Facebook's first page load alone can take half a minute.
const requestTimeout = 2 * time.Minute

// Room for a line full of cookies.
const maxLine = 1 << 20

// newLoggers: Huginn's own lines at info; the libraries only when something broke, because
// their warnings can dump whole sync tables, message text included. HUGINN_MESSENGER_LOG=debug
// opens everything up (and may log message content).
func newLoggers() (own, lib zerolog.Logger) {
	base := zerolog.New(os.Stderr).With().Timestamp().Logger()
	if strings.EqualFold(os.Getenv("HUGINN_MESSENGER_LOG"), "debug") {
		debug := base.Level(zerolog.DebugLevel)
		return debug, debug
	}
	return base.Level(zerolog.InfoLevel), base.With().Str("component", "lib").Logger().Level(zerolog.ErrorLevel)
}

func main() {
	dataDir := flag.String("data", "", "where the account's Messenger device keys are kept")
	flag.Parse()
	if *dataDir == "" {
		fmt.Fprintln(os.Stderr, "usage: huginn-messenger --data <dir>")
		os.Exit(2)
	}
	log, libLog := newLoggers()
	if err := os.MkdirAll(*dataDir, 0o700); err != nil {
		log.Fatal().Err(err).Msg("cannot create the data directory")
	}

	out := &output{file: os.Stdout}
	s := newSession(log, libLog, out, *dataDir)
	var handlers sync.WaitGroup

	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64*1024), maxLine)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var req request
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			log.Warn().Err(err).Msg("unreadable request line")
			out.failure(0, fail(CodeValidation, "unreadable request line", nil))
			continue
		}
		handlers.Add(1)
		go func() {
			defer handlers.Done()
			handle(s, out, req)
		}()
	}
	if err := scanner.Err(); err != nil {
		log.Warn().Err(err).Msg("stdin failed")
	}
	// stdin closed: Huginn is gone, so is the account's connection.
	s.disconnect()
	waitBriefly(&handlers, 5*time.Second)
}

func handle(s *session, out *output, req request) {
	ctx, cancel := context.WithTimeout(context.Background(), requestTimeout)
	defer cancel()

	switch req.Method {
	case "info":
		out.result(req.ID, info())
	case "login":
		var params cookieParams
		if err := json.Unmarshal(req.Params, &params); err != nil {
			out.failure(req.ID, fail(CodeValidation, "params must be {cookies: {...}}", err))
			return
		}
		result, err := s.login(ctx, params.Cookies)
		if err != nil {
			s.log.Warn().Err(err).Msg("login failed")
			out.failure(req.ID, err)
			return
		}
		out.result(req.ID, result)
	case "connect":
		var params cookieParams
		if err := json.Unmarshal(req.Params, &params); err != nil {
			out.failure(req.ID, fail(CodeValidation, "params must be {cookies: {...}}", err))
			return
		}
		result, start, err := s.connect(ctx, params.Cookies)
		if err != nil {
			s.log.Warn().Err(err).Msg("connect failed")
			out.failure(req.ID, err)
			return
		}
		out.result(req.ID, result)
		start()
	case "disconnect":
		s.disconnect()
		out.result(req.ID, struct{}{})
	default:
		out.failure(req.ID, fail(CodeValidation, "unknown method "+req.Method, nil))
	}
}

func waitBriefly(group *sync.WaitGroup, limit time.Duration) {
	done := make(chan struct{})
	go func() {
		group.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(limit):
	}
}
