plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.compose)
}

android {
    namespace = "com.whumpo.android"
    compileSdk = libs.versions.compileSdk.get().toInt()

    defaultConfig {
        // Provisional package identity: Play/package/signing identity is an open owner
        // decision (docs/mobile-api-v1.md#open-owner-decisions) and is not release authority.
        applicationId = "com.whumpo.android"
        minSdk = libs.versions.minSdk.get().toInt()
        targetSdk = libs.versions.targetSdk.get().toInt()
        versionCode = 4
        versionName = "0.4.0-reviews"
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

    sourceSets.getByName("test").resources.directories.add(rootProject.file("../tests/fixtures/mobile-v1").path)

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
    implementation(project(":core"))
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play.services)
    implementation(libs.androidx.browser)
    implementation(libs.okhttp)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.kotlinx.coroutines.core)

    testImplementation(libs.junit4)
    // Android supplies org.json; use its strict JVM counterpart for transport acceptance.
    testImplementation(libs.json)
    testImplementation(libs.kotlinx.coroutines.test)

    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.test.core)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.kotlinx.coroutines.test)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}
