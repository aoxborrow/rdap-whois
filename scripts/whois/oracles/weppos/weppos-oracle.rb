# weppos/whois-parser oracle wrapper (docs/registry-health.md O1). Reads raw WHOIS
# text and emits the normalized oracle JSON defined in ../schema.md. Inert unless run —
# nothing in yarn build/lint/test touches this file; only the registry-health CI job (and
# a dev with Ruby + bundler) runs it:
#
#   bundle install          # once, pinned by Gemfile.lock
#   bundle exec ruby weppos-oracle.rb --dir <path>
#
# weppos selects its parser class by the RESPONDING HOST, so the host must always be
# supplied: batch mode derives it from the <server>___<query>.txt filename, stdin mode
# takes --server. An unknown host falls back to a blank parser that extracts nothing —
# that is weppos's honest answer for the host, not an error.
#
# Modes:
#   --dir <path>              batch: every *.txt in path, one NDJSON object per file
#   --server <host> (stdin)   single response on stdin, one JSON object on stdout
# zone-less registry dates parse in the process's local timezone — pin UTC so the
# emitted RFC 3339 values are identical on every machine (a PDT dev run vs the UTC CI
# runner produced 75 spurious value-mismatches before this)
ENV['TZ'] = 'UTC'

require 'json'
require 'time'
require 'whois-parser'

# read one parser property, treating "this parser doesn't do that" as absent
def prop(parser, name)
  return nil unless parser.respond_to?(name)
  parser.public_send(name)
rescue Whois::AttributeNotImplemented, Whois::AttributeNotSupported, Whois::ParserError
  nil
rescue StandardError
  nil
end

def clean(value)
  value = value.to_s.strip
  value.empty? ? nil : value
end

def date(value)
  value.respond_to?(:utc) ? value.utc.iso8601 : clean(value)
end

def contact_fields(fields, prefix, contacts)
  contact = Array(contacts).first
  return unless contact
  fields["#{prefix}_name"] = clean(contact.name)
  fields["#{prefix}_org"] = clean(contact.organization)
  fields["#{prefix}_email"] = clean(contact.email)
  fields["#{prefix}_country"] = clean(contact.country_code) if prefix == 'registrant'
end

def parse_one(host, body)
  record = Whois::Record.new(nil, [Whois::Record::Part.new(body: body, host: host)])
  parser = record.parser
  out = { 'notFound' => false, 'reserved' => false, 'fields' => {} }

  begin
    out['notFound'] = parser.available? == true
  rescue StandardError
    # some parsers can't answer available? for every response shape
  end
  return out if out['notFound']

  fields = out['fields']
  fields['domain_name'] = clean(prop(parser, :domain))
  fields['domain_id'] = clean(prop(parser, :domain_id))
  registrar = prop(parser, :registrar)
  if registrar
    fields['registrar_id'] = clean(registrar.id)
    fields['registrar_name'] = clean(registrar.name) || clean(registrar.organization)
    fields['registrar_url'] = clean(registrar.url)
  end
  fields['creation_date'] = date(prop(parser, :created_on))
  fields['updated_date'] = date(prop(parser, :updated_on))
  fields['expiration_date'] = date(prop(parser, :expires_on))
  statuses = Array(prop(parser, :status)).map(&:to_s).reject(&:empty?)
  # weppos aggregates unrecognized responses to :registered/:available — a routing
  # verdict, not an extracted status value; only pass through real registry statuses
  statuses -= %w[registered available]
  fields['status'] = statuses unless statuses.empty?
  nameservers = Array(prop(parser, :nameservers)).map { |ns| ns.respond_to?(:name) ? ns.name.to_s : ns.to_s }
  fields['nameservers'] = nameservers unless nameservers.empty?
  contact_fields(fields, 'registrant', prop(parser, :registrant_contacts))
  contact_fields(fields, 'admin', prop(parser, :admin_contacts))
  contact_fields(fields, 'tech', prop(parser, :technical_contacts))
  fields.compact!
  out
end

def safe_parse(host, body)
  parse_one(host, body)
rescue StandardError => e
  { 'error' => "#{e.class}: #{e.message}", 'fields' => {} }
end

args = ARGV.each_slice(2).to_h
if (dir = args['--dir'])
  Dir.glob(File.join(dir, '*.txt')).sort.each do |path|
    name = File.basename(path)
    host = name.split('___').first
    body = File.read(path, encoding: 'UTF-8', invalid: :replace, undef: :replace)
    puts JSON.generate(safe_parse(host, body).merge('file' => name))
  end
else
  host = args['--server'] or abort('usage: weppos-oracle.rb --dir <path> | --server <host> < raw.txt')
  puts JSON.generate(safe_parse(host, $stdin.read))
end
