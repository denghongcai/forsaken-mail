#!/usr/bin/env bash
# End-to-end smoke test against a running Forsaken Mail instance. Used by CI
# to verify the Docker image, but works against any local instance too.
#
# Flow: wait for the API → create a random account → exchange a token →
# deliver an email over SMTP → read it back over the API → check the SPA
# index and the API 404 contract.
#
# Configuration via environment:
#   API_PORT    HTTP port of the instance   (default 3300)
#   SMTP_PORT   SMTP port of the instance   (default 2525)
#
# Dependencies: curl, jq (both preinstalled on GitHub runners).
set -euo pipefail

API="http://127.0.0.1:${API_PORT:-3300}"
SMTP_URL="smtp://127.0.0.1:${SMTP_PORT:-2525}"
SUBJECT="CI smoke test"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

echo "== 1. wait for the HTTP API to come up =="
for i in $(seq 1 30); do
  if curl -sf "$API/api/domains" >/dev/null 2>&1; then break; fi
  if [ "$i" -eq 30 ]; then fail "API did not come up within 30s"; fi
  sleep 1
done
echo "API is up"

echo "== 2. create a random account =="
account_json=$(curl -sf -X POST "$API/api/accounts" \
  -H 'Content-Type: application/json' \
  -d '{"random":true}') || fail "account creation failed"
address=$(jq -r .address <<<"$account_json")
password=$(jq -r .password <<<"$account_json")
[ -n "$address" ] && [ "$address" != "null" ] || fail "no address in response: $account_json"
echo "created account: $address"

echo "== 3. exchange credentials for a token =="
token=$(curl -sf -X POST "$API/api/token" \
  -H 'Content-Type: application/json' \
  -d "{\"address\":\"$address\",\"password\":\"$password\"}" | jq -r .token) || fail "token exchange failed"
[ -n "$token" ] && [ "$token" != "null" ] || fail "no token in response"
echo "token acquired"

echo "== 4. deliver an email over SMTP =="
eml=$(mktemp)
trap 'rm -f "$eml"' EXIT
cat >"$eml" <<EOF
From: CI Sender <sender@example.com>
To: $address
Subject: $SUBJECT
Message-ID: <ci-$$@example.com>
Date: $(date -R)
Content-Type: text/plain; charset=utf-8

hello from CI
EOF
# curl speaks the full SMTP conversation: EHLO → MAIL FROM → RCPT TO → DATA
curl -sf "$SMTP_URL" --mail-from sender@example.com --mail-rcpt "$address" -T "$eml" \
  || fail "SMTP delivery failed"

echo "== 5. read the message back over the API =="
subject=""
for i in $(seq 1 20); do
  # The parse+store pipeline is async, so poll until the message shows up
  subject=$(curl -sf "$API/api/messages" -H "Authorization: Bearer $token" 2>/dev/null |
    jq -r '.items[0].subject // empty' || true)
  [ "$subject" = "$SUBJECT" ] && break
  sleep 0.5
done
[ "$subject" = "$SUBJECT" ] || fail "message did not arrive (last subject: '$subject')"
echo "message visible in the list"

msgid=$(curl -sf "$API/api/messages" -H "Authorization: Bearer $token" | jq -r '.items[0].id')
text=$(curl -sf "$API/api/messages/$msgid" -H "Authorization: Bearer $token" | jq -r .text)
grep -q "hello from CI" <<<"$text" || fail "unexpected body: $text"
echo "detail body matches"

seen=$(curl -sf -X PATCH "$API/api/messages/$msgid" \
  -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
  -d '{"seen":true}' | jq -r .seen)
[ "$seen" = "true" ] || fail "mark-seen failed"
echo "mark seen works"

echo "== 6. SPA index is served =="
curl -sf "$API/" | grep -q '<div id="root">' || fail "SPA index not served"

echo "== 7. unknown API paths return JSON 404 =="
code=$(curl -s -o /dev/null -w '%{http_code}' "$API/api/does-not-exist")
[ "$code" = "404" ] || fail "expected 404 for unknown API path, got $code"

echo ""
echo "Smoke test passed."
