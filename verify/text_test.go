package verify

import (
	"crypto/sha256"
	"encoding/hex"
	"slices"
	"strings"
	"testing"
	"unicode/utf8"
)

// textGolden is testdata/golden/text.json: the bounded-text functions' recorded results for fixed
// inputs. The inputs are every `in`, `n`, `cap[].len` and `cap[].kind`. `go test -update`
// rewrites `cut[].out`, `excerpt[].out`, `tail[].out`, `cap[].out_len` and `cap[].out_hash`, and
// for `split[]` either `out` (the words) or `error` (the error text), whichever shellWords now
// produces. No other byte of the file is rewritten.
type textGolden struct {
	Cut []struct{ In, Out string } `json:"cut"`

	Excerpt []struct{ In, Out string } `json:"excerpt"`
	Tail    []struct {
		In  string
		N   int
		Out string
	} `json:"tail"`
	Cap []struct {
		Len     int
		Kind    string
		OutLen  int    `json:"out_len"`
		OutHash string `json:"out_hash"`
	} `json:"cap"`
	Split []struct {
		In    string
		Out   []string
		Error string
	} `json:"split"`
}

func TestBoundedTextsEqualTheElixirReference(t *testing.T) {
	var g textGolden
	readGolden(t, "text.json", &g)
	if len(g.Cut) == 0 || len(g.Tail) == 0 || len(g.Cap) == 0 || len(g.Split) == 0 {
		t.Fatal("empty reference data")
	}
	edits := goldenUpdates(t, "text.json")
	for i, c := range g.Cut {
		if got := Cut(c.In); got != c.Out {
			if edits != nil {
				edits.set(got, "cut", i, "out")
				continue
			}
			t.Errorf("Cut case %d (%d bytes): got %d bytes, want %d", i, len(c.In), len(got), len(c.Out))
		}
	}
	for i, c := range g.Excerpt {
		if got := Excerpt(c.In); got != c.Out {
			if edits != nil {
				edits.set(got, "excerpt", i, "out")
				continue
			}
			t.Errorf("Excerpt case %d: got %q, want %q", i, got, c.Out)
		}
	}
	for i, c := range g.Tail {
		if got := Tail(c.In, c.N); got != c.Out {
			if edits != nil {
				edits.set(got, "tail", i, "out")
				continue
			}
			t.Errorf("Tail case %d (n=%d): got %q, want %q", i, c.N, got, c.Out)
		}
	}
	for i, c := range g.Cap {
		var in string
		switch c.Kind {
		case "x", "a":
			in = strings.Repeat(c.Kind, c.Len)
		case "é":
			in = strings.Repeat(c.Kind, c.Len/2)
		default:
			in = strings.Repeat(c.Kind, c.Len/3+1)[:c.Len-(c.Len%3)] + strings.Repeat("a", c.Len%3)
		}
		if len(in) != c.Len {
			t.Fatalf("cap case %d: built %d bytes, want %d", i, len(in), c.Len)
		}
		got := Cap(in)
		sum := sha256.Sum256([]byte(got))
		hash := hex.EncodeToString(sum[:])
		if edits != nil && (len(got) != c.OutLen || hash != c.OutHash) {
			edits.set(len(got), "cap", i, "out_len")
			edits.set(hash, "cap", i, "out_hash")
			c.OutLen, c.OutHash = len(got), hash
		}
		if len(got) != c.OutLen || hash != c.OutHash || !utf8.ValidString(got) {
			t.Errorf("Cap case %d: %d bytes valid=%v, want %d bytes", i, len(got), utf8.ValidString(got), c.OutLen)
		}
	}
	for i, c := range g.Split {
		got, err := shellWords(c.In)
		if edits != nil {
			if err != nil && (c.Error == "" || err.Error() != c.Error) {
				edits.members([]string{"out", "error"}, map[string]any{"error": err.Error()}, "split", i)
				continue
			}
			if err == nil && (c.Error != "" || !slices.Equal(got, c.Out)) {
				words := got
				if words == nil {
					words = []string{}
				}
				edits.members([]string{"out", "error"}, map[string]any{"out": words}, "split", i)
				continue
			}
		}
		if c.Error != "" {
			if err == nil || err.Error() != c.Error {
				t.Errorf("shellWords(%q) error = %v, want %q", c.In, err, c.Error)
			}
			continue
		}
		if err != nil || !slices.Equal(got, c.Out) || (len(got) == 0) != (len(c.Out) == 0) {
			t.Errorf("shellWords(%q) = %q, %v, want %q", c.In, got, err, c.Out)
		}
	}
}

func TestCutKeepsHeadAndTailAtUTF8BoundariesAndNamesTheOmittedBytes(t *testing.T) {
	for _, in := range []string{strings.Repeat("é", 20000), strings.Repeat("日", 9000), "a" + strings.Repeat("😀", 5000)} {
		got := Cut(in)
		if !utf8.ValidString(got) || len(got) > 16384 {
			t.Fatalf("Cut(%d bytes) = %d bytes, valid %v", len(in), len(got), utf8.ValidString(got))
		}
		contains(t, "cut", got, "bytes omitted")
	}
	if got := Cut(strings.Repeat("x", 16384)); len(got) != 16384 {
		t.Fatal("text at the limit is kept whole")
	}
}
