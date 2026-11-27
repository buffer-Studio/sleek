export enum AuthorityLevel {
  Member = 0,
  BoundStaff = 1,
  BoundAdmin = 2,
  ActingOwner = 3,
  TrueOwner = 4,
  PlatformDeveloper = 5,
}

export enum GlobalBotStaffTier {
  None = 0,
  Support = 1,
  TrustAndSafety = 2,
  Admin = 3,
  Developer = 5,
}

export function formatAuthorityLevel(level: AuthorityLevel): string {
  switch (level) {
    case AuthorityLevel.PlatformDeveloper:
      return 'Platform Developer (L5)';
    case AuthorityLevel.TrueOwner:
      return 'True Server Owner (L4)';
    case AuthorityLevel.ActingOwner:
      return 'Acting Owner (L3)';
    case AuthorityLevel.BoundAdmin:
      return 'Bound Admin (L2)';
    case AuthorityLevel.BoundStaff:
      return 'Bound Staff (L1)';
    case AuthorityLevel.Member:
      return 'Member (L0)';
  }
}
