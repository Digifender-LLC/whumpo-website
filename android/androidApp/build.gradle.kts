plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.compose.compiler)
}

android {
    namespace = "com.whumpo.android"
    compileSdk = libs.versions.compileSdk.get().toInt()

    defaultConfig {
        // Final package identity, confirmed by the owner on 2026-10-29 (Q-005). It is permanent
        // once uploaded. This is not release authority: signing and Play actions stay with the owner.
        applicationId = "com.whumpo.android"
        minSdk = libs.versions.minSdk.get().toInt()
        targetSdk = libs.versions.targetSdk.get().toInt()
        versionCode = 1
        versionName = "0.1.0-shell"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // Two environments only. `local` talks to the developer's own `pnpm dev` server over
    // device loopback (adb reverse); `deployed` targets the private test platform.
    // WhumpoEnvironment validates both values at startup.
    flavorDimensions += "environment"
    productFlavors {
        create("local") {
            dimension = "environment"
            applicationIdSuffix = ".local"
            versionNameSuffix = "-local"
            buildConfigField("String", "WHUMPO_ENVIRONMENT", "\"local\"")
            buildConfigField("String", "WHUMPO_ORIGIN", "\"http://127.0.0.1:8787\"")
        }
        create("deployed") {
            dimension = "environment"
            buildConfigField("String", "WHUMPO_ENVIRONMENT", "\"test\"")
            buildConfigField("String", "WHUMPO_ORIGIN", "\"https://whumpo.com\"")
        }
    }

    buildTypes {
        release {
            // No signing config: signed releases are WH-087 and need owner-held keys.
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = false
        // Version-upgrade nags are not actionable for a pinned toolchain; upgrades are
        // deliberate (see docs/android-build.md) and these checks need network metadata.
        disable += setOf("GradleDependency", "AndroidGradlePluginVersion", "NewerVersionAvailable", "OldTargetApi")
    }
}

// AGP 9 compiles Kotlin itself (built-in Kotlin, no kotlin-android plugin):
// https://developer.android.com/build/migrate-to-built-in-kotlin
kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

dependencies {
    implementation(project(":shared"))
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.browser)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.credentials)
    // Passkeys through Google Password Manager on Android 13 and older (API 28 to 33).
    implementation(libs.androidx.credentials.play.services.auth)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.kotlinx.coroutines.core)

    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.compose.ui.test.junit4.accessibility)
    androidTestImplementation(libs.androidx.test.core)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.kotlinx.coroutines.test)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}
