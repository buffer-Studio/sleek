pub const INTEREST_GUILDS: u64 = 1 << 0;
pub const INTEREST_GUILD_MEMBERS: u64 = 1 << 1;
pub const INTEREST_GUILD_MESSAGES: u64 = 1 << 2;
pub const INTEREST_MESSAGE_CONTENT: u64 = 1 << 3;
pub const INTEREST_INTERACTIONS: u64 = 1 << 4;
pub const INTEREST_VOICE_STATE: u64 = 1 << 5;
pub const INTEREST_REACTIONS: u64 = 1 << 6;
pub const INTEREST_LIFECYCLE: u64 = 1 << 7;

pub const DEFAULT_INTEREST: u64 =
  INTEREST_GUILDS | INTEREST_GUILD_MESSAGES | INTEREST_MESSAGE_CONTENT | INTEREST_INTERACTIONS | INTEREST_LIFECYCLE;

pub fn is_fatal_close_code(code: u16) -> bool {
  matches!(code, 4004 | 4010 | 4011 | 4013 | 4014)
}

pub fn is_critical_event(event_type: &str) -> bool {
  matches!(
    event_type,
    "READY"
      | "RESUMED"
      | "GUILD_CREATE"
      | "GUILD_DELETE"
      | "INTERACTION_CREATE"
      | "GATEWAY_CLOSED"
      | "GATEWAY_FATAL_CLOSE"
  )
}

pub fn should_forward(event_type: &str, interest: u64) -> bool {
  match event_type {
    "TYPING_START" | "PRESENCE_UPDATE" => false,
    "READY" | "RESUMED" | "GATEWAY_CLOSED" | "GATEWAY_FATAL_CLOSE" => {
      (interest & INTEREST_LIFECYCLE) != 0
    }
    "GUILD_CREATE"
      | "GUILD_UPDATE"
      | "GUILD_DELETE"
      | "GUILD_ROLE_CREATE"
      | "GUILD_ROLE_UPDATE"
      | "GUILD_ROLE_DELETE"
      | "CHANNEL_CREATE"
      | "CHANNEL_UPDATE"
      | "CHANNEL_DELETE" => {
      (interest & INTEREST_GUILDS) != 0
    }
    "GUILD_MEMBER_ADD" | "GUILD_MEMBER_UPDATE" | "GUILD_MEMBER_REMOVE" => {
      (interest & INTEREST_GUILD_MEMBERS) != 0
    }
    "MESSAGE_CREATE" | "MESSAGE_UPDATE" | "MESSAGE_DELETE" | "MESSAGE_DELETE_BULK" => {
      (interest & INTEREST_GUILD_MESSAGES) != 0
    }
    "INTERACTION_CREATE" => (interest & INTEREST_INTERACTIONS) != 0,
    "VOICE_STATE_UPDATE" | "VOICE_SERVER_UPDATE" => (interest & INTEREST_VOICE_STATE) != 0,
    "MESSAGE_REACTION_ADD" | "MESSAGE_REACTION_REMOVE" => (interest & INTEREST_REACTIONS) != 0,
    _ => false,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn drops_typing_and_presence_by_default() {
    assert!(!should_forward("TYPING_START", u64::MAX));
    assert!(!should_forward("PRESENCE_UPDATE", u64::MAX));
  }

  #[test]
  fn forwards_subscribed_events_and_marks_critical() {
    assert!(should_forward("READY", DEFAULT_INTEREST));
    assert!(should_forward("MESSAGE_CREATE", DEFAULT_INTEREST));
    assert!(should_forward("GUILD_ROLE_CREATE", DEFAULT_INTEREST));
    assert!(should_forward("GUILD_ROLE_UPDATE", DEFAULT_INTEREST));
    assert!(should_forward("GUILD_ROLE_DELETE", DEFAULT_INTEREST));
    assert!(!should_forward("VOICE_STATE_UPDATE", DEFAULT_INTEREST));
    assert!(is_critical_event("READY"));
    assert!(is_critical_event("INTERACTION_CREATE"));
    assert!(!is_critical_event("MESSAGE_CREATE"));
  }
}
