plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.compose.compiler)
}

android {
  namespace = "com.thecfbhub.app"
  compileSdk = 36

  defaultConfig {
    applicationId = "com.thecfbhub.app"
    minSdk = 24
    targetSdk = 36
    versionCode = 2
    versionName = "2.0.0"

    buildConfigField("String", "BACKEND_BASE_URL", "\"https://thecfbhub.netlify.app\"")
    buildConfigField("String", "ESPN_BASE_URL", "\"https://site.api.espn.com/apis/site/v2/sports/football/college-football\"")
    buildConfigField("String", "ESPN_STANDINGS_URL", "\"https://site.api.espn.com/apis/v2/sports/football/college-football/standings\"")
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  buildFeatures {
    compose = true
    buildConfig = true
    aidl = false
    shaders = false
  }

  packaging {
    resources {
      excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
  }
}

kotlin {
  jvmToolchain(17)
}

dependencies {
  val composeBom = platform(libs.androidx.compose.bom)
  implementation(composeBom)

  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.activity.compose)
  implementation(libs.androidx.lifecycle.runtime.ktx)
  implementation(libs.androidx.lifecycle.runtime.compose)
  implementation(libs.androidx.lifecycle.viewmodel.compose)

  implementation(libs.androidx.compose.ui)
  implementation(libs.androidx.compose.ui.graphics)
  implementation(libs.androidx.compose.ui.tooling.preview)
  implementation(libs.androidx.compose.material3)
  implementation(libs.androidx.compose.material.icons.extended)
  debugImplementation(libs.androidx.compose.ui.tooling)

  implementation(libs.androidx.browser)
  implementation(libs.coil.compose)
  implementation(libs.kotlinx.coroutines.android)
  implementation(libs.okhttp)

  testImplementation(libs.junit)
  testImplementation(libs.org.json)
}
