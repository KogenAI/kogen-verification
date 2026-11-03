package verify

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"testing"
)

// update, set by `go test ./... -update`, makes the golden tests rewrite the recorded outputs in
// testdata/golden that differ from the code's actual output, instead of failing on them.
// It exists only in the tests: no other code reads it, and no environment variable sets it.
var update = flag.Bool("update", false, "rewrite the drifted recorded outputs in testdata/golden from the current code")

// goldenEdits collects the rewrites one golden test makes to its golden file and writes them
// when the test ends. The file is read again at that moment, so tests that share a golden file
// each keep what an earlier test of the same run wrote. A nil *goldenEdits ignores every call,
// which is what a run without -update gets.
type goldenEdits struct {
	t     *testing.T
	name  string
	edits map[string]*goldenEdit
	order []string
}

// goldenEdit sets the owned members of the object at path: a member of owned that desired has
// is written (a new one where the first dropped one stood, or last); one it lacks is dropped.
type goldenEdit struct {
	path    []any
	owned   []string
	desired map[string]any
}

// goldenUpdates returns the edits of the golden file name when -update is set, else nil.
func goldenUpdates(t *testing.T, name string) *goldenEdits {
	t.Helper()
	if !*update {
		return nil
	}
	g := &goldenEdits{t: t, name: name, edits: map[string]*goldenEdit{}}
	t.Cleanup(g.write)
	return g
}

// set records value as the member path[len-1] of the object at path[:len-1]; a path element is
// an object key (string) or an array index (int).
func (g *goldenEdits) set(value any, path ...any) {
	if g == nil {
		return
	}
	key := path[len(path)-1].(string)
	g.members([]string{key}, map[string]any{key: value}, path[:len(path)-1]...)
}

// members records desired as the new value of the members owned of the object at path.
func (g *goldenEdits) members(owned []string, desired map[string]any, path ...any) {
	if g == nil {
		return
	}
	id := fmt.Sprintf("%#v", path)
	e := g.edits[id]
	if e == nil {
		e = &goldenEdit{path: path, desired: map[string]any{}}
		g.edits[id] = e
		g.order = append(g.order, id)
	}
	for _, k := range owned {
		if !slices.Contains(e.owned, k) {
			e.owned = append(e.owned, k)
		}
		delete(e.desired, k)
	}
	for k, v := range desired {
		e.desired[k] = v
	}
}

func (g *goldenEdits) write() {
	t := g.t
	if len(g.edits) == 0 {
		return
	}
	file := filepath.Join("testdata", "golden", g.name)
	src, err := os.ReadFile(file)
	if err != nil {
		t.Errorf("update %s: %v", g.name, err)
		return
	}
	p := &goldenPatch{src: src}
	root, err := p.parse()
	if err != nil {
		t.Errorf("update %s: %v", g.name, err)
		return
	}
	type splice struct {
		start, end int
		text       string
	}
	var splices []splice
	for _, id := range g.order {
		e := g.edits[id]
		n, err := root.at(e.path)
		if err != nil {
			t.Errorf("update %s: %v", g.name, err)
			return
		}
		if n.kind != '{' {
			t.Errorf("update %s: %v is not an object", g.name, e.path)
			return
		}
		desired := map[string]any{}
		for k, v := range e.desired {
			desired[k] = generic(v)
		}
		splices = append(splices, splice{n.start, n.end, p.object(n, e.owned, desired)})
	}
	sort.Slice(splices, func(i, j int) bool { return splices[i].start < splices[j].start })
	var out bytes.Buffer
	at := 0
	for _, s := range splices {
		if s.start < at {
			t.Errorf("update %s: overlapping rewrites", g.name)
			return
		}
		out.Write(src[at:s.start])
		out.WriteString(s.text)
		at = s.end
	}
	out.Write(src[at:])
	if bytes.Equal(out.Bytes(), src) {
		return
	}
	if !json.Valid(out.Bytes()) {
		t.Errorf("update %s: the rewrite is not valid JSON", g.name)
		return
	}
	if err := os.WriteFile(file, out.Bytes(), 0o644); err != nil {
		t.Errorf("update %s: %v", g.name, err)
	}
}

// jnode is a JSON value of a golden file as a span of its bytes; an object's keys and members
// (kids) and an array's elements (kids) are spans too.
type jnode struct {
	kind       byte // '{', '[' or the first byte of a scalar
	start, end int
	keys       []string
	keyStart   []int
	kids       []*jnode
}

func (n *jnode) at(path []any) (*jnode, error) {
	for _, step := range path {
		switch s := step.(type) {
		case string:
			i := -1
			if n.kind == '{' {
				i = slices.Index(n.keys, s)
			}
			if i < 0 {
				return nil, fmt.Errorf("no member %q", s)
			}
			n = n.kids[i]
		case int:
			if n.kind != '[' || s < 0 || s >= len(n.kids) {
				return nil, fmt.Errorf("no element %d", s)
			}
			n = n.kids[s]
		default:
			return nil, fmt.Errorf("bad path element %v", step)
		}
	}
	return n, nil
}

type goldenPatch struct {
	src []byte
	pos int
}

func (p *goldenPatch) parse() (*jnode, error) {
	p.pos = 0
	n, err := p.value()
	if err != nil {
		return nil, err
	}
	p.space()
	if p.pos != len(p.src) {
		return nil, fmt.Errorf("trailing bytes at %d", p.pos)
	}
	return n, nil
}

func (p *goldenPatch) space() {
	for p.pos < len(p.src) && strings.IndexByte(" \t\r\n", p.src[p.pos]) >= 0 {
		p.pos++
	}
}

func (p *goldenPatch) value() (*jnode, error) {
	p.space()
	if p.pos >= len(p.src) {
		return nil, fmt.Errorf("unexpected end")
	}
	n := &jnode{kind: p.src[p.pos], start: p.pos}
	switch n.kind {
	case '{', '[':
		closer := byte('}')
		if n.kind == '[' {
			closer = ']'
		}
		p.pos++
		p.space()
		if p.pos < len(p.src) && p.src[p.pos] == closer {
			p.pos++
			break
		}
		for {
			if n.kind == '{' {
				p.space()
				k, err := p.value()
				if err != nil || k.kind != '"' {
					return nil, fmt.Errorf("bad object key at %d", p.pos)
				}
				var key string
				if err := json.Unmarshal(p.src[k.start:k.end], &key); err != nil {
					return nil, err
				}
				p.space()
				if p.pos >= len(p.src) || p.src[p.pos] != ':' {
					return nil, fmt.Errorf("missing colon at %d", p.pos)
				}
				p.pos++
				n.keys = append(n.keys, key)
				n.keyStart = append(n.keyStart, k.start)
			}
			v, err := p.value()
			if err != nil {
				return nil, err
			}
			n.kids = append(n.kids, v)
			p.space()
			if p.pos >= len(p.src) {
				return nil, fmt.Errorf("unexpected end")
			}
			c := p.src[p.pos]
			p.pos++
			if c == closer {
				break
			}
			if c != ',' {
				return nil, fmt.Errorf("unexpected %q at %d", c, p.pos-1)
			}
		}
	case '"':
		p.pos++
		for p.pos < len(p.src) && p.src[p.pos] != '"' {
			if p.src[p.pos] == '\\' {
				p.pos++
			}
			p.pos++
		}
		p.pos++
		if p.pos > len(p.src) {
			return nil, fmt.Errorf("unterminated string")
		}
	default:
		for p.pos < len(p.src) && strings.IndexByte(",]} \t\r\n", p.src[p.pos]) < 0 {
			p.pos++
		}
	}
	n.end = p.pos
	return n, nil
}

// object returns the new text of the object n after its owned members are set to desired.
// Members that are not owned keep their exact bytes.
func (p *goldenPatch) object(n *jnode, owned []string, desired map[string]any) string {
	var members []string
	insertAt := -1
	for i, k := range n.keys {
		if !slices.Contains(owned, k) {
			members = append(members, string(p.src[n.keyStart[i]:n.kids[i].end]))
			continue
		}
		v, ok := desired[k]
		if !ok {
			if insertAt < 0 {
				insertAt = len(members)
			}
			continue
		}
		members = append(members, string(p.src[n.keyStart[i]:n.kids[i].start])+p.patchValue(n.kids[i], v))
	}
	var added []string
	for _, k := range owned {
		if v, ok := desired[k]; ok && !slices.Contains(n.keys, k) {
			added = append(added, encode(k)+":"+encode(v))
		}
	}
	if insertAt < 0 {
		insertAt = len(members)
	}
	members = slices.Insert(members, insertAt, added...)
	return "{" + strings.Join(members, ",") + "}"
}

// patchValue returns the new text of n for the current value v: n's exact bytes where they equal v
// by value; else, for objects with the same keys and arrays of the same length, n with only its
// differing members re-encoded; else v encoded as encode writes it.
func (p *goldenPatch) patchValue(n *jnode, v any) string {
	old := p.src[n.start:n.end]
	if goldenSame(old, v) {
		return string(old)
	}
	switch x := v.(type) {
	case map[string]any:
		if n.kind == '{' && len(n.keys) == len(x) && sameKeys(n.keys, x) {
			var members []string
			for i, k := range n.keys {
				members = append(members, string(p.src[n.keyStart[i]:n.kids[i].start])+p.patchValue(n.kids[i], x[k]))
			}
			return "{" + strings.Join(members, ",") + "}"
		}
	case []any:
		if n.kind == '[' && len(n.kids) == len(x) {
			var elems []string
			for i, kid := range n.kids {
				elems = append(elems, p.patchValue(kid, x[i]))
			}
			return "[" + strings.Join(elems, ",") + "]"
		}
	}
	return encode(v)
}

func sameKeys(keys []string, m map[string]any) bool {
	for _, k := range keys {
		if _, ok := m[k]; !ok {
			return false
		}
	}
	return true
}

// goldenSame reports whether the recorded JSON old equals v (a decoded value) by value.
func goldenSame(old []byte, v any) bool {
	var w any
	d := json.NewDecoder(bytes.NewReader(old))
	d.UseNumber()
	if err := d.Decode(&w); err != nil {
		return false
	}
	return encode(w) == encode(v)
}
