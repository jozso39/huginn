package main

import (
	"errors"
	"regexp"
	"testing"
)

func TestCookiesWithoutTheSessionAreRefused(t *testing.T) {
	_, err := parseCookies(map[string]string{"c_user": "100"})

	var known *helperError
	if !errors.As(err, &known) || known.code != CodeUnauthorized {
		t.Fatalf("want Unauthorized, got %v", err)
	}
	if _, err := parseCookies(nil); toRPCError(err).Code != CodeValidation {
		t.Errorf("no cookies at all is a broken request, got %v", err)
	}
}

func TestCookiesRoundTrip(t *testing.T) {
	raw := map[string]string{"xs": "a", "c_user": "100", "datr": "b", "fr": "c"}
	c, err := parseCookies(raw)
	if err != nil {
		t.Fatal(err)
	}
	if c.GetUserID() != 100 {
		t.Errorf("want user 100, got %d", c.GetUserID())
	}
	if got := cookieMap(c); len(got) != 4 || got["fr"] != "c" {
		t.Errorf("every cookie given is kept, got %v", got)
	}
}

func TestInfoDescribesTheLoginWindow(t *testing.T) {
	got := info()
	if got.UserAgent == "" || got.LoginURL != "https://www.facebook.com/" {
		t.Errorf("unexpected %+v", got)
	}
	if len(got.RequiredCookies) != 3 {
		t.Errorf("want xs, c_user and datr, got %v", got.RequiredCookies)
	}
	done := regexp.MustCompile(got.DoneURLPattern)
	for _, url := range []string{"https://www.facebook.com/", "https://www.facebook.com/messages/e2ee/t/123", "https://www.facebook.com/?sk=h_chr"} {
		if !done.MatchString(url) {
			t.Errorf("%s means logged in", url)
		}
	}
	for _, url := range []string{"https://www.facebook.com/login/", "https://www.facebook.com/checkpoint/"} {
		if done.MatchString(url) {
			t.Errorf("%s is still logging in", url)
		}
	}
}

func TestUnknownErrorsAreInternal(t *testing.T) {
	if got := toRPCError(errors.New("boom")); got.Code != CodeInternal || got.Message != "boom" {
		t.Errorf("unexpected %+v", got)
	}
	wrapped := fail(CodeUnavailable, "Could not load Messenger", errors.New("dial tcp: timeout"))
	if got := toRPCError(wrapped); got.Code != CodeUnavailable || got.Message != "Could not load Messenger" {
		t.Errorf("the cause stays in the log, got %+v", got)
	}
}
