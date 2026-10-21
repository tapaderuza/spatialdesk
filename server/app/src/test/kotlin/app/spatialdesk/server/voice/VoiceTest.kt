package app.spatialdesk.server.voice

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Import
import org.springframework.context.annotation.Primary
import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider
import software.amazon.awssdk.auth.credentials.AwsSessionCredentials
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Instant

class SigV4Test {
    @Test
    fun `matches the presigned URL example in AWS's query-parameter authentication document`() {
        val query = SigV4.presign(
            method = "GET",
            host = "examplebucket.s3.amazonaws.com",
            path = "/test.txt",
            query = emptyMap(),
            service = "s3",
            region = "us-east-1",
            credentials = SigV4.Credentials("AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"),
            time = Instant.parse("2013-05-24T00:00:00Z"),
            expiresSeconds = 86400,
            payloadHash = "UNSIGNED-PAYLOAD",
        )
        assertEquals(
            "X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request" +
                "&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host" +
                "&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
            query,
        )
    }
}

@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = ["spatialdesk.voice.per-session-per-hour=2", "spatialdesk.agent.mode=built-in"],
)
@Import(VoiceApiTest.FixedCredentials::class)
class VoiceApiTest {
    @TestConfiguration
    class FixedCredentials {
        @Bean
        @Primary
        fun testCredentials(): AwsCredentialsProvider =
            StaticCredentialsProvider.create(AwsSessionCredentials.create("AKIDEXAMPLE", "secret", "token/with+chars"))
    }

    @LocalServerPort
    private var port: Int = 0

    private val http = HttpClient.newHttpClient()

    private fun post(path: String, session: String? = null, body: String = ""): HttpResponse<String> =
        http.send(
            HttpRequest.newBuilder(URI.create("http://localhost:$port$path"))
                .header("X-Forwarded-For", "198.51.100.${(1..250).random()}, 10.0.0.1")
                .header("Content-Type", "application/json")
                .apply { if (session != null) header("X-Session", session) }
                .POST(HttpRequest.BodyPublishers.ofString(body)).build(),
            HttpResponse.BodyHandlers.ofString(),
        )

    private fun newSession(): String = Regex("\"sessionId\":\"([^\"]+)\"").find(post("/api/sessions").body())!!.groupValues[1]

    @Test
    fun `a session gets a presigned Transcribe URL in its language, within its quota`() {
        val session = newSession()

        val spanish = post("/api/voice/session", session, """{"language":"es-ES"}""")
        assertEquals(200, spanish.statusCode(), spanish.body())
        val url = Regex("\"url\":\"([^\"]+)\"").find(spanish.body())!!.groupValues[1]
        assertTrue(url.startsWith("wss://transcribestreaming.us-east-1.amazonaws.com:8443/stream-transcription-websocket?"), url)
        for (part in listOf("language-code=es-ES", "media-encoding=pcm", "sample-rate=16000", "X-Amz-Security-Token=token%2Fwith%2Bchars", "X-Amz-Signature=")) {
            assertTrue(part in url, "$part in $url")
        }

        val unknown = post("/api/voice/session", session, """{"language":"xx-XX"}""")
        assertTrue("\"language\":\"en-US\"" in unknown.body(), unknown.body()) // anything else is heard as US English

        val third = post("/api/voice/session", session, "{}")
        assertEquals(429, third.statusCode())
        assertTrue("voice commands this hour" in third.body(), third.body())

        assertEquals(401, post("/api/voice/session", null, "{}").statusCode())
    }
}
