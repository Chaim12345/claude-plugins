plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "il.salzol.spikeapp"
    compileSdk = 36
    defaultConfig {
        applicationId = "il.salzol.spikeapp"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "0.1"
    }
    buildFeatures { compose = true }
    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

dependencies {
    implementation(files("libs/spike.aar"))
    implementation(platform("androidx.compose:compose-bom:2025.01.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.9.3")
}
