# Security Specification — maktabada.so

## Phase 0: Data Invariants
1. **Identity & RBAC Integrity**: Every `/users/{userId}` document must have `uid == userId == request.auth.uid` on creation. Non-admin users can only create profiles with `role == "user"` and cannot escalate their own `role` during updates.
2. **PII Isolation**: `/users/{userId}` contains `email` and is strictly readable only by the document owner (`request.auth.uid == userId`) or a verified admin (`isAdmin()`). Unauthenticated or peer users cannot read or list another user's profile.
3. **Catalog Write Protection**: Only verified admins (`isAdmin()`) may create, update, or delete documents in `/books/{bookId}`. Readers may only read published books (`resource.data.published == true`).
4. **Strict Schema & Bounds**: All strings enforce explicit `.size()` bounds; `favorites` arrays are bounded to `<= 100` items; `createdAt` and `uid` / `createdBy` fields are immutable; `createdAt` and `updatedAt` require `request.time` server timestamps.
5. **Path Hardening**: All single-document operations validate `isValidId(id)` (`^[a-zA-Z0-9_\\-]+$`, length `<= 128`).
6. **Atomic Star-Rating Aggregation**: Signed-in users can only rate published books (`1..5` integer) in `/books/{bookId}/ratings/{request.auth.uid}`, and every rating write must atomically update `/books/{bookId}` (`ratingSum`, `ratingCount`, `updatedAt`) verified via `existsAfter`/`getAfter`.
7. **Private Reading Progress Isolation**: Each user's reading progress (`/users/{userId}/progress/{bookId}`) is strictly readable and writable only by the owner (`request.auth.uid == userId`), enforcing `0 <= percentage <= 100` and `1 <= currentPage <= totalPages <= 10000`.
8. **Book Comment Ownership & Integrity**: Signed-in readers with a valid user profile may post comments (`1 <= text.size() <= 1500`) only on published books (`/books/{bookId}`), with `userId == request.auth.uid` immutable, `bookId == bookId` immutable, and no PII (`email`) stored. Only the comment author or an admin may edit/delete a comment.
9. **Daily Reading Log Integrity**: Each user's daily reading logs (`/users/{userId}/readingLogs/{dateKey}`) are strictly readable and writable only by the owner (`request.auth.uid == userId`), enforcing `YYYY-MM-DD` date keys, `0 <= secondsRead <= 86400`, monotonic daily growth (`secondsRead >= existing().secondsRead`), and `request.time` timestamps.

## The "Dirty Dozen" Adversarial Payloads
1. **Self-Role Escalation on Create**: Reader signs up and sends `role: "admin"` on `/users/{uid}` -> `PERMISSION_DENIED`.
2. **Self-Role Escalation on Update**: Authenticated user updates `/users/{uid}` changing `role` from `"user"` to `"admin"` -> `PERMISSION_DENIED`.
3. **Shadow Field Injection on User**: User includes `isPremium: true` in `/users/{uid}` write -> `PERMISSION_DENIED` (`hasOnly` rejects unknown keys).
4. **PII Cross-Read**: User A attempts `get` on `/users/userB` -> `PERMISSION_DENIED`.
5. **Unauthorized User Directory List**: Non-admin user attempts `list` on `/users` -> `PERMISSION_DENIED`.
6. **Email Spoofing Without Verification**: Unverified auth token (`email_verified == false`) with admin email attempts admin write -> `PERMISSION_DENIED`.
7. **Unauthorized Book Creation**: Standard `role: "user"` attempts `create` on `/books/{bookId}` -> `PERMISSION_DENIED`.
8. **Unauthorized Book Deletion**: Standard `role: "user"` attempts `delete` on `/books/{bookId}` -> `PERMISSION_DENIED`.
9. **Resource Exhaustion (1MB String)**: Admin or attacker submits `title` or `description` exceeding `maxLength` -> `PERMISSION_DENIED`.
10. **Path ID Poisoning**: Attacker targets `/books/bad$id!@#` or >128-char ID -> `PERMISSION_DENIED` (`isValidId` rejects).
11. **Timestamp Forgery**: Client submits forged past `createdAt` instead of `serverTimestamp()` (`request.time`) -> `PERMISSION_DENIED`.
12. **Unbounded Favorites Array**: User sends 101+ items in `favorites` -> `PERMISSION_DENIED`.
13. **Out-of-Range or Spoofed Rating**: User submits `rating: 6` or `rating: 0`, writes to `/books/{bookId}/ratings/otherUid`, or inflates `ratingCount`/`ratingSum` without a matching atomic `/ratings/{uid}` write -> `PERMISSION_DENIED`.
14. **Cross-User or Out-of-Bounds Reading Progress**: User A writes to `/users/userB/progress/book_1` or submits `percentage: 150` / `currentPage > totalPages` -> `PERMISSION_DENIED`.
15. **Comment Author Spoofing or Cross-User Edit/Delete**: User A creates a comment with `userId: "userB"` or edits/deletes User B's comment in `/books/{bookId}/comments/{commentId}` -> `PERMISSION_DENIED`.
16. **Oversized or Unpublished-Book Comment**: Attacker submits a comment >1500 chars, empty text, or comments on an unpublished/non-existent book -> `PERMISSION_DENIED`.
17. **Profile Bio/Avatar Exhaustion or Cross-User Edit**: User A attempts to update User B's `bio`/`avatarUrl` or submits `bio` >400 chars / `avatarUrl` >12000 chars -> `PERMISSION_DENIED`.
18. **Cross-User or Invalid Date Key Reading Log**: User A writes to `/users/userB/readingLogs/2026-11-22` or targets invalid key `/users/userA/readingLogs/bad-date` -> `PERMISSION_DENIED`.
19. **Out-of-Bounds Daily Reading Seconds**: User submits `secondsRead: 999999` or `secondsRead: -10` -> `PERMISSION_DENIED`.
20. **Unauthorized or Oversized Book File Chunk**: Non-admin user attempts write to `/books/{bookId}/fileChunks/{chunkId}` or admin submits `dataBase64` > 600000 chars or `totalChunks` > 60 -> `PERMISSION_DENIED`.
