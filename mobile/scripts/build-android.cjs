// Windows local release build. Signing credentials stay on this computer.
const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const root = resolve(__dirname, '..');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`);
}
try {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
  if (!existsSync(sdk)) throw new Error('Install the Android SDK or set ANDROID_HOME before building.');
  if (!process.argv.includes('--skip-prebuild')) {
    run(process.execPath, [join(root, 'node_modules/expo/bin/cli'), 'prebuild', '--platform', 'android', '--no-install']);
  } else if (!existsSync(join(root, 'android/app/build.gradle'))) {
    throw new Error('Run a full local build once before using --skip-prebuild.');
  }
  const credentialDir = join(root, '.credentials'); mkdirSync(credentialDir, { recursive: true });
  const metadataPath = join(credentialDir, 'signing.json');
  const keystorePath = join(credentialDir, 'jay-ai-upload.jks');
  let signing;
  if (existsSync(metadataPath)) {
    signing = JSON.parse(readFileSync(metadataPath, 'utf8'));
    if (!existsSync(keystorePath)) throw new Error('Restore the original .credentials/jay-ai-upload.jks; do not replace the signing key for an existing app.');
  } else {
    if (existsSync(keystorePath)) throw new Error('Keystore exists but its signing metadata is missing. Restore signing.json.');
    signing = { alias: 'jay-ai-upload', password: randomBytes(32).toString('hex') };
    const keytool = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', 'keytool.exe') : 'keytool.exe';
    run(keytool, ['-genkeypair', '-v', '-keystore', keystorePath, '-storetype', 'JKS', '-alias', signing.alias, '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=JAY AI', '-storepass:env', 'JAY_SIGNING_PASSWORD', '-keypass:env', 'JAY_SIGNING_PASSWORD'], { env: { ...process.env, JAY_SIGNING_PASSWORD: signing.password } });
    writeFileSync(metadataPath, JSON.stringify(signing), { mode: 0o600 });
  }
  const gradlePath = join(root, 'android/app/build.gradle');
  let gradle = readFileSync(gradlePath, 'utf8');
  if (!gradle.includes('JAY_ANDROID_KEYSTORE')) {
    if (!gradle.includes('signingConfigs {') || !/release \{[\s\S]*?signingConfig signingConfigs\.debug/.test(gradle)) throw new Error('Android template changed; review release signing before building.');
    gradle = gradle.replace('signingConfigs {', `signingConfigs {
        localRelease {
        def keystorePath = System.getenv("JAY_ANDROID_KEYSTORE")
        storeFile keystorePath ? file(keystorePath) : null
            storePassword System.getenv("JAY_SIGNING_PASSWORD")
            keyAlias System.getenv("JAY_SIGNING_ALIAS")
            keyPassword System.getenv("JAY_SIGNING_PASSWORD")
        }`);
    gradle = gradle.replace(/(release \{[\s\S]*?signingConfig )signingConfigs\.debug/, '$1signingConfigs.localRelease');
    writeFileSync(gradlePath, gradle);
  }
  const env = { ...process.env, ANDROID_HOME: sdk, NODE_ENV: 'production', JAY_ANDROID_KEYSTORE: keystorePath, JAY_SIGNING_PASSWORD: signing.password, JAY_SIGNING_ALIAS: signing.alias };
  // Only fixed Gradle arguments go through cmd.exe; secrets are environment variables.
  run('cmd.exe', ['/d', '/s', '/c', 'gradlew.bat :app:assembleRelease --no-daemon --max-workers=2 -PreactNativeArchitectures=arm64-v8a,x86_64'], { cwd: join(root, 'android'), env });
  const output = join(root, 'artifacts'); mkdirSync(output, { recursive: true });
  copyFileSync(join(root, 'android/app/build/outputs/apk/release/app-release.apk'), join(output, 'JAY-AI-android.apk'));
  console.log('Created mobile/artifacts/JAY-AI-android.apk. Back up mobile/.credentials privately for future updates.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
