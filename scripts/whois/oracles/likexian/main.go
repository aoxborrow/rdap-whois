// likexian/whois-parser oracle wrapper (docs/registry-health.md O1). Reads raw
// WHOIS text and emits the normalized oracle JSON defined in ../schema.md. Inert unless
// explicitly built — nothing in yarn build/lint/test touches this file; only the
// registry-health CI job (and a dev with Go installed) compiles it:
//
//	go build -o likexian-oracle .
//
// Modes:
//	--dir <path>   batch: parse every *.txt (named <server>___<query>.txt), one NDJSON
//	               object per file on stdout: {"file":..., "notFound":..., "fields":{...}}
//	stdin          single response on stdin, one JSON object on stdout
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"time"

	whoisparser "github.com/likexian/whois-parser"
)

type result struct {
	File     string         `json:"file,omitempty"`
	Error    string         `json:"error,omitempty"`
	NotFound bool           `json:"notFound"`
	Reserved bool           `json:"reserved"`
	Fields   map[string]any `json:"fields"`
}

func set(fields map[string]any, key, value string) {
	if value != "" {
		fields[key] = value
	}
}

// prefer the library's parsed time (RFC3339 UTC), fall back to the raw string
func setDate(fields map[string]any, key, raw string, parsed *time.Time) {
	if parsed != nil {
		fields[key] = parsed.UTC().Format(time.RFC3339)
	} else if raw != "" {
		fields[key] = raw
	}
}

func setContact(fields map[string]any, prefix string, contact *whoisparser.Contact) {
	if contact == nil {
		return
	}
	set(fields, prefix+"_name", contact.Name)
	set(fields, prefix+"_org", contact.Organization)
	set(fields, prefix+"_email", contact.Email)
	if prefix == "registrant" {
		set(fields, prefix+"_country", contact.Country)
	}
}

func parseOne(raw string) result {
	info, err := whoisparser.Parse(raw)
	out := result{Fields: map[string]any{}}
	if err != nil {
		switch {
		case errors.Is(err, whoisparser.ErrNotFoundDomain):
			out.NotFound = true
		case errors.Is(err, whoisparser.ErrReservedDomain),
			errors.Is(err, whoisparser.ErrBlockedDomain),
			errors.Is(err, whoisparser.ErrPremiumDomain):
			out.Reserved = true
		default:
			out.Error = err.Error()
		}
		return out
	}

	f := out.Fields
	if d := info.Domain; d != nil {
		set(f, "domain_id", d.ID)
		set(f, "domain_name", d.Domain)
		set(f, "registrar_whois_server", d.WhoisServer)
		setDate(f, "creation_date", d.CreatedDate, d.CreatedDateInTime)
		setDate(f, "updated_date", d.UpdatedDate, d.UpdatedDateInTime)
		setDate(f, "expiration_date", d.ExpirationDate, d.ExpirationDateInTime)
		if len(d.Status) > 0 {
			f["status"] = d.Status
		}
		if len(d.NameServers) > 0 {
			f["nameservers"] = d.NameServers
		}
		if d.DNSSec {
			f["dnssec"] = "signed"
		}
	}
	if r := info.Registrar; r != nil {
		set(f, "registrar_id", r.ID)
		set(f, "registrar_name", r.Name)
		set(f, "registrar_url", r.ReferralURL)
	}
	setContact(f, "registrant", info.Registrant)
	setContact(f, "admin", info.Administrative)
	setContact(f, "tech", info.Technical)
	return out
}

func main() {
	dir := flag.String("dir", "", "batch mode: directory of <server>___<query>.txt files")
	flag.Parse()
	encoder := json.NewEncoder(os.Stdout)

	if *dir == "" {
		raw, err := io.ReadAll(os.Stdin)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		_ = encoder.Encode(parseOne(string(raw)))
		return
	}

	paths, err := filepath.Glob(filepath.Join(*dir, "*.txt"))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	sort.Strings(paths)
	for _, path := range paths {
		name := filepath.Base(path)
		raw, err := os.ReadFile(path)
		if err != nil {
			_ = encoder.Encode(result{File: name, Error: err.Error(), Fields: map[string]any{}})
			continue
		}
		out := parseOne(string(raw))
		out.File = name
		_ = encoder.Encode(out)
	}
}
