# סל זול – Android build

`salzol-android-arm64.apk` — release build for 64-bit ARM phones (nearly all phones from 2017 on).

- Built from the commit that added it (`git log -1 -- releases/`), with `scripts/build-go.sh android`, `npx expo prebuild -p android` and `./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a`.
- Signed with the debug key, so it is for sideloading and testing, not the Play Store. Android may ask you to allow installs from this source.
- Not yet run on a physical device. CI runs it on an emulator with Maestro; see `.github/workflows/salzol-app.yml`.
- Check the download against `SHA256SUMS`.
