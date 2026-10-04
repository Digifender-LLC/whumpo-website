# StatusBadge

A status with an icon and a word — colour is never the only signal.

- `status`: `ready` (mint — live, connected, healthy), `working` (sunshine — building, checking), `attention` (coral — failed, blocked, needs approval), `idle` (not started).
- `children` overrides the default word with a specific one: "Live", "Connected", "Active".
- Only show `ready` after the system has verified it. Never claim success early.
