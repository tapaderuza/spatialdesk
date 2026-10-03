package app.spatialdesk.infra

import software.amazon.awscdk.App
import software.amazon.awscdk.Environment
import software.amazon.awscdk.StackProps
import software.amazon.awscdk.assertions.Match
import software.amazon.awscdk.assertions.Template
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SpatialDeskStackTest {
    private val template = Template.fromStack(
        SpatialDeskStack(
            App(),
            "Test",
            StackProps.builder().env(Environment.builder().account("123456789012").region("us-east-1").build()).build(),
        ),
    )

    @Test
    fun `one HTTPS origin - app from S3, api and websocket to the load balancer`() {
        template.hasResourceProperties(
            "AWS::CloudFront::Distribution",
            mapOf(
                "DistributionConfig" to Match.objectLike(
                    mapOf(
                        "DefaultRootObject" to "index.html",
                        "DefaultCacheBehavior" to Match.objectLike(mapOf("ViewerProtocolPolicy" to "redirect-to-https")),
                        "CacheBehaviors" to Match.arrayWith(
                            listOf(
                                Match.objectLike(mapOf("PathPattern" to "/api/*", "ViewerProtocolPolicy" to "https-only")),
                                Match.objectLike(mapOf("PathPattern" to "/ws*", "ViewerProtocolPolicy" to "https-only")),
                            ),
                        ),
                    ),
                ),
            ),
        )
    }

    @Test
    fun `the site bucket is never public`() {
        template.hasResourceProperties(
            "AWS::S3::Bucket",
            mapOf(
                "PublicAccessBlockConfiguration" to mapOf(
                    "BlockPublicAcls" to true, "BlockPublicPolicy" to true, "IgnorePublicAcls" to true, "RestrictPublicBuckets" to true,
                ),
            ),
        )
    }

    @Test
    fun `only cloudfront can reach the load balancer`() {
        template.hasResourceProperties(
            "AWS::EC2::SecurityGroupIngress",
            mapOf("SourcePrefixListId" to "pl-3b927c52", "FromPort" to 80, "ToPort" to 80, "IpProtocol" to "tcp"),
        )
        val rules = template.findResources("AWS::EC2::SecurityGroup").values + template.findResources("AWS::EC2::SecurityGroupIngress").values
        assertFalse(rules.any { it.toString().contains("CidrIp=0.0.0.0/0") && it.toString().contains("FromPort=80") })
    }

    @Test
    fun `small task, websockets kept alive, deploys survive a slow first boot`() {
        template.hasResourceProperties("AWS::ECS::TaskDefinition", mapOf("Cpu" to "256", "Memory" to "512"))
        template.hasResourceProperties(
            "AWS::ElasticLoadBalancingV2::LoadBalancer",
            mapOf("LoadBalancerAttributes" to Match.arrayWith(listOf(mapOf("Key" to "idle_timeout.timeout_seconds", "Value" to "300")))),
        )
        template.hasResourceProperties("AWS::ECS::Service", mapOf("HealthCheckGracePeriodSeconds" to 180))
        template.resourceCountIs("AWS::EC2::NatGateway", 0)
        assertTrue(template.toJSON().toString().contains("AppUrl"))
    }
}
