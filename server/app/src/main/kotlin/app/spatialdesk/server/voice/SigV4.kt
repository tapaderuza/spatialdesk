package app.spatialdesk.server.voice

import java.net.URLEncoder
import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.TreeMap
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * AWS Signature Version 4 in its query-string form (a presigned URL), as AWS specifies it in "Authenticating
 * Requests: Using Query Parameters". Written out because the SDK has no presigner for Transcribe's WebSocket
 * endpoint; SigV4Test checks it against the worked example in that document.
 */
object SigV4 {
    private const val ALGORITHM = "AWS4-HMAC-SHA256"
    private val STAMP = DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'").withZone(ZoneOffset.UTC)

    /** SHA-256 of an empty body, the payload hash for a request without one. */
    val EMPTY_PAYLOAD: String = hex(sha256(""))

    /** The query string of a presigned [method] request to https://[host][path], signature last. */
    fun presign(
        method: String,
        host: String,
        path: String,
        query: Map<String, String>,
        service: String,
        region: String,
        credentials: Credentials,
        time: Instant,
        expiresSeconds: Int,
        payloadHash: String = EMPTY_PAYLOAD,
    ): String {
        val stamp = STAMP.format(time)
        val date = stamp.take(8)
        val scope = "$date/$region/$service/aws4_request"
        // Sorted by name, as the canonical request requires (uppercase X-Amz-* sort before lowercase names).
        val params = TreeMap(query)
        params["X-Amz-Algorithm"] = ALGORITHM
        params["X-Amz-Credential"] = "${credentials.accessKey}/$scope"
        params["X-Amz-Date"] = stamp
        params["X-Amz-Expires"] = expiresSeconds.toString()
        params["X-Amz-SignedHeaders"] = "host"
        credentials.sessionToken?.let { params["X-Amz-Security-Token"] = it }
        val canonicalQuery = params.entries.joinToString("&") { (name, value) -> "${encode(name)}=${encode(value)}" }
        val canonicalRequest = "$method\n$path\n$canonicalQuery\nhost:$host\n\nhost\n$payloadHash"
        val stringToSign = "$ALGORITHM\n$stamp\n$scope\n${hex(sha256(canonicalRequest))}"
        val key = listOf(date, region, service, "aws4_request").fold("AWS4${credentials.secretKey}".toByteArray(UTF_8), ::hmac)
        return "$canonicalQuery&X-Amz-Signature=${hex(hmac(key, stringToSign))}"
    }

    data class Credentials(val accessKey: String, val secretKey: String, val sessionToken: String? = null)

    /** RFC 3986: only unreserved characters stay as they are. */
    private fun encode(value: String): String =
        URLEncoder.encode(value, UTF_8).replace("+", "%20").replace("*", "%2A").replace("%7E", "~")

    private fun sha256(text: String): ByteArray = MessageDigest.getInstance("SHA-256").digest(text.toByteArray(UTF_8))

    private fun hmac(key: ByteArray, data: String): ByteArray =
        Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(key, "HmacSHA256")) }.doFinal(data.toByteArray(UTF_8))

    private fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }
}
