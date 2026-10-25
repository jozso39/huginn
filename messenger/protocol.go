package main

import (
	"encoding/json"
	"errors"
	"os"
	"sync"
)

// One line per request on stdin; the answer carries the same id.
type request struct {
	ID     int64           `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type rpcError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type response struct {
	ID     int64     `json:"id"`
	Result any       `json:"result,omitempty"`
	Error  *rpcError `json:"error,omitempty"`
}

// What the server can do about a failure: log in again, try later, fix the request, or report it.
const (
	CodeUnauthorized = "Unauthorized"
	CodeUnavailable  = "Unavailable"
	CodeValidation   = "Validation"
	CodeInternal     = "Internal"
)

// helperError is a failure the server is told about; err stays in the helper's log.
type helperError struct {
	code    string
	message string
	err     error
}

func (e *helperError) Error() string {
	if e.err != nil {
		return e.message + ": " + e.err.Error()
	}
	return e.message
}

func (e *helperError) Unwrap() error { return e.err }

func fail(code, message string, err error) *helperError {
	return &helperError{code: code, message: message, err: err}
}

func toRPCError(err error) *rpcError {
	var known *helperError
	if errors.As(err, &known) {
		return &rpcError{Code: known.code, Message: known.message}
	}
	return &rpcError{Code: CodeInternal, Message: err.Error()}
}

type cookieParams struct {
	Cookies map[string]string `json:"cookies"`
}

type infoResult struct {
	UserAgent       string   `json:"userAgent"`
	LoginURL        string   `json:"loginUrl"`
	RequiredCookies []string `json:"requiredCookies"`
	DoneURLPattern  string   `json:"doneUrlPattern"`
}

type accountResult struct {
	UserID string `json:"userId"`
	Name   string `json:"name"`
}

type loginResult struct {
	UserID  string            `json:"userId"`
	Name    string            `json:"name"`
	Cookies map[string]string `json:"cookies"`
}

type messageEvent struct {
	Type       string  `json:"type"`
	ID         string  `json:"id"`
	ThreadID   string  `json:"threadId"`
	Encrypted  bool    `json:"encrypted"`
	IsGroup    bool    `json:"isGroup"`
	ThreadName *string `json:"threadName"`
	SenderID   string  `json:"senderId"`
	SenderName *string `json:"senderName"`
	FromMe     bool    `json:"fromMe"`
	Text       string  `json:"text"`
	Timestamp  int64   `json:"timestamp"`
	ReplyToID  *string `json:"replyToId"`
	Initial    bool    `json:"initial"`
	URL        string  `json:"url"`
}

type readEvent struct {
	Type      string `json:"type"`
	ThreadID  string `json:"threadId"`
	Timestamp int64  `json:"timestamp"`
}

type cookiesEvent struct {
	Type    string            `json:"type"`
	Cookies map[string]string `json:"cookies"`
}

type stateEvent struct {
	Type   string `json:"type"`
	Reason string `json:"reason,omitempty"`
}

type eventLine struct {
	Event any `json:"event"`
}

// output writes whole lines, one writer at a time: the socket, the e2ee client and
// request handlers all answer from their own goroutines.
type output struct {
	mu   sync.Mutex
	file *os.File
}

func (o *output) send(v any) {
	line, err := json.Marshal(v)
	if err != nil {
		line, _ = json.Marshal(response{Error: &rpcError{Code: CodeInternal, Message: "unencodable line"}})
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	_, _ = o.file.Write(append(line, '\n'))
}

func (o *output) result(id int64, result any) {
	o.send(response{ID: id, Result: result})
}

func (o *output) failure(id int64, err error) {
	o.send(response{ID: id, Error: toRPCError(err)})
}

func (o *output) event(evt any) {
	o.send(eventLine{Event: evt})
}
