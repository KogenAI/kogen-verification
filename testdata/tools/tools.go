// Package tools holds the pinned package.json and package-lock.json of the npm tools the tests
// use. They are committed once, here; cmd/setup-tools embeds them from this package.
package tools

import "embed"

// Files holds testdata/tools/{cucumber,quint}/{package.json,package-lock.json}.
//
//go:embed cucumber/package.json cucumber/package-lock.json quint/package.json quint/package-lock.json
var Files embed.FS
