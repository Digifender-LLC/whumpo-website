// Kotlin Multiplatform module shared by the Android app (and later the desktop app).
// Targets: Android (library) and JVM (desktop). No iOS target until iOS is scoped.
plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.android.kmp.library)
    alias(libs.plugins.compose.multiplatform)
    alias(libs.plugins.compose.compiler)
    alias(libs.plugins.kotlin.serialization)
}

kotlin {
    androidLibrary {
        namespace = "com.whumpo.shared"
        compileSdk = libs.versions.compileSdk.get().toInt()
        minSdk = libs.versions.minSdk.get().toInt()
        withHostTest {}
        // Packages Compose resources (the bundled fonts) for Android.
        androidResources { enable = true }
    }
    jvm()

    compilerOptions {
        allWarningsAsErrors.set(true)
    }

    sourceSets {
        // shortcut: java.io/java.security code is shared by the two JVM-based targets through a
        // source directory instead of expect/actual; switch to expect/actual when a non-JVM target arrives.
        val jvmCommonMain = "src/jvmCommonMain/kotlin"
        val jvmCommonTest = "src/jvmCommonTest/kotlin"
        androidMain { kotlin.srcDir(jvmCommonMain) }
        jvmMain { kotlin.srcDir(jvmCommonMain) }
        getByName("androidHostTest") { kotlin.srcDir(jvmCommonTest) }
        jvmTest { kotlin.srcDir(jvmCommonTest) }

        commonMain.dependencies {
            implementation(libs.compose.runtime)
            implementation(libs.compose.animation.core)
            implementation(libs.compose.components.resources)
            implementation(libs.compose.foundation)
            implementation(libs.compose.material3)
            implementation(libs.compose.ui)
            api(libs.kotlinx.coroutines.core)
            api(libs.jetbrains.lifecycle.viewmodel)
        }
        commonTest.dependencies {
            implementation(libs.kotlin.test)
        }
        jvmTest.dependencies {
            implementation(libs.junit4)
            implementation(libs.kotlinx.coroutines.test)
        }
        getByName("androidHostTest").dependencies {
            implementation(libs.junit4)
            implementation(libs.kotlinx.coroutines.test)
        }
    }
}

compose.resources {
    packageOfResClass = "com.whumpo.shared.resources"
    publicResClass = false
}
