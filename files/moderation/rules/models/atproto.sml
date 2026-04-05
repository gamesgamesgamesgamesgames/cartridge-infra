# ATProto record event model
Did: Entity[str] = EntityJson(type='User', path='$.did', coerce_type=True)
Collection: Entity[str] = EntityJson(type='Collection', path='$.collection')
Rkey: Entity[str] = EntityJson(type='Rkey', path='$.rkey', coerce_type=True)
EventType: Entity[str] = EntityJson(type='EventType', path='$.action', coerce_type=True)

# Game fields
GameName: Entity[str] = EntityJson(type='GameName', path='$.record.name', coerce_type=True)
GameSummary: Entity[str] = EntityJson(type='GameSummary', path='$.record.summary', coerce_type=True)

# Profile fields
DisplayName: Entity[str] = EntityJson(type='DisplayName', path='$.record.displayName', coerce_type=True)
Description: Entity[str] = EntityJson(type='Description', path='$.record.description', coerce_type=True)
