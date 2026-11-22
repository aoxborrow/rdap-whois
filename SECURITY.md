# Security

The library contacts hosts named in server responses: RDAP referral links, WHOIS referral
hostnames and HTTP redirects. Its target policy checks each name before connecting, and
refuses IP literals, `localhost` and names that only mean something on a local network
unless a caller allows them. The check is on the name, not the address it resolves to, so
a public name that resolves to a private address is out of its scope (the README says how
to enforce that). A way past the name check, a response that makes the library
contact a host the policy should refuse, or anything else that turns untrusted server
output into harm for the program using the library, is a security problem.

## Reporting

Report it privately through GitHub's private vulnerability reporting: the **Report a
vulnerability** button under this repository's **Security** tab
(https://github.com/aoxborrow/rdap-whois/security/advisories/new). Please do not open a
public issue for it.

Include what you ran, what it contacted or did, and the version. This is maintained in
spare time, so there is no promised response time, but security reports come first.

## Supported versions

Fixes go into the latest release only. In 0.x, that is the latest minor version.
