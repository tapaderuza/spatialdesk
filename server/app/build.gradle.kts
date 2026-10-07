import org.springframework.boot.gradle.plugin.SpringBootPlugin

plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.spring)
    alias(libs.plugins.spring.boot)
    alias(libs.plugins.kotlin.serialization)
}

kotlin {
    jvmToolchain(libs.versions.jvm.target.get().toInt())
    compilerOptions { freeCompilerArgs.addAll("-Xjsr305=strict") }
}

dependencies {
    // Boot's BOM as a platform so it never downgrades what :shared was compiled against (ScreenDesk lesson).
    implementation(platform(SpringBootPlugin.BOM_COORDINATES))
    implementation(project(":shared")) // jvm target: the same protocol the headset runs
    implementation(libs.spring.boot.starter.web)
    implementation(libs.spring.boot.starter.websocket)
    implementation(libs.spring.boot.starter.actuator)
    implementation(libs.jackson.module.kotlin)
    implementation(libs.kotlin.reflect)
    implementation(libs.kotlinx.serialization.json) // the agent speaks the shared module's JSON
    // The planning agent: Amazon Nova on Bedrock (Converse API, forced tool use).
    implementation(platform(libs.aws.sdk.bom))
    implementation(libs.aws.sdk.bedrockruntime)
    testImplementation(libs.spring.boot.starter.test)
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test { useJUnitPlatform() }

// infra/ builds the container from this fixed name.
tasks.bootJar { archiveFileName.set("app.jar") }
