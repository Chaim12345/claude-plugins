// Package ai is the app's language-model work, in Go: an OpenAI-compatible client (Gemini's free
// tier, OpenRouter, Groq or any compatible URL), a paced batch runner, product classification with a
// delta store on disk, and the "check at the till" deal checks. It runs on the phone inside the Go
// engine; the UI only shows its status and results.
package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/shared"
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

// Tool is a function the model must call: its arguments, checked against Schema, are the answer.
// Every AI task in the app is one tool (record_products, record_verdicts, ...), so answers arrive as
// structured arguments instead of free text to be parsed.
type Tool struct {
	Name        string
	Description string
	Schema      map[string]any // JSON schema of the arguments (an object)
}

// Client calls an OpenAI-compatible API through OpenAI's official Go SDK (openai-go), with a custom
// base URL: Gemini's OpenAI endpoint, OpenRouter, Groq, or a local server.
type Client struct {
	HTTP *http.Client

	mu     sync.Mutex
	noTool map[string]bool // base URLs that rejected tool calls: JSON mode instead
}

var DefaultClient = &Client{HTTP: &http.Client{}}

func endpoint(base, path string) string {
	return strings.TrimRight(strings.TrimSpace(base), "/") + path
}

func (cl *Client) sdk(c Config) openai.Client {
	opts := []option.RequestOption{option.WithBaseURL(strings.TrimRight(strings.TrimSpace(c.BaseURL), "/") + "/"), option.WithHTTPClient(cl.HTTP), option.WithMaxRetries(1)}
	if k := strings.TrimSpace(c.Key); k != "" {
		opts = append(opts, option.WithAPIKey(k))
	} else {
		opts = append(opts, option.WithAPIKey("none"))
	}
	if c.Preset == "openrouter" {
		opts = append(opts, option.WithHeader("X-Title", "Salzol"))
	}
	return openai.NewClient(opts...)
}

// sdkErr turns an SDK error into the app's Error (Hebrew message, kind for the runner).
func sdkErr(ctx context.Context, err error) *Error {
	var ae *openai.Error
	if errors.As(err, &ae) {
		ra := ""
		if ae.Response != nil {
			ra = ae.Response.Header.Get("Retry-After")
		}
		return errorOf(ae.StatusCode, []byte(ae.RawJSON()), ra)
	}
	if errors.Is(ctx.Err(), context.Canceled) {
		return &Error{Msg: "בוטל", Kind: "network"}
	}
	return &Error{Msg: "אין חיבור לשרת: " + shortErr(err), Kind: "network", RetryAfter: 10 * time.Second}
}

func shortErr(err error) string {
	s := err.Error()
	if len(s) > 120 {
		s = s[:120]
	}
	return s
}

func messages(msgs []Message) []openai.ChatCompletionMessageParamUnion {
	var out []openai.ChatCompletionMessageParamUnion
	for _, m := range msgs {
		switch m.Role {
		case "system":
			out = append(out, openai.SystemMessage(m.Content))
		case "assistant":
			out = append(out, openai.AssistantMessage(m.Content))
		default:
			out = append(out, openai.UserMessage(m.Content))
		}
	}
	return out
}

// CallTool asks the model to answer by calling tool (forced), and returns the call's arguments. When
// the provider rejects tools, or answers without calling it, the same request is repeated once in JSON
// mode with the schema in the prompt, and that provider is asked in JSON mode from then on.
// No max_tokens is sent: every request may use the model's whole output limit.
func (cl *Client) CallTool(ctx context.Context, c Config, msgs []Message, tool Tool, timeout time.Duration) (json.RawMessage, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	base := strings.TrimSpace(c.BaseURL)
	cl.mu.Lock()
	jsonMode := cl.noTool[base]
	cl.mu.Unlock()
	if !jsonMode {
		params := openai.ChatCompletionNewParams{
			Model:       strings.TrimSpace(c.Model),
			Messages:    messages(msgs),
			Temperature: openai.Float(0),
			Tools: []openai.ChatCompletionToolUnionParam{openai.ChatCompletionFunctionTool(shared.FunctionDefinitionParam{
				Name: tool.Name, Description: openai.String(tool.Description), Parameters: shared.FunctionParameters(tool.Schema),
			})},
			ToolChoice: openai.ToolChoiceOptionFunctionToolChoice(openai.ChatCompletionNamedToolChoiceFunctionParam{Name: tool.Name}),
		}
		cli := cl.sdk(c)
		res, err := cli.Chat.Completions.New(ctx, params)
		if err == nil && len(res.Choices) > 0 {
			for _, tc := range res.Choices[0].Message.ToolCalls {
				if tc.Function.Name == tool.Name && strings.TrimSpace(tc.Function.Arguments) != "" {
					return json.RawMessage(tc.Function.Arguments), nil
				}
			}
			// answered in text: maybe JSON anyway
			if m := ParseJSON(res.Choices[0].Message.Content); m != nil {
				b, _ := json.Marshal(m)
				return b, nil
			}
		}
		if err != nil {
			e := sdkErr(ctx, err)
			if e.Status >= 500 && ctx.Err() == nil {
				// Gemini sometimes fails while generating a long tool call (an empty 503: its
				// "malformed function call"); the same request is deterministic at temperature 0,
				// so this one request is asked again in JSON mode instead of retried as is.
				if args, jerr := cl.jsonMode(ctx, c, msgs, tool); jerr == nil {
					return args, nil
				}
				return nil, e
			}
			if e.Status != 400 || !strings.Contains(strings.ToLower(e.Msg), "tool") && !strings.Contains(strings.ToLower(e.Msg), "function") {
				return nil, e
			}
		}
		cl.mu.Lock()
		if cl.noTool == nil {
			cl.noTool = map[string]bool{}
		}
		cl.noTool[base] = true // this provider/model doesn't do forced tool calls: JSON mode
		cl.mu.Unlock()
	}
	return cl.jsonMode(ctx, c, msgs, tool)
}

// jsonMode asks for the tool's arguments as a JSON object in the reply (response_format json_object),
// the schema given in the prompt: for providers or requests where forced tool calls fail.
func (cl *Client) jsonMode(ctx context.Context, c Config, msgs []Message, tool Tool) (json.RawMessage, error) {
	schema, _ := json.Marshal(tool.Schema)
	jm := append(append([]Message(nil), msgs...), Message{"user", "Answer with one JSON object only, no other text, matching this JSON schema (the arguments of " + tool.Name + "): " + string(schema)})
	params := openai.ChatCompletionNewParams{
		Model: strings.TrimSpace(c.Model), Messages: messages(jm), Temperature: openai.Float(0),
		ResponseFormat: openai.ChatCompletionNewParamsResponseFormatUnion{OfJSONObject: &shared.ResponseFormatJSONObjectParam{}},
	}
	cli := cl.sdk(c)
	res, err := cli.Chat.Completions.New(ctx, params)
	if err != nil {
		return nil, sdkErr(ctx, err)
	}
	if len(res.Choices) == 0 {
		return nil, &Error{Msg: "התשובה הגיעה ריקה", Kind: "bad"}
	}
	m := ParseJSON(res.Choices[0].Message.Content)
	if m == nil {
		return nil, &Error{Msg: "המודל לא ענה בפורמט הנדרש", Kind: "bad"}
	}
	b, _ := json.Marshal(m)
	return b, nil
}

// Models lists the provider's chat models, the preset's preferred ones first.
func (cl *Client) Models(ctx context.Context, c Config) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	cli := cl.sdk(c)
	page, err := cli.Models.List(ctx)
	if err != nil {
		return nil, sdkErr(ctx, err)
	}
	var out []string
	for _, m := range page.Data {
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

var notChat = regexp.MustCompile(`(?i)embed|tts|whisper|audio|image|imagen|veo|aqa|guard|moderation|lyria|robotics|live|transcribe|computer-use|deep-research`)

// StatusTool is the connection test: a model that can call it can do the app's tasks.
var StatusTool = Tool{Name: "report_status", Description: "Report that you received the request.", Schema: map[string]any{
	"type": "object", "properties": map[string]any{"ok": map[string]any{"type": "boolean", "description": "always true"}}, "required": []string{"ok"},
}}

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
		return &Error{Msg: fmt.Sprintf("שגיאת שרת אצל הספק (%d)%s", status, suffix), Status: status, RetryAfter: wait, Kind: "network"}
	}
	return &Error{Msg: fmt.Sprintf("שגיאה %d%s", status, suffix), Status: status, Kind: "bad"}
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

// Run sends n requests one after another at the provider's pace, each answered by a forced call to
// tool, retrying after "too many requests" or a server error and stopping on anything else. Returns
// the error message when it stopped early.
func Run(ctx context.Context, cl *Client, c Config, n int, tool Tool, ask func(i int) []Message, onAnswer func(i int, args json.RawMessage), onProgress func(done int), timeout time.Duration, wait func(context.Context, time.Duration)) string {
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
			args, err := cl.CallTool(ctx, c, ask(i), tool, timeout)
			if err == nil {
				onAnswer(i, args)
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
