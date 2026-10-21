package app.spatialdesk.infra

import software.amazon.awscdk.CfnOutput
import software.amazon.awscdk.Duration
import software.amazon.awscdk.RemovalPolicy
import software.amazon.awscdk.Stack
import software.amazon.awscdk.StackProps
import software.amazon.awscdk.services.cloudfront.AllowedMethods
import software.amazon.awscdk.services.cloudfront.BehaviorOptions
import software.amazon.awscdk.services.cloudfront.CachePolicy
import software.amazon.awscdk.services.cloudfront.Distribution
import software.amazon.awscdk.services.cloudfront.ErrorResponse
import software.amazon.awscdk.services.cloudfront.OriginProtocolPolicy
import software.amazon.awscdk.services.cloudfront.OriginRequestPolicy
import software.amazon.awscdk.services.cloudfront.PriceClass
import software.amazon.awscdk.services.cloudfront.ResponseHeadersPolicy
import software.amazon.awscdk.services.cloudfront.ViewerProtocolPolicy
import software.amazon.awscdk.services.cloudfront.origins.LoadBalancerV2Origin
import software.amazon.awscdk.services.cloudfront.origins.S3BucketOrigin
import software.amazon.awscdk.services.ec2.Peer
import software.amazon.awscdk.services.ec2.Port
import software.amazon.awscdk.services.ec2.SubnetConfiguration
import software.amazon.awscdk.services.ec2.SubnetSelection
import software.amazon.awscdk.services.ec2.SubnetType
import software.amazon.awscdk.services.ec2.Vpc
import software.amazon.awscdk.services.ecr.assets.Platform
import software.amazon.awscdk.services.ecs.AssetImageProps
import software.amazon.awscdk.services.ecs.AwsLogDriverProps
import software.amazon.awscdk.services.ecs.Cluster
import software.amazon.awscdk.services.ecs.ContainerImage
import software.amazon.awscdk.services.ecs.DeploymentCircuitBreaker
import software.amazon.awscdk.services.ecs.LogDrivers
import software.amazon.awscdk.services.ecs.patterns.ApplicationLoadBalancedFargateService
import software.amazon.awscdk.services.ecs.patterns.ApplicationLoadBalancedTaskImageOptions
import software.amazon.awscdk.services.elasticloadbalancingv2.HealthCheck
import software.amazon.awscdk.services.iam.PolicyStatement
import software.amazon.awscdk.services.logs.RetentionDays
import software.amazon.awscdk.services.s3.BlockPublicAccess
import software.amazon.awscdk.services.s3.Bucket
import software.amazon.awscdk.services.s3.BucketEncryption
import software.amazon.awscdk.services.s3.deployment.BucketDeployment
import software.amazon.awscdk.services.s3.deployment.CacheControl
import software.amazon.awscdk.services.s3.deployment.Source
import software.constructs.Construct

/**
 * SpatialDesk on AWS, one stack:
 *
 *   headset browser ──HTTPS/WSS──▶ CloudFront ─┬─ everything else ▶ S3 (private, OAC): the WebXR app
 *                                              └─ /api, /ws       ▶ ALB (CloudFront IPs only) ▶ Fargate: command server
 *
 * (Kotlin nests block comments, so path patterns with a slash-star stay out of KDoc.)
 *
 * One HTTPS origin for the app and its backend: WebXR needs a secure context, there is no CORS to get wrong,
 * and the judges open a single URL. Sized for a competition (one small task); every limit is explicit below.
 */
class SpatialDeskStack(scope: Construct, id: String, props: StackProps) : Stack(scope, id, props) {
    companion object {
        /** Vite's production build, relative to server/infra (the CDK app's working directory). */
        const val SITE_DIR = "../../dist"
        /** AWS-managed CloudFront origin-facing prefix list in us-east-1 (com.amazonaws.global.cloudfront.origin-facing). */
        const val CLOUDFRONT_ORIGIN_PREFIX_LIST = "pl-3b927c52"
        /** The agent's model (chosen by measurement, see NovaPlanModel) and the inference profile it is called through. */
        const val AGENT_MODEL = "amazon.nova-2-lite-v1:0"
        const val AGENT_PROFILE = "us.$AGENT_MODEL"
    }

    init {
        // No NAT gateway: the task gets a public IP in a public subnet, but its security group only admits the ALB.
        val vpc = Vpc.Builder.create(this, "Vpc")
            .maxAzs(2)
            .natGateways(0)
            .subnetConfiguration(
                listOf(SubnetConfiguration.builder().name("public").subnetType(SubnetType.PUBLIC).cidrMask(24).build()),
            )
            .build()
        val cluster = Cluster.Builder.create(this, "Cluster").vpc(vpc).build()

        val server = ApplicationLoadBalancedFargateService.Builder.create(this, "Server")
            .cluster(cluster)
            .cpu(256)
            .memoryLimitMiB(512)
            .desiredCount(1)
            .assignPublicIp(true)
            .taskSubnets(SubnetSelection.builder().subnetType(SubnetType.PUBLIC).build())
            .publicLoadBalancer(true)
            .openListener(false) // only CloudFront may reach the ALB (rule below): no plain-HTTP bypass of its TLS
            .idleTimeout(Duration.seconds(300)) // long-lived headset WebSockets; the server keeps them alive every 25 s
            .circuitBreaker(DeploymentCircuitBreaker.builder().rollback(true).build())
            // Spring Boot on 0.25 vCPU needs ~40-60 s to start; without a grace period the breaker rolls back healthy deploys.
            .healthCheckGracePeriod(Duration.seconds(180))
            .taskImageOptions(
                ApplicationLoadBalancedTaskImageOptions.builder()
                    .image(ContainerImage.fromAsset("../app", AssetImageProps.builder().platform(Platform.LINUX_AMD64).build()))
                    .containerPort(8080)
                    .environment(mapOf("SPATIALDESK_AGENT_MODEL" to AGENT_PROFILE))
                    .logDriver(LogDrivers.awsLogs(AwsLogDriverProps.builder().streamPrefix("server").logRetention(RetentionDays.TWO_WEEKS).build()))
                    .build(),
            )
            .build()
        // The planning agent may call exactly one model: Nova 2 Lite through the US cross-region inference profile
        // (the profile itself, and the model in the regions it routes to). Converse needs bedrock:InvokeModel only.
        server.taskDefinition.taskRole.addToPrincipalPolicy(
            PolicyStatement.Builder.create()
                .actions(listOf("bedrock:InvokeModel"))
                .resources(
                    listOf(
                        "arn:aws:bedrock:${this.region}:${this.account}:inference-profile/$AGENT_PROFILE",
                        "arn:aws:bedrock:*::foundation-model/$AGENT_MODEL",
                    ),
                )
                .build(),
        )
        // Voice commands: the server presigns Transcribe streaming URLs with this role, so the role must be allowed to
        // stream. Transcribe has no resource-level permissions for streaming; the server's quotas bound the use.
        server.taskDefinition.taskRole.addToPrincipalPolicy(
            PolicyStatement.Builder.create()
                .actions(listOf("transcribe:StartStreamTranscriptionWebSocket"))
                .resources(listOf("*"))
                .build(),
        )
        server.targetGroup.configureHealthCheck(HealthCheck.builder().path("/actuator/health/liveness").healthyHttpCodes("200").build())
        // Headsets reconnect on their own: no need to wait the default 5 minutes for old connections to drain.
        server.targetGroup.setAttribute("deregistration_delay.timeout_seconds", "30")
        server.loadBalancer.connections.allowFrom(Peer.prefixList(CLOUDFRONT_ORIGIN_PREFIX_LIST), Port.tcp(80), "CloudFront origin-facing IPs only")

        val site = Bucket.Builder.create(this, "Site")
            .blockPublicAccess(BlockPublicAccess.BLOCK_ALL)
            .encryption(BucketEncryption.S3_MANAGED)
            .enforceSsl(true)
            .removalPolicy(RemovalPolicy.DESTROY)
            .autoDeleteObjects(true)
            .build()

        val apiBehavior = BehaviorOptions.builder()
            .origin(LoadBalancerV2Origin.Builder.create(server.loadBalancer).protocolPolicy(OriginProtocolPolicy.HTTP_ONLY).readTimeout(Duration.seconds(60)).build())
            .viewerProtocolPolicy(ViewerProtocolPolicy.HTTPS_ONLY)
            .allowedMethods(AllowedMethods.ALLOW_ALL)
            .cachePolicy(CachePolicy.CACHING_DISABLED)
            .originRequestPolicy(OriginRequestPolicy.ALL_VIEWER) // forwards the WebSocket upgrade headers and query string
            .build()

        val cdn = Distribution.Builder.create(this, "Cdn")
            .comment("SpatialDesk Command Center")
            .priceClass(PriceClass.PRICE_CLASS_100)
            .defaultRootObject("index.html")
            .defaultBehavior(
                BehaviorOptions.builder()
                    .origin(S3BucketOrigin.withOriginAccessControl(site))
                    .viewerProtocolPolicy(ViewerProtocolPolicy.REDIRECT_TO_HTTPS)
                    .cachePolicy(CachePolicy.CACHING_OPTIMIZED)
                    .responseHeadersPolicy(ResponseHeadersPolicy.SECURITY_HEADERS)
                    .build(),
            )
            .additionalBehaviors(mapOf("/api/*" to apiBehavior, "/ws*" to apiBehavior))
            // A refresh on a deep link still lands on the app.
            .errorResponses(
                listOf(ErrorResponse.builder().httpStatus(403).responseHttpStatus(200).responsePagePath("/index.html").ttl(Duration.seconds(0)).build()),
            )
            .build()

        BucketDeployment.Builder.create(this, "SiteDeployment")
            .sources(listOf(Source.asset(SITE_DIR)))
            .destinationBucket(site)
            .distribution(cdn) // invalidates CloudFront so judges always get the latest build
            .distributionPaths(listOf("/*"))
            .cacheControl(listOf(CacheControl.fromString("public, max-age=300")))
            .memoryLimit(512)
            .build()

        CfnOutput.Builder.create(this, "AppUrl").value("https://${cdn.distributionDomainName}").description("Open this on a Meta Quest (or ?emulate on a desktop browser)").build()
        CfnOutput.Builder.create(this, "LoadBalancerDns").value(server.loadBalancer.loadBalancerDnsName).build()
    }
}
