plugins {
    alias(libs.plugins.kotlin.jvm)
    application
}

kotlin {
    jvmToolchain(libs.versions.jvm.target.get().toInt())
}

dependencies {
    implementation(libs.aws.cdk.lib)
    implementation(libs.constructs)
    testImplementation(kotlin("test"))
}

application {
    mainClass.set("app.spatialdesk.infra.InfraAppKt")
}

// `cdk synth/deploy` (cdk.json -> cdk-app.mjs) runs this task; asset paths are relative to server/infra.
tasks.named<JavaExec>("run") {
    workingDir = projectDir
}

tasks.test {
    useJUnitPlatform()
    workingDir = projectDir
}
