//go:build darwin

package verify

import (
	"bytes"
	"encoding/binary"
	"testing"
)

const testMarker = "KOGEN_MARK=run-1"

// buildProcargs2 builds kern.procargs2 data: a little-endian int32 argc, the executable path
// with NUL padding, argc arguments and the environment, each NUL terminated.
func buildProcargs2(argc int32, execPath string, args, env []string) []byte {
	var b bytes.Buffer
	_ = binary.Write(&b, binary.LittleEndian, argc)
	b.WriteString(execPath)
	b.WriteString("\x00\x00\x00\x00")
	for _, a := range args {
		b.WriteString(a + "\x00")
	}
	for _, e := range env {
		b.WriteString(e + "\x00")
	}
	return b.Bytes()
}

func TestProcargs2MarkedExactEntry(t *testing.T) {
	tests := []struct {
		name string
		data []byte
		want bool
	}{
		{"environment holds the marker", buildProcargs2(2, "/bin/sleep", []string{"sleep", "60"}, []string{"PATH=/usr/bin", testMarker, "HOME=/h"}), true},
		{"marker is the only environment entry", buildProcargs2(1, "/bin/sleep", []string{"sleep"}, []string{testMarker}), true},
		{"only an argument holds the marker", buildProcargs2(3, "/bin/sh", []string{"sh", "-c", testMarker}, []string{"PATH=/usr/bin", "HOME=/h"}), false},
		{"environment entry extends the marker", buildProcargs2(1, "/bin/sleep", []string{"sleep"}, []string{"PATH=/usr/bin", testMarker + "2"}), false},
		{"environment entry has a longer name", buildProcargs2(1, "/bin/sleep", []string{"sleep"}, []string{"PATH=/usr/bin", "X_" + testMarker}), false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := procargs2Marked(tc.data, testMarker); got != tc.want {
				t.Fatalf("procargs2Marked = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestProcargs2MarkedMalformed(t *testing.T) {
	tests := []struct {
		name string
		data []byte
	}{
		{"nil data", nil},
		{"empty data", []byte{}},
		{"two bytes", []byte{2, 0}},
		{"argument count only", []byte{1, 0, 0, 0}},
		{"unterminated executable path", append([]byte{1, 0, 0, 0}, "/bin/sleep"+testMarker...)},
		{"unterminated argument", append([]byte{2, 0, 0, 0}, "/bin/sh\x00\x00\x00\x00sh\x00"+testMarker...)},
		{"argument count exceeds the arguments", buildProcargs2(5, "/bin/sh", []string{"sh"}, []string{"PATH=/usr/bin", testMarker})},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r != nil {
					t.Fatalf("procargs2Marked panicked: %v", r)
				}
			}()
			if procargs2Marked(tc.data, testMarker) {
				t.Fatal("procargs2Marked matched malformed data")
			}
		})
	}
}
