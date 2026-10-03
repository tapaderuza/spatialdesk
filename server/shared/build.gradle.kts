plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.serialization)
}

kotlin {
    jvmToolchain(libs.versions.jvm.target.get().toInt())

    // The Spring Boot server compiles against this target.
    jvm()

    // The WebXR app (Vite + TypeScript) imports this ES module: the same protocol and clock-sync code runs
    // in the headset's browser. Output: build/dist/js/productionLibrary (with .d.ts typings).
    js {
        outputModuleName = "spatialdesk-shared"
        browser()
        useEsModules()
        binaries.library()
        generateTypeScriptDefinitions()
    }

    sourceSets {
        commonMain.dependencies {
            implementation(libs.kotlinx.serialization.json)
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
        }
    }
}
