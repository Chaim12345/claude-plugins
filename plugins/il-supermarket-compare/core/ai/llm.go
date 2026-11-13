// Package ai is the app's language-model work, in Go: an OpenAI-compatible client (Gemini's free
// tier, OpenRouter, Groq or any compatible URL), a paced batch runner, product classification with a
// delta store on disk, and the "check at the till" deal checks. It runs on the phone inside the Go
// engine; the UI only shows its status and results.
package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Config is the user's AI setting.
type Config struct {
	On          bool   `json:"on"`
	Preset      string `json:"preset"` // "gemini", "openrouter", "groq", "custom"
	BaseURL     string `json:"baseUrl"`
	Model       string `json:"model"`
	Key         string `json:"key"`
	EnrichModel string `json:"enrichModel"` // "" = the default for the preset
	EnrichAuto  bool   `json:"enrichAuto"`  // classify new products in the background
	DailyCap    int    `json:"dailyCap"`    // classification requests per day
}

// Preset is a provider's defaults.
type Preset struct {
	Label, BaseURL, Model, KeyURL, EnrichModel string
	RPM                                        int // requests per minute to stay under
}

var Presets = map[string]Preset{
	"gemini":     {"Gemini (חינם)", "https://generativelanguage.googleapis.com/v1beta/openai", "gemini-flash-lite-latest", "https://aistudio.google.com/apikey", "gemini-4-hydrogen", 10},
	"openrouter": {"OpenRouter", "https://openrouter.ai/api/v1", "", "https://openrouter.ai/keys", "", 15},
	"groq":       {"Groq", "https://api.groq.com/openai/v1", "", "https://console.groq.com/keys", "", 25},
	"custom":     {"אחר (תואם OpenAI)", "", "", "", "", 20},
}

func DefaultConfig() Config {
	p := Presets["gemini"]
	return Config{Preset: "gemini", BaseURL: p.BaseURL, Model: p.Model, EnrichAuto: true, DailyCap: 300}
}

func (c Config) preset() Preset {
	if p, ok := Presets[c.Preset]; ok {
		return p
	}
	return Presets["custom"]
}

// Usable: on, with a model, an https URL and a key (a custom local server may have none).
func (c Config) Usable() bool {
	return c.On && strings.TrimSpace(c.Model) != "" && ValidURL(c.BaseURL) && (strings.TrimSpace(c.Key) != "" || c.Preset == "custom")
}

// ForEnrich is the config for classification: its own model when the user chose one, else the
// preset's most accurate one (gemini-4-hydrogen on Gemini's own URL), else the main model.
func (c Config) ForEnrich() Config {
	switch {
	case strings.TrimSpace(c.EnrichModel) != "":
		c.Model = strings.TrimSpace(c.EnrichModel)
	case c.preset().EnrichModel != "" && c.BaseURL == c.preset().BaseURL:
		c.Model = c.preset().EnrichModel
	}
	return c
}

var urlRx = regexp.MustCompile(`^(https://[^\s/]+|http://(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?)(/|$)`)

func ValidURL(u string) bool { return urlRx.MatchString(strings.TrimSpace(u)) }

// Message is a chat message.
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// Error kinds the runner acts on.
type Error struct {
	Msg        string
	Status     int
	RetryAfter time.Duration
	Kind       string // "auth", "quota", "model", "network", "bad"
}

func (e *Error) Error() string { return e.Msg }

// Client calls an OpenAI-compatible API.
type Client struct {
	HTTP *http.Client
}

var DefaultClient = &Client{HTTP: &http.Client{}}

func endpoint(base, path string) string {
	return strings.TrimRight(strings.TrimSpace(base), "/") + path
}

func (cl *Client) do(ctx context.Context, c Config, method, path string, body any, timeout time.Duration) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint(c.BaseURL, path), rd)
	if err != nil {
		return nil, &Error{Msg: "כתובת לא תקינה", Kind: "bad"}
	}
	req.Header.Set("Content-Type", "application/json")
	if k := strings.TrimSpace(c.Key); k != "" {
		req.Header.Set("Authorization", "Bearer "+k)
	}
	if c.Preset == "openrouter" {
		req.Header.Set("X-Title", "Salzol")
	}
	res, err := cl.HTTP.Do(req)
	if err != nil {
		if errors.Is(ctx.Err(), context.Canceled) {
			return nil, &Error{Msg: "בוטל", Kind: "network"}
		}
		return nil, &Error{Msg: "אין חיבור לשרת: " + shortErr(err), Kind: "network", RetryAfter: 10 * time.Second}
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if res.StatusCode >= 300 {
		return nil, errorOf(res.StatusCode, b, res.Header.Get("Retry-After"))
	}
	return b, nil
}

func shortErr(err error) string {
	s := err.Error()
	if len(s) > 120 {
		s = s[:120]
	}
	return s
}

var keyRx = regexp.MustCompile(`(?i)(key|token)[=:]\s*\S+`)

// errorOf turns an HTTP error into a short Hebrew message and a kind. Never echoes the key.
func errorOf(status int, body []byte, retryAfter string) *Error {
	var detail string
	var j any
	if json.Unmarshal(body, &j) == nil {
		if a, ok := j.([]any); ok && len(a) > 0 { // Gemini wraps errors in an array
			j = a[0]
		}
		if m, ok := j.(map[string]any); ok {
			if e, ok := m["error"].(map[string]any); ok {
				detail, _ = e["message"].(string)
			} else if s, ok := m["message"].(string); ok {
				detail = s
			}
		}
	} else {
		detail = string(body)
	}
	if len(detail) > 160 {
		detail = detail[:160]
	}
	detail = keyRx.ReplaceAllString(detail, "$1=…")
	suffix := ""
	if detail != "" {
		suffix = ": " + detail
	}
	secs, _ := strconv.Atoi(strings.TrimSpace(retryAfter))
	wait := time.Duration(secs) * time.Second
	switch {
	case status == 401 || status == 403:
		return &Error{Msg: fmt.Sprintf("המפתח לא התקבל (%d)%s", status, suffix), Status: status, Kind: "auth"}
	case status == 429:
		if wait == 0 {
			wait = 20 * time.Second
		}
		return &Error{Msg: "הגעתם למגבלת הבקשות של הספק" + suffix, Status: status, RetryAfter: wait, Kind: "quota"}
	case status == 404:
		return &Error{Msg: "המודל או הכתובת לא נמצאו (404)" + suffix, Status: status, Kind: "model"}
	case status == 400 && strings.Contains(strings.ToLower(detail), "model"):
		return &Error{Msg: "בעיה בשם המודל" + suffix, Status: status, Kind: "model"}
	case status >= 500:
		if wait == 0 {
			wait = 10 * time.Second
		}
		return &Error{Msg: fmt.Sprintf("שגיאת שרת אצל הספק (%d)", status), Status: status, RetryAfter: wait, Kind: "network"}
	}
	return &Error{Msg: fmt.Sprintf("שגיאה %d%s", status, suffix), Status: status, Kind: "bad"}
}

// Chat is one completion at temperature 0; returns the text.
func (cl *Client) Chat(ctx context.Context, c Config, msgs []Message, maxTokens int, timeout time.Duration) (string, error) {
	b, err := cl.do(ctx, c, "POST", "/chat/completions", map[string]any{"model": strings.TrimSpace(c.Model), "messages": msgs, "temperature": 0, "max_tokens": maxTokens}, timeout)
	if err != nil {
		return "", err
	}
	var r struct {
		Choices []struct {
			Message struct {
				Content json.RawMessage `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if json.Unmarshal(b, &r) != nil || len(r.Choices) == 0 {
		return "", &Error{Msg: "תשובה לא תקינה מהשרת", Kind: "bad"}
	}
	var s string
	if json.Unmarshal(r.Choices[0].Message.Content, &s) != nil { // a few servers send parts
		var parts []struct {
			Text string `json:"text"`
		}
		json.Unmarshal(r.Choices[0].Message.Content, &parts)
		for _, p := range parts {
			s += p.Text
		}
	}
	if s == "" {
		return "", &Error{Msg: "התשובה הגיעה ריקה", Kind: "bad"}
	}
	return s, nil
}

var notChat = regexp.MustCompile(`(?i)embed|tts|whisper|audio|image|imagen|veo|aqa|guard|moderation|lyria|robotics|live|transcribe|computer-use|deep-research`)

// Models lists the provider's chat models, the preset's preferred ones first.
func (cl *Client) Models(ctx context.Context, c Config) ([]string, error) {
	b, err := cl.do(ctx, c, "GET", "/models", nil, 20*time.Second)
	if err != nil {
		return nil, err
	}
	var r struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	json.Unmarshal(b, &r)
	var out []string
	for _, m := range r.Data {
		id := strings.TrimPrefix(m.ID, "models/")
		if id != "" && !notChat.MatchString(id) {
			out = append(out, id)
		}
	}
	pref := func(id string) bool {
		switch c.Preset {
		case "gemini":
			return strings.Contains(id, "flash") || strings.Contains(id, "hydrogen")
		case "openrouter":
			return strings.HasSuffix(id, ":free")
		}
		return false
	}
	sort.SliceStable(out, func(a, b int) bool {
		if pref(out[a]) != pref(out[b]) {
			return pref(out[a])
		}
		return out[a] < out[b]
	})
	return out, nil
}

// ParseJSON reads a JSON object out of a model's answer, tolerating code fences and text around it.
func ParseJSON(text string) map[string]json.RawMessage {
	t := strings.TrimSpace(strings.NewReplacer("```json", "", "```JSON", "", "```", "").Replace(text))
	var m map[string]json.RawMessage
	if json.Unmarshal([]byte(t), &m) == nil {
		return m
	}
	a, b := strings.Index(t, "{"), strings.LastIndex(t, "}")
	if a >= 0 && b > a && json.Unmarshal([]byte(t[a:b+1]), &m) == nil {
		return m
	}
	return nil
}

// Run sends n requests one after another at the provider's pace, retrying after "too many requests"
// or a server error, and stopping on anything else. Returns the error message when it stopped early.
func Run(ctx context.Context, cl *Client, c Config, n int, ask func(i int) []Message, onAnswer func(i int, json map[string]json.RawMessage), onProgress func(done int), maxTokens int, timeout time.Duration, wait func(context.Context, time.Duration)) string {
	if wait == nil {
		wait = func(ctx context.Context, d time.Duration) {
			select {
			case <-ctx.Done():
			case <-time.After(d):
			}
		}
	}
	gap := time.Minute / time.Duration(max(c.preset().RPM, 1))
	for i := 0; i < n && ctx.Err() == nil; i++ {
		if i > 0 {
			wait(ctx, gap)
		}
		for tries := 0; ; tries++ {
			text, err := cl.Chat(ctx, c, ask(i), maxTokens, timeout)
			if err == nil {
				onAnswer(i, ParseJSON(text))
				break
			}
			if ctx.Err() != nil {
				return ""
			}
			var e *Error
			if errors.As(err, &e) && (e.Kind == "quota" || e.Kind == "network") && tries < 3 && e.RetryAfter > 0 {
				wait(ctx, min(e.RetryAfter, 65*time.Second))
				continue
			}
			return err.Error()
		}
		if onProgress != nil {
			onProgress(i + 1)
		}
	}
	return ""
}
