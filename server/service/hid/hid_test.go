package hid

import (
	"testing"
	"time"
)

func TestReportLengthValidation(t *testing.T) {
	h := &Hid{}
	if err := h.WriteKeyboardReport(make([]byte, 7)); err == nil {
		t.Fatal("expected keyboard length error")
	}
	if err := h.WriteRelativeMouseReport(make([]byte, 5)); err == nil {
		t.Fatal("expected relative mouse length error")
	}
	if err := h.WriteAbsoluteMouseReport(make([]byte, 7)); err == nil {
		t.Fatal("expected absolute mouse length error")
	}
}

func TestSwedishCharMap(t *testing.T) {
	m := GetCharMap("se")

	want := map[rune]Char{
		'å':  {0, 47},
		'Ä':  {2, 52},
		'ö':  {0, 51},
		'/':  {2, 36},
		'=':  {2, 39},
		'@':  {0x40, 31},
		'{':  {0x40, 36},
		'\\': {0x40, 45},
		'+':  {0, 45},
		'?':  {2, 45},
		'\'': {0, 49},
		'*':  {2, 49},
		'<':  {0, 100},
		'|':  {0x40, 100},
		';':  {2, 54},
		'-':  {0, 56},
	}
	for r, expected := range want {
		got, ok := m[r]
		if !ok {
			t.Errorf("rune %q missing from Swedish char map", r)
			continue
		}
		if got != expected {
			t.Errorf("rune %q = %+v, want %+v", r, got, expected)
		}
	}

	// Dead keys must only exist as sequences, not as single strokes that
	// would type the wrong glyph.
	for _, r := range "`^~" {
		if _, ok := m[r]; ok {
			t.Errorf("dead key %q should not be in the single-stroke Swedish map", r)
		}
	}

	seq := langueSequences("se")
	for _, r := range "`^~´¨éÉ" {
		strokes, ok := seq[r]
		if !ok {
			t.Errorf("rune %q missing from Swedish sequence map", r)
			continue
		}
		if len(strokes) != 2 {
			t.Errorf("rune %q sequence length = %d, want 2", r, len(strokes))
		}
	}
	if got := seq['~'][0]; got != (Char{0x40, 48}) {
		t.Errorf("tilde dead key = %+v, want {64 48}", got)
	}

	if langueSequences("") != nil {
		t.Error("default layout should have no sequences")
	}
}

func TestPasteDurationLeavesModeSwitchMargin(t *testing.T) {
	if maxPasteDuration >= 30*time.Second {
		t.Fatalf("maxPasteDuration = %s, want below 30s mode switch wait budget", maxPasteDuration)
	}
	if got := time.Duration(maxPasteContentRunes) * defaultPasteDelay; got > maxPasteDuration {
		t.Fatalf("max paste content duration = %s, want <= %s", got, maxPasteDuration)
	}
}
