//go:build intentprobe

package verify

import (
	"encoding/json"
	"fmt"
	"os"
	"testing"
)

func TestVerboseIntentProbe(t *testing.T) {
	msg := os.Getenv("VERBOSE_TRANSCRIPT")
	tc := jmap{"testSteps": []any{jmap{"id": "s"}}}
	block, unwritten := missingNamedTests(tc, []stepResult{{step: "s", result: jmap{"status": "FAILED", "message": msg}}}, nil)
	rows := parseGoRows(msg)
	b, _ := json.Marshal(map[string]any{"seen": rows.seen, "block": block, "unwritten": unwritten})
	fmt.Println("VERBOSE_RESULT=" + string(b))
}
