plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "in.acronix.acronix_inventory"
    // 37, not flutter.compileSdkVersion (36).
    //
    // flutter_secure_storage 11 declares in its AAR metadata that anything
    // depending on it must compile against API 37 or later, so the build fails at
    // :app:checkDebugAarMetadata with 36. That plugin is not optional — it is where
    // the refresh token lives, and MOBILE.md is explicit that it must not be
    // SharedPreferences.
    //
    // AGP 9.1.0 says its "maximum recommended" compileSdk is 36. That is a
    // recommendation, not a limit, and it builds. Drop this line once Flutter's own
    // default reaches 37.
    //
    // compileSdk only decides which APIs can be compiled against; minSdk and
    // targetSdk are untouched, so which phones can install the app does not change.
    compileSdk = 37
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "in.acronix.acronix_inventory"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    buildTypes {
        release {
            // TODO: Add your own signing config for the release build.
            // Signing with the debug keys for now, so `flutter run --release` works.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
