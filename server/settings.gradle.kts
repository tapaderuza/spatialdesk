rootProject.name = "spatialdesk-server"

pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "0.10.0"
}

dependencyResolutionManagement {
    repositories {
        mavenCentral()
    }
}

include(":shared") // KMP: wire protocol + clock sync, compiled for the JVM (server) and JS (the headset's browser)
include(":app")    // Spring Boot 3: REST + WebSocket hub
include(":infra")  // AWS CDK (Kotlin): S3 + CloudFront for the WebXR app, ECS Fargate for the backend
