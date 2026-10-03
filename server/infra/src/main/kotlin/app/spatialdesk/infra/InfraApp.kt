package app.spatialdesk.infra

import software.amazon.awscdk.App
import software.amazon.awscdk.Environment
import software.amazon.awscdk.StackProps
import software.amazon.awscdk.Tags
import java.io.File

fun main() {
    // `cdk deploy` packages these two artifacts; fail early with the fix instead of a Docker or upload error.
    val jar = File("../app/build/libs/app.jar")
    require(jar.exists()) { "Missing ${jar.canonicalPath}. Run `gradlew :app:bootJar` first (scripts/deploy.mjs does it)." }
    val site = File(SpatialDeskStack.SITE_DIR, "index.html")
    require(site.exists()) { "Missing ${site.canonicalPath}. Run `npm run build` in the repo root first (scripts/deploy.mjs does it)." }

    val app = App()
    SpatialDeskStack(
        app,
        "SpatialDesk",
        StackProps.builder()
            // us-east-1: same account/region as the CDK bootstrap, and Bedrock (Nova) for the agent in week 3.
            .env(Environment.builder().account(System.getenv("CDK_DEFAULT_ACCOUNT")).region("us-east-1").build())
            .description("SpatialDesk Command Center - WebXR app + command server (Meta VR Start Developer Competition 2026)")
            .build(),
    )
    Tags.of(app).add("project", "spatialdesk")
    app.synth()
}
