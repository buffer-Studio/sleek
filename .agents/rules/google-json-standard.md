# Google JSON Style Standard (JSONC Guide)

All JSON API payloads, configuration files, serialized schemas, and HTTP endpoints in Sleek must follow the **Google JSON Style Guide** ([`.refs/styleguide/jsoncguide.md`](file:///c:/Users/buffe/Desktop/Sleek/.refs/styleguide/jsoncguide.md)).

---

## 1. Property Name Formatting

- **Strict `camelCase`**: Property names must be camelCase, beginning with a lowercase letter and containing only alphanumeric ASCII characters.
  - ✅ Correct: `guildId`, `memberCount`, `maxDailyQuota`, `createdAt`
  - ❌ Banned: `guild_id`, `MemberCount`, `max-daily-quota`
- **Key Names in JSON Maps**: Strings representing arbitrary keys (e.g. snowflake dictionaries or user maps) are allowed, but structured properties must adhere to `camelCase`.
- **Singular vs. Plural**:
  - Use singular names for single values: `user`, `role`, `status`.
  - Use plural names for arrays and collections: `items`, `roles`, `members`, `tags`.

---

## 2. Property Values & Data Types

- **Date Values**: All timestamps and date properties must be formatted as ISO 8601 strings:
  ```json
  "createdAt": "2026-11-24T20:30:00.000Z"
  ```
- **Empty / Null Properties**:
  - Prefer **omitting** optional fields over emitting `"property": null` or `"property": ""`.
  - Only include explicit `null` if the API semantically distinguishes between "unchanged" (omitted) and "cleared/reset" (`null`).
- **Enum Values**:
  - Serialize enums as meaningful string literals, matching their TypeScript union representation:
    ```json
    "status": "pendingVerification"
    ```

---

## 3. Top-Level Response Envelope

APIs and service interfaces should follow the Google standard response envelope:

### Success Response (`data` container)
```json
{
  "apiVersion": "1.0",
  "data": {
    "kind": "sleek#guildSettings",
    "id": "123456789012345678",
    "updated": "2026-11-24T20:30:00.000Z",
    "items": []
  }
}
```

- `data.kind`: Identifies the schema or domain entity type (`"domain#type"`).
- `data.items`: The array of primary payload records. Always placed at the end of the `data` object.

### Error Response (`error` container)
```json
{
  "apiVersion": "1.0",
  "error": {
    "code": 403,
    "message": "Caller lacks required permission to moderate target user.",
    "errors": [
      {
        "domain": "sleek.permissions",
        "reason": "insufficientHierarchy",
        "message": "Target user has higher role hierarchy than moderator.",
        "location": "targetId",
        "locationType": "parameter"
      }
    ]
  }
}
```

---

## 4. Standard Paging Property Names

For paginated collections inside the `data` object, use standard paging property names:
- `data.totalItems` — Total number of items in the collection.
- `data.itemsPerPage` — Maximum items returned per page.
- `data.pageIndex` — Current 1-based or 0-based page index.
- `data.totalPages` — Total number of available pages.
- `data.startIndex` — Index of the first item on the current page.
- `data.currentItemCount` — Number of items in the current page payload.
