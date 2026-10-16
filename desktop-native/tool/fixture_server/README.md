# Local v1 fixture server

A small HTTP server that speaks the v1 wire contract (`desktop-native/contracts/v1`) with
in-memory state, so the native app can run against real HTTP without touching production.
The exam endpoints are the foundation's stateful `FixtureV1Api`; the server adds the HTTP
layer: the sign-in form's login (any login, any password but `wrong`; login `nopass` gets 403
`password_not_set`), JWT-shaped tokens with `exp`, refresh rotation, 401s, the
426 version gate, `ETag` / `304` on Home, gzip and the `Date` header.

```sh
source desktop-native/tool/env.sh
cd desktop-native/tool/fixture_server && flutter pub get
dart run bin/fixture_server.dart --port 8765 --verbose      # --help for the options

# the app (sign in with any login and any password except "wrong")
cd desktop-native/app
flutter run -d macos --dart-define=MASTERSAT_API_BASE=http://127.0.0.1:8765
```

The macOS dev runner is sandboxed and needs `com.apple.security.network.client` to reach the
server (windows-host owns `app/macos/Runner/DebugProfile.entitlements`; until it is added, an
ad-hoc re-sign of the built app with that entitlement works for local runs).

Control endpoints (any HTTP client, e.g. `curl -X POST`):

| Path | Effect |
|---|---|
| `/__fixture__/offline?on=1\|0` | drop every `/api` request (the app sees no connection) |
| `/__fixture__/expire-access` | the next call gets 401; the app refreshes once and retries |
| `/__fixture__/revoke` | the refresh is refused too: the session ends |
| `/__fixture__/update?mode=available\|required\|none\|fixture` | what Home's `app.update` says |
| `/__fixture__/minimum-version?v=0.3.0` | 426 for older clients (`v=` clears it) |
| `/__fixture__/latency?ms=800` | slow every answer down |
| `/__fixture__/reset` | fresh state, every token revoked |
| `/__fixture__/state` (GET) | what is set |

The app's end-to-end tests run against this server in-process:
`app/test/core/http/fixture_server_e2e_test.dart`.
