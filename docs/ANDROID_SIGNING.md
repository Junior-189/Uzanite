# Android release signing

**Written for: whoever builds and publishes the UZANITE Android app.**

## Why this changed

The release signing password used to be hard-coded in `client/android/app/build.gradle`:

```gradle
storePassword 'whatsappsaas123'
keyPassword 'whatsappsaas123'
```

The keystore file itself was git-ignored, so the key material was not in the
repository — but the password was, in plain text, for anyone with repository
access. Combined with a copy of `release-key.jks` from any build machine or CI
cache, that is enough to sign an APK that Android will accept as a genuine
UZANITE update.

## What you must do once

1. **Treat the existing key as compromised and rotate it.**
   Generate a new keystore, publish an update signed with the new key, and if
   the app is on Google Play, enrol in [Play App Signing] so Google holds the
   release key and a leak of the upload key is recoverable.

   ```bash
   keytool -genkeypair -v \
     -keystore uzanite-release.jks \
     -alias uzanite \
     -keyalg RSA -keysize 4096 -validity 10000
   ```

2. **Store the new password in a password manager**, not in the repository, not
   in a chat message, and not in a build script.

3. **Back up the keystore somewhere durable.** Losing it means you can never
   ship an update to existing installs under the same app identity.

## How builds get the credentials now

Either environment variables (preferred for CI):

```bash
export UZANITE_KEYSTORE_PATH=/secure/path/uzanite-release.jks
export UZANITE_KEYSTORE_PASSWORD='...'
export UZANITE_KEY_ALIAS=uzanite
export UZANITE_KEY_PASSWORD='...'
npm run cap:build:release
```

Or an untracked `client/android/keystore.properties` (git-ignored) for local
builds:

```properties
storeFile=/secure/path/uzanite-release.jks
storePassword=...
keyAlias=uzanite
keyPassword=...
```

If none of these are set, the release signing config is left unconfigured and
Gradle logs a warning rather than silently producing an APK signed with the
wrong key.

## Other hardening applied alongside this

| Setting | Before | After | Why |
|---|---|---|---|
| `android:allowBackup` | `true` | `false` | App data included the session and the offline business database; `adb backup` could extract it |
| `dataExtractionRules` | absent | excludes all domains | Blocks cloud backup and device-to-device transfer of app data |
| `allowMixedContent` | `true` | `false` | Stopped the WebView loading plaintext resources inside an https page, which is an active MITM injection path on untrusted networks |
| `minifyEnabled` (release) | `false` | `true` + `shrinkResources` | A readable release bundle hands an attacker a map of the app |

[Play App Signing]: https://developer.android.com/studio/publish/app-signing#app-signing-google-play
