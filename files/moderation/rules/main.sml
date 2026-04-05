Import(rules=['models/atproto.sml'])

# Record events
Require(rule='rules/spam.sml', require_if=EventType == 'record.create')
Require(rule='rules/spam.sml', require_if=EventType == 'record.update')
