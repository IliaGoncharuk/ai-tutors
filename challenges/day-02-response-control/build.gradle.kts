plugins {
    kotlin("jvm") version "2.1.20"
    id("org.jetbrains.kotlin.plugin.compose") version "2.1.20"
    id("org.jetbrains.compose") version "1.8.2"
}
repositories { google(); mavenCentral() }
dependencies {
    implementation(compose.desktop.currentOs)
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-swing:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    implementation("com.squareup.okhttp3:okhttp-sse:4.12.0")
    testImplementation(kotlin("test-junit"))
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
}
kotlin { jvmToolchain(21) }
compose.desktop { application { mainClass = "MainKt" } }
