package verify

import (
	"context"
	"math"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"
)

type hostLoad struct {
	Load1 float64 `json:"load1"`
	Load5 float64 `json:"load5"`
}

func parseHostLoad(platform, text string) *hostLoad {
	if platform == "darwin" {
		text = strings.TrimSpace(text)
		if !strings.HasPrefix(text, "{") || !strings.HasSuffix(text, "}") {
			return nil
		}
		text = strings.TrimSpace(text[1 : len(text)-1])
	} else if platform != "linux" {
		return nil
	}
	fields := strings.Fields(text)
	if len(fields) < 3 || (platform == "darwin" && len(fields) != 3) {
		return nil
	}
	values := make([]float64, 3)
	for i := range values {
		v, err := strconv.ParseFloat(fields[i], 64)
		if err != nil || math.IsNaN(v) || math.IsInf(v, 0) || v < 0 {
			return nil
		}
		values[i] = v
	}
	return &hostLoad{values[0], values[1]}
}

func readHostLoad(platform string) *hostLoad {
	var b []byte
	var err error
	switch platform {
	case "linux":
		b, err = os.ReadFile("/proc/loadavg")
	case "darwin":
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		b, err = exec.CommandContext(ctx, "sysctl", "-n", "vm.loadavg").Output()
	default:
		return nil
	}
	if err != nil {
		return nil
	}
	return parseHostLoad(platform, string(b))
}
func sampleHostLoad() *hostLoad { return readHostLoad(runtime.GOOS) }
