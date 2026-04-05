# Basic spam detection rules for ATProto game records
Import(rules=['models/atproto.sml'])

SpamGameName = Rule(
    when_all=[
        Collection == 'games.gamesgamesgamesgames.game',
        RegexMatch(target=GameName, pattern=r'(?i)(buy now|free v.?bucks|casino|crypto|nft|viagra)')
    ],
    description='Game name contains spam keywords',
)

SpamProfileName = Rule(
    when_all=[
        Collection == 'games.gamesgamesgamesgames.actor.profile',
        RegexMatch(target=DisplayName, pattern=r'(?i)(buy now|free v.?bucks|casino|crypto|nft|viagra)')
    ],
    description='Profile display name contains spam keywords',
)

WhenRules(
    rules_any=[SpamGameName, SpamProfileName],
    then=[
        LabelAdd(entity=Did, label='spam_suspect'),
        DeclareVerdict(verdict='flag_for_review'),
    ],
)
