package app.spatialdesk.infra

import software.amazon.awscdk.App
import software.amazon.awscdk.Environment
import software.amazon.awscdk.StackProps
import software.amazon.awscdk.assertions.Match
import software.amazon.awscdk.assertions.Template
import kotlin.test.Test
import kotlin.test.assertEquals
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

    @Test
    fun `the agent may invoke Nova 2 Lite and nothing else`() {
        template.hasResourceProperties(
            "AWS::IAM::Policy",
            mapOf(
                "PolicyDocument" to Match.objectLike(
                    mapOf(
                        "Statement" to Match.arrayWith(
                            listOf(
                                Match.objectLike(
                                    mapOf(
                                        "Action" to "bedrock:InvokeModel",
                                        "Resource" to listOf(
                                            "arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.amazon.nova-2-lite-v1:0",
                                            "arn:aws:bedrock:*::foundation-model/amazon.nova-2-lite-v1:0",
                                        ),
                                    ),
                                ),
                            ),
                        ),
                    ),
                ),
            ),
        )
        // Every statement that grants a Bedrock action: never "bedrock:*", never on every resource.
        @Suppress("UNCHECKED_CAST")
        val statements = template.findResources("AWS::IAM::Policy").values.flatMap { policy ->
            val document = (policy["Properties"] as Map<String, Any>)["PolicyDocument"] as Map<String, Any>
            document["Statement"] as List<Map<String, Any>>
        }
        val bedrock = statements.filter { s -> listOf(s["Action"]).flatMap { if (it is List<*>) it else listOf(it) }.any { "$it".startsWith("bedrock:") } }
        assertEquals(1, bedrock.size, "one Bedrock grant")
        assertFalse(bedrock.any { it["Action"] == "bedrock:*" || it["Resource"] == "*" }, "no wildcard Bedrock action or resource")
        template.hasResourceProperties(
            "AWS::ECS::TaskDefinition",
            mapOf(
                "ContainerDefinitions" to Match.arrayWith(
                    listOf(Match.objectLike(mapOf("Environment" to Match.arrayWith(listOf(mapOf("Name" to "SPATIALDESK_AGENT_MODEL", "Value" to "us.amazon.nova-2-lite-v1:0")))))),
                ),
            ),
        )
    }
}
