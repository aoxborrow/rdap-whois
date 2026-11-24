# Security

The library connects wherever it is pointed, including the hosts named in server responses:
RDAP referral links, WHOIS referral hostnames and HTTP redirects. It does not screen
destinations, so a response that leads it to a private or local address is not a
vulnerability in the library; a service that needs that guarantee enforces it at the
connection (the README says how). A response that gets past `maxResponseBytes`, a
timeout or the redirect limit, or anything else that turns untrusted server output into
harm for the program using the library, is a security problem.

## Reporting

Report it privately through GitHub's private vulnerability reporting: the **Report a
vulnerability** button under this repository's **Security** tab
(https://github.com/aoxborrow/rdap-whois/security/advisories/new). Please do not open a
public issue for it.

Include what you ran, what it contacted or did, and the version. This is maintained in
spare time, so there is no promised response time, but security reports come first.

## Supported versions

Fixes go into the latest release only. In 0.x, that is the latest minor version.
