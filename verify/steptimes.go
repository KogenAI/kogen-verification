package verify

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"
)

// maxStepTimeLines caps the entries a timed-out acceptance refusal names.
const maxStepTimeLines = 5

// timedEntry is one test step or test-run hook of a possibly partial Cucumber Messages report,
// with the wall time the report (or the stop) gives it.
type timedEntry struct {
	label   string
	wall    time.Duration
	running bool
}

type pendingEntry struct {
	key        string
	hookID     string // a test-run hook's hook id
	caseID     string // a test step's test case started id
	stepID     string
	start      *time.Time
	finishedAt *time.Time
	duration   *time.Duration
	finished   bool
}

// readStepTimes reads the report of a stopped acceptance run. A missing file has no entries;
// lines that are not JSON objects (a final line cut off by the stop) are ignored. An entry that
// started but did not finish is still running: its wall time ends at endedAt (RFC 3339, the
// instant the acceptance step ended), never below 0. The result is slowest first, equal wall
// times in the order their first message appears, and holds at most five entries.
func readStepTimes(report, endedAt string) []timedEntry {
	text, err := os.ReadFile(report)
	if err != nil {
		return nil
	}
	end, endErr := time.Parse(time.RFC3339Nano, endedAt)
	var msgs []jmap
	for _, line := range strings.Split(string(text), "\n") {
		var obj jmap
		if json.Unmarshal([]byte(line), &obj) == nil && obj != nil {
			msgs = append(msgs, obj)
		}
	}

	var order []*pendingEntry
	byKey := map[string]*pendingEntry{}
	entry := func(key string) *pendingEntry {
		e := byKey[key]
		if e == nil {
			e = &pendingEntry{key: key}
			byKey[key] = e
			order = append(order, e)
		}
		return e
	}
	runStarted := map[string]string{} // testRunHookStarted id -> its entry key
	caseOf := map[string]string{}     // testCaseStarted id -> test case id
	testCases, pickles, hooks := map[string]jmap{}, map[string]jmap{}, map[string]jmap{}
	lines := map[string]astNode{}
	for _, m := range msgs {
		if d := m["gherkinDocument"]; d != nil {
			func() {
				defer func() { _ = recover() }()
				for k, v := range astLines(get(d, "feature", "children")) {
					lines[k] = v
				}
			}()
		}
		if p, ok := m["pickle"].(jmap); ok {
			pickles[str0(p["id"])] = p
		}
		if c, ok := m["testCase"].(jmap); ok {
			testCases[str0(c["id"])] = c
		}
		if h, ok := m["hook"].(jmap); ok {
			hooks[str0(h["id"])] = h
		}
		if c, ok := m["testCaseStarted"].(jmap); ok {
			caseOf[str0(c["id"])] = str0(c["testCaseId"])
		}
		if s, ok := m["testStepStarted"].(jmap); ok {
			e := entry("step:" + str0(s["testCaseStartedId"]) + "/" + str0(s["testStepId"]))
			e.caseID, e.stepID = str0(s["testCaseStartedId"]), str0(s["testStepId"])
			e.start = timestampOf(s["timestamp"])
		}
		if f, ok := m["testStepFinished"].(jmap); ok {
			e := entry("step:" + str0(f["testCaseStartedId"]) + "/" + str0(f["testStepId"]))
			e.caseID, e.stepID = str0(f["testCaseStartedId"]), str0(f["testStepId"])
			e.finished = true
			e.finishedAt = timestampOf(f["timestamp"])
			e.duration = durationOf(get(f, "testStepResult", "duration"))
		}
		if s, ok := m["testRunHookStarted"].(jmap); ok {
			key := "hook:" + str0(s["id"])
			runStarted[str0(s["id"])] = key
			e := entry(key)
			e.hookID = str0(s["hookId"])
			e.start = timestampOf(s["timestamp"])
		}
		if f, ok := m["testRunHookFinished"].(jmap); ok {
			key, ok := runStarted[str0(f["testRunHookStartedId"])]
			if !ok {
				key = "hook:" + str0(f["testRunHookStartedId"])
			}
			e := entry(key)
			e.finished = true
			e.finishedAt = timestampOf(f["timestamp"])
			e.duration = durationOf(get(f, "result", "duration"))
		}
	}

	hookLabel := func(hookID string) string {
		if ref, ok := get(hooks[hookID], "sourceReference").(jmap); ok {
			if uri, ok := ref["uri"].(string); ok {
				if line, ok := get(ref, "location", "line").(float64); ok {
					return fmt.Sprintf("a hook at %s line %d", uri, int(line))
				}
			}
		}
		return "a hook (location not reported)"
	}
	stepLabel := func(e *pendingEntry) string {
		if e.hookID != "" || e.caseID == "" {
			return hookLabel(e.hookID)
		}
		tc := testCases[caseOf[e.caseID]]
		var ts jmap
		if l, ok := get(tc, "testSteps").([]any); ok {
			for _, x := range l {
				if m, ok := x.(jmap); ok && m["id"] == e.stepID {
					ts = m
				}
			}
		}
		if ts == nil {
			return "a step (location not reported)"
		}
		if pid, ok := ts["pickleStepId"].(string); ok {
			if l, ok := get(pickles[str0(tc["pickleId"])], "steps").([]any); ok {
				for _, x := range l {
					ps, ok := x.(jmap)
					if !ok || ps["id"] != pid {
						continue
					}
					if ids, ok := ps["astNodeIds"].([]any); ok && len(ids) > 0 {
						if node, ok := lines[str0(ids[0])]; ok && node.step {
							return fmt.Sprintf("acceptance.feature line %d: %s %s", node.line, strings.TrimSpace(node.keyword), str0(ps["text"]))
						}
					}
				}
			}
		} else if hid, ok := ts["hookId"].(string); ok {
			return hookLabel(hid)
		}
		return "a step (location not reported)"
	}

	var out []timedEntry
	for _, e := range order {
		t := timedEntry{}
		switch {
		case e.finished && e.duration != nil:
			t.wall = *e.duration
		case e.finished && e.start != nil && e.finishedAt != nil:
			t.wall = e.finishedAt.Sub(*e.start)
		case !e.finished && e.start != nil:
			t.running = true
			if endErr == nil {
				t.wall = end.Sub(*e.start)
			}
		default:
			continue
		}
		if t.wall < 0 {
			t.wall = 0
		}
		t.label = stepLabel(e)
		out = append(out, t)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].wall > out[j].wall })
	if len(out) > maxStepTimeLines {
		out = out[:maxStepTimeLines]
	}
	return out
}

func timestampOf(v any) *time.Time {
	m, ok := v.(jmap)
	if !ok {
		return nil
	}
	sec, ok := m["seconds"].(float64)
	if !ok {
		return nil
	}
	t := time.Unix(int64(sec), int64(num(m["nanos"])))
	return &t
}

func durationOf(v any) *time.Duration {
	m, ok := v.(jmap)
	if !ok {
		return nil
	}
	sec, ok := m["seconds"].(float64)
	if !ok {
		return nil
	}
	d := time.Duration(int64(sec))*time.Second + time.Duration(int64(num(m["nanos"])))
	return &d
}

// stepTimeLines are the refusal lines naming the slowest Cucumber steps of a stopped run.
func stepTimeLines(entries []timedEntry) []string {
	if len(entries) == 0 {
		return []string{"Its Cucumber report recorded no step times before the stop."}
	}
	lines := []string{"Slowest Cucumber steps before the stop (from its report, slowest first):"}
	for _, e := range entries {
		s := fmtSeconds(e.wall.Milliseconds())
		if e.running {
			s += ", still running when stopped"
		}
		lines = append(lines, "  "+s+": "+e.label)
	}
	return lines
}
