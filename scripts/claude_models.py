"""The Claude model ids, in one place (Jackson's model policy, 2026-10-30).

The newest model of each tier, read off the API's own list (GET /v1/models).
The copy of that list is anthropic-models.json beside this file, with the date
it was fetched. Every call takes its id from here, so an upgrade is a one-line
change.

scripts/__tests__/claude-models.test.ts fails on a claude- model id anywhere
else in tracked source, on an id here that the snapshot doesn't list, and on
one that isn't the newest of its tier there, so refreshing the snapshot names
the next upgrade. To refresh: save the API's answer over the JSON and set its
fetched_at to the day.

Only Python calls the API in this repo (scripts/categorize-library.py). A
TypeScript caller would get its own config beside this one, held by the same
test.
"""

HAIKU_MODEL = "claude-haiku-5-5"
SONNET_MODEL = "claude-sonnet-5-5"
OPUS_MODEL = "claude-opus-5-5"
