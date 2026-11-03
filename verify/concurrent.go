package verify

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"time"

	"kogen-loop/sys"
)

// independentGo recognizes only the standard, test-free Go invocations.
func independentGo(command string, s *sys.Session) bool {
	switch command {
	case "GOFLAGS=-trimpath go build ./...", "GOFLAGS=-trimpath go vet ./...":
		return true
	case "go build ./...", "go vet ./...":
		flags := s.Getenv("GOFLAGS")
		return flags == "" || flags == "-trimpath"
	}
	return false
}

type lockedLogger struct {
	mu    sync.Mutex
	inner Logger
}

func (l *lockedLogger) Log(e map[string]any) { l.mu.Lock(); defer l.mu.Unlock(); logEvent(l.inner, e) }

type cohortResult struct {
	result       CommandResult
	err          error
	cancelled    bool
	neverStarted bool
}

// runCohortCheck gives a single command its own session and marker. CapturedCommand
// provides the partial output that RunContext intentionally discards on cancellation.
func runCohortCheck(ctx context.Context, cancelWork <-chan struct{}, parent *sys.Session, in Input, dir string, it item) cohortResult {
	s := sys.NewWith(append([]string(nil), parent.Env...), parent.Cwd)
	env := in.Tools.env()
	id, err := newAcceptanceRunID()
	if err != nil {
		return cohortResult{err: err}
	}
	marker, err := newAcceptanceMarkerFile()
	if err != nil {
		return cohortResult{err: err}
	}
	defer os.Remove(marker)
	env[stepMarker] = id
	for k, v := range env {
		s.Env = append(s.Env, k+"="+v)
	}
	logEvent(in.Log, map[string]any{"event": "command", "name": it.name, "command": it.command, "cwd": dir})
	childCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	stopInterrupt := context.AfterFunc(parent.Context(), cancel)
	defer stopInterrupt()
	script := acceptanceReaped(acceptanceScript(marker, it.command))
	captured := s.StartCaptured(childCtx, script, dir)
	done := make(chan outcome, 1)
	go func() { <-captured.Done(); r, _, e := captured.Snapshot(); done <- outcome{r, e} }()
	watched := make(chan outcome, 1)
	go func() { r, e := awaitResult(s, nil, it.name, it.command, in.Log, done); watched <- outcome{r, e} }()
	var o outcome
	cancelled := false
	select {
	case o = <-watched:
	case <-cancelWork:
		select {
		case o = <-watched:
		default:
			r, finished, e := captured.Snapshot()
			if finished {
				o = outcome{r, e}
				<-watched
			} else {
				o.res = r
				cancelled = true
				cancel()
				<-watched
			}
		}
	case <-ctx.Done():
		cancel()
		<-watched
		o.err = ctx.Err()
	case <-parent.Context().Done():
		cancel()
		<-watched
		o.err = parent.Err()
	}
	// A missing result after the owned group disappeared is the existing no-progress
	// rule: there is no process left to join, and the missing result is abandoned.
	// Otherwise Stop joins cancellation and sweeps groups left by a completed shell.
	if failure, ok := sys.AsError(o.err); ok && failure.Reason == "command_no_progress" {
		cancel()
	} else {
		captured.Stop(cancel)
	}
	began := time.Now()
	stopped, sweepErr := stopMarkedProcesses(stepMarker, id, marker)
	ev := map[string]any{"event": "step_sweep", "name": it.name, "stopped": stopped, "ms": int(time.Since(began).Milliseconds())}
	if sweepErr != nil {
		ev["error"] = Cut(sweepErr.Error())
	}
	logEvent(in.Log, ev)
	if err := parent.Err(); err != nil {
		return cohortResult{err: err}
	}
	if ctx.Err() != nil {
		return cohortResult{err: ctx.Err()}
	}
	if cancelled && len(s.Groups()) == 0 {
		return cohortResult{neverStarted: true}
	}
	if cancelled {
		o.res.Status = -1
		o.err = nil
	}
	if o.err != nil {
		return cohortResult{err: o.err}
	}
	r := CommandResult{Name: it.name, Command: it.command, Status: o.res.Status, Output: o.res.Output}
	logEvent(in.Log, map[string]any{"event": "command_result", "name": it.name, "status": r.Status, "output": Cap(r.Output)})
	return cohortResult{result: r, cancelled: cancelled}
}

func runCohort(ctx context.Context, s *sys.Session, in Input, dir string, items []item) ([]cohortResult, error) {
	results := make([]cohortResult, len(items))
	done := make([]chan struct{}, len(items))
	stops := make([]chan struct{}, len(items))
	for i, it := range items {
		done[i] = make(chan struct{})
		stops[i] = make(chan struct{})
		go func(i int, it item) { results[i] = runCohortCheck(ctx, stops[i], s, in, dir, it); close(done[i]) }(i, it)
	}
	stop := -1
	for i := range items {
		<-done[i]
		if results[i].err != nil || results[i].result.Status != 0 {
			stop = i
			break
		}
	}
	if stop >= 0 {
		for j := stop + 1; j < len(items); j++ {
			select {
			case <-done[j]:
			default:
				close(stops[j])
			}
		}
	}
	for i := range items {
		<-done[i]
	}
	for i := range items {
		if results[i].err != nil && !errors.Is(results[i].err, context.Canceled) {
			return nil, results[i].err
		}
	}
	if err := s.Err(); err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if stop >= 0 && results[stop].err != nil {
		return nil, fmt.Errorf("check %s: %w", items[stop].name, results[stop].err)
	}
	return results, nil
}
